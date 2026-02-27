// Bangit - Background Service Worker
// Handles API communication, authentication, and Socket.IO realtime connection

import { io } from 'socket.io-client';

// Configuration
const CONFIG = {
  API_BASE_URL: 'https://bangit-backend-production.up.railway.app',
  AUTH_URL: 'https://bangit.xyz',
  WS_URL: 'wss://bangit-backend-production.up.railway.app',
  PRIVY_APP_ID: 'cmald9h5q02oujo0mvw3azkdz',
};

// State
let authToken = null;
let refreshToken = null; // Note: This is the Twitter OAuth refresh token, not Privy
let currentUser = null;
let privyUser = null;
let socket = null; // Socket.IO client instance (owned directly by service worker)
let tokenExpiresAt = null; // Track when token expires
let offscreenCreating = null; // Promise to track offscreen document creation
let offscreenReady = false; // Track whether offscreen document has signalled OFFSCREEN_READY
let refreshPromise = null; // Lock to prevent concurrent token refreshes
let currentFeedSubscription = null; // Track current feed subscription for reconnection
const EXTERNAL_AUTH_STATE_TTL_MS = 2 * 60 * 1000;
const TOKEN_EXPIRY_FALLBACK_MS = 60 * 60 * 1000;
const externalAuthStates = new Map();
const WALLET_REQUIRED_ERROR = 'WALLET_REQUIRED';

function deriveWsUrl(apiBaseUrl) {
  if (!apiBaseUrl || typeof apiBaseUrl !== 'string') {
    return CONFIG.WS_URL;
  }

  try {
    const parsed = new URL(apiBaseUrl);
    const protocol = parsed.protocol === 'https:'
      ? 'wss:'
      : parsed.protocol === 'wss:'
        ? 'wss:'
        : 'ws:';
    return `${protocol}//${parsed.host}`;
  } catch (error) {
    if (apiBaseUrl.startsWith('https://')) {
      return `wss://${apiBaseUrl.slice('https://'.length)}`;
    }
    if (apiBaseUrl.startsWith('http://')) {
      return `ws://${apiBaseUrl.slice('http://'.length)}`;
    }
    return CONFIG.WS_URL;
  }
}

function getEmbeddedSolanaWalletAddress(user) {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : null;

  if (!linkedAccounts) return null;

  const wallet = linkedAccounts.find(
    (account) => account.type === 'wallet' && account.chainType === 'solana'
  );

  return wallet?.address || null;
}

function resolveWalletAddress(explicitWalletAddress, user) {
  return explicitWalletAddress || getEmbeddedSolanaWalletAddress(user);
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function getTokenExpiryFromJwt(token) {
  if (!token || typeof token !== 'string') return null;

  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(tokenParts[1]));
    if (typeof payload?.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch (error) {
    return null;
  }
}

function getTokenExpiry(accessToken) {
  return getTokenExpiryFromJwt(accessToken) || (Date.now() + TOKEN_EXPIRY_FALLBACK_MS);
}

function generateExternalAuthState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function createExternalAuthState(origin) {
  const state = generateExternalAuthState();
  const expiresAt = Date.now() + EXTERNAL_AUTH_STATE_TTL_MS;
  externalAuthStates.set(origin, { state, expiresAt });
  return { state, expiresAt };
}

function consumeExternalAuthState(origin, providedState) {
  const pending = externalAuthStates.get(origin);
  if (!pending) return false;
  externalAuthStates.delete(origin);

  if (pending.expiresAt < Date.now()) return false;
  if (pending.state !== providedState) return false;
  return true;
}

// =====================================================
// OFFSCREEN DOCUMENT MANAGEMENT
// =====================================================

// Create offscreen document if it doesn't exist
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Wait for any existing creation to complete
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  // Create the offscreen document
  offscreenCreating = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['DOM_PARSER'], // Using DOM_PARSER as it allows running React
    justification: 'Privy SDK requires DOM to refresh authentication tokens',
  });

  try {
    await offscreenCreating;
    console.log('[Bangit] Offscreen document created');
  } catch (error) {
    console.error('[Bangit] Error creating offscreen document:', error);
  } finally {
    offscreenCreating = null;
  }
}

// Close offscreen document
async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
    offscreenReady = false;
    console.log('[Bangit] Offscreen document closed');
  } catch (error) {
    // Ignore error if document doesn't exist
  }
}

function waitForOffscreenReady(timeoutMs = 5000) {
  if (offscreenReady) return Promise.resolve();

  return new Promise((resolve) => {
    const onMessage = (message) => {
      if (message.type === 'OFFSCREEN_READY') {
        chrome.runtime.onMessage.removeListener(onMessage);
        clearTimeout(timer);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      console.warn('[Bangit] Timed out waiting for OFFSCREEN_READY, proceeding anyway');
      resolve();
    }, timeoutMs);
  });
}

// =====================================================
// TOKEN REFRESH LOGIC
// =====================================================

// Schedule proactive token refresh ~5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;

function scheduleTokenRefresh() {
  if (!tokenExpiresAt) return;
  const refreshAt = tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;
  if (refreshAt <= Date.now()) {
    // Already near/past expiry — refresh immediately
    console.log('[Bangit] Token near/past expiry, refreshing immediately');
    refreshAccessToken();
    return;
  }
  chrome.alarms.create('token-refresh', { when: refreshAt });
  console.log('[Bangit] Scheduled token refresh');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token-refresh') {
    console.log('[Bangit] Proactive token refresh alarm fired');
    await refreshAccessToken();
  }
});

// Refresh token using offscreen document
async function refreshAccessToken() {
  // Return existing refresh promise if one is in progress (prevents concurrent refreshes)
  if (refreshPromise) {
    console.log('[Bangit] Token refresh already in progress, waiting...');
    return refreshPromise;
  }

  if (!currentUser?.privyId) {
    console.log('[Bangit] Cannot refresh token: not authenticated');
    return false;
  }

  console.log('[Bangit] Attempting to refresh access token...');

  // Create the refresh promise
  refreshPromise = (async () => {
    try {
      // Ensure offscreen document exists and Privy is initialized
      await setupOffscreenDocument();
      await waitForOffscreenReady();

      // Request token refresh from offscreen document
      const response = await chrome.runtime.sendMessage({ type: 'REFRESH_TOKEN' });

      if (response?.success && response.accessToken) {
        console.log('[Bangit] Token refreshed successfully');

        // Update token
        authToken = response.accessToken;
        tokenExpiresAt = getTokenExpiry(response.accessToken);

        // Save to storage
        await chrome.storage.local.set({
          authToken,
          tokenExpiresAt,
        });

        return true;
      } else if (response?.requiresLogin) {
        console.warn('[Bangit] Privy session lost, clearing stale auth');
        await clearAuth();
        return false;
      } else {
        console.warn('[Bangit] Token refresh failed:', response?.error);
        return false;
      }
    } catch (error) {
      console.error('[Bangit] Token refresh error:', error);
      return false;
    }
    // Offscreen document is kept alive so Privy SDK stays initialized between refreshes.
    // It is only closed on explicit logout (clearAuth).
  })();

  try {
    const success = await refreshPromise;
    if (success) {
      scheduleTokenRefresh();
    }
    return success;
  } finally {
    refreshPromise = null;
  }
}

// Initialize on extension install/update
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Bangit] Extension installed/updated');
  await loadSettings();
  await checkStoredAuth();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Bangit] Browser startup detected');
  await loadSettings();
  await checkStoredAuth();
});

// Load settings from storage
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['apiBaseUrl']);
    if (result.apiBaseUrl) {
      CONFIG.API_BASE_URL = result.apiBaseUrl;
      CONFIG.WS_URL = deriveWsUrl(result.apiBaseUrl);
    }
  } catch (error) {
    console.error('[Bangit] Error loading settings:', error);
  }
}

// Check stored authentication
async function checkStoredAuth() {
  try {
    const result = await chrome.storage.local.get(['authToken', 'currentUser', 'privyId', 'privyUser', 'tokenExpiresAt']);
    if (result.authToken && result.currentUser) {
      authToken = result.authToken;
      privyUser = result.privyUser || null;
      tokenExpiresAt = result.tokenExpiresAt || getTokenExpiry(result.authToken);

      const walletAddress = resolveWalletAddress(result.currentUser?.walletAddress, privyUser);
      if (!walletAddress) {
        console.warn('[Bangit] Stored auth missing wallet address, clearing session');
        await clearAuth();
        return;
      }

      currentUser = {
        ...result.currentUser,
        walletAddress,
      };

      console.log('[Bangit] Auth loaded from storage');

      if (!result.currentUser.walletAddress) {
        await chrome.storage.local.set({ currentUser });
      }

      // Schedule proactive token refresh before expiry
      scheduleTokenRefresh();

      // Try to validate with backend, but don't logout on network errors
      try {
        const isValid = await validateWithBackend();
        if (!isValid) {
          // Only clear if we got an explicit rejection, not a network error
          console.log('[Bangit] Backend explicitly rejected auth, clearing...');
          await clearAuth();
          return;
        }
      } catch (validationError) {
        // Network error or other transient issue - keep auth and continue
        console.warn('[Bangit] Validation failed (network?), keeping auth:', validationError.message);
      }

      console.log('[Bangit] Auth loaded, connecting WebSocket...');
      connectSocket();
    }
  } catch (error) {
    console.error('[Bangit] Error checking auth:', error);
  }
}

// Validate authentication with backend
// Returns true if valid, false if explicitly rejected, throws on network errors
async function validateWithBackend() {
  if (!currentUser?.privyId) return false;

  console.log('[Bangit Auth] Validating user with backend...');

  const requestValidation = () => fetch(`${CONFIG.API_BASE_URL}/get-user-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({}),
  });

  // On startup, stored tokens can be expired after Chrome restarts.
  // Attempt one Privy refresh before declaring auth invalid.
  let response = await requestValidation();
  if ((response.status === 401 || response.status === 403) && currentUser?.privyId) {
    console.warn('[Bangit Auth] Validation returned auth error, attempting Privy refresh...');
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await requestValidation();
    }
  }

  // 401/403 means auth is explicitly invalid
  if (response.status === 401 || response.status === 403) {
    console.error('[Bangit Auth] Backend explicitly rejected auth:', response.status);
    return false;
  }

  // Other errors (5xx, network) should not logout user
  if (!response.ok) {
    console.warn('[Bangit Auth] Backend validation returned error:', response.status);
    throw new Error(`Backend returned ${response.status}`);
  }

  const data = await response.json();

  console.log('[Bangit Auth] Validation response:', {
    canParticipate: data.userStatus?.canParticipate,
    hasVotingStatus: !!data.votingStatus,
  });

  // Update user status from backend
  if (data.userStatus) {
    if (data.userStatus.reason === WALLET_REQUIRED_ERROR || data.userStatus.reason === 'USER_NOT_FOUND') {
      console.warn('[Bangit Auth] Backend reports auth session is incomplete:', data.userStatus.reason);
      // Attempt recovery instead of immediate failure
      return await attemptAuthRecovery(data.userStatus.reason);
    }

    currentUser.userStatus = data.userStatus;
    await chrome.storage.local.set({ currentUser });
  }

  // Check voting status (sybil detection)
  if (data.votingStatus) {
    currentUser.votingStatus = data.votingStatus;
    await chrome.storage.local.set({ currentUser });
  }

  return true;
}

// Attempt to recover from WALLET_REQUIRED or USER_NOT_FOUND during validation
async function attemptAuthRecovery(reason) {
  console.log('[Bangit Auth] Attempting recovery for:', reason);

  if (!privyUser || !authToken) {
    console.warn('[Bangit Auth] Cannot recover: missing privyUser or authToken');
    return false;
  }

  const linkedAccounts = Array.isArray(privyUser?.linkedAccounts)
    ? privyUser.linkedAccounts
    : Array.isArray(privyUser?.linked_accounts)
      ? privyUser.linked_accounts
      : [];
  const twitterAccount = linkedAccounts.find(a => a.type === 'twitter_oauth');
  if (!twitterAccount) {
    console.warn('[Bangit Auth] Cannot recover: no linked Twitter account');
    return false;
  }

  const walletAddress = resolveWalletAddress(null, privyUser);
  if (!walletAddress) {
    console.warn('[Bangit Auth] Cannot recover: no wallet address available');
    return false;
  }

  const registration = await registerWithBackend({
    privyId: privyUser.id,
    twitterAccount,
    walletAddress,
    deviceFingerprint: currentUser?.deviceFingerprint || null,
  });

  if (registration.success) {
    currentUser = {
      ...currentUser,
      walletAddress,
      ...(registration.data?.user?.id ? { id: registration.data.user.id } : {}),
      ...(registration.data?.userStatus ? { userStatus: registration.data.userStatus } : {}),
      ...(registration.data?.votingStatus ? { votingStatus: registration.data.votingStatus } : {}),
    };
    await chrome.storage.local.set({ currentUser });
    console.log('[Bangit Auth] Recovery successful');
    return true;
  }

  console.error('[Bangit Auth] Recovery failed:', registration.error);
  return false;
}

// Clear authentication
async function clearAuth() {
  authToken = null;
  refreshToken = null;
  currentUser = null;
  privyUser = null;
  tokenExpiresAt = null;
  currentFeedSubscription = null;

  // Disconnect socket immediately (no relay needed — we own it directly)
  disconnectSocket();

  // Ensure Privy logout always runs so extension-level session state is fully cleared.
  try {
    await setupOffscreenDocument();
    await waitForOffscreenReady();
    console.log('[Bangit] Calling Privy logout in offscreen document...');
    await chrome.runtime.sendMessage({ type: 'PRIVY_LOGOUT' });
    console.log('[Bangit] Privy logout complete');
  } catch (error) {
    console.error('[Bangit] Error during Privy logout:', error);
  }

  // Close offscreen document
  await closeOffscreenDocument();

  await chrome.storage.local.remove(['authToken', 'currentUser', 'privyId', 'privyUser', 'tokenExpiresAt']);
  chrome.alarms.clear('token-refresh');

  // Notify all tabs
  notifyAllTabs({ type: 'AUTH_STATUS_CHANGED', isAuthenticated: false, user: null });
}

// Save authentication from Privy callback
async function saveAuth(authData) {
  const resolvedWalletAddress = resolveWalletAddress(authData.walletAddress, authData.privyUser);

  console.log('[Bangit] saveAuth called with:', {
    hasPrivyId: !!authData.privyId,
    hasPrivyUser: !!authData.privyUser,
    hasTwitterAccount: !!authData.twitterAccount,
    hasAccessToken: !!authData.accessToken,
    hasWalletAddress: !!resolvedWalletAddress,
  });

  const { privyId, privyUser: pUser, twitterAccount, accessToken, identityToken, oauthTokens, deviceFingerprint } = authData;

  if (!privyId) {
    throw new Error('Missing privyId in auth data');
  }

  if (!twitterAccount) {
    throw new Error('Missing twitterAccount in auth data');
  }

  if (!accessToken) {
    throw new Error('Missing access token in auth data');
  }

  if (!resolvedWalletAddress) {
    throw new Error(WALLET_REQUIRED_ERROR);
  }

  authToken = accessToken;
  refreshToken = oauthTokens?.refreshToken || null;
  privyUser = pUser;

  // Track token expiration for diagnostics and session visibility in the popup.
  tokenExpiresAt = getTokenExpiry(accessToken);

  // Register/sync user with backend before persisting authenticated state
  const registration = await registerWithBackend({ ...authData, walletAddress: resolvedWalletAddress, deviceFingerprint });
  if (!registration.success) {
    authToken = null;
    refreshToken = null;
    currentUser = null;
    privyUser = null;
    tokenExpiresAt = null;
    disconnectSocket();
    await chrome.storage.local.remove(['authToken', 'currentUser', 'privyId', 'privyUser', 'tokenExpiresAt']);
    throw new Error(registration.error || 'Failed to register user');
  }

  currentUser = {
    privyId,
    twitterId: twitterAccount?.subject || null,
    twitterUsername: twitterAccount?.username || null,
    twitterDisplayName: twitterAccount?.name || null,
    twitterProfileImageUrl: twitterAccount?.profilePictureUrl || null,
    walletAddress: resolvedWalletAddress,
    ...(registration.data?.user?.id ? { id: registration.data.user.id } : {}),
    ...(registration.data?.userStatus ? { userStatus: registration.data.userStatus } : {}),
    ...(registration.data?.votingStatus ? { votingStatus: registration.data.votingStatus } : {}),
  };

  console.log('[Bangit] Saving to chrome.storage.local:', {
    hasAuthToken: !!authToken,
    hasCurrentUser: !!currentUser,
  });

  await chrome.storage.local.set({
    authToken,
    currentUser,
    privyId,
    privyUser,
    tokenExpiresAt,
  });

  console.log('[Bangit] Saved to storage successfully');

  // Verify it was saved
  const verification = await chrome.storage.local.get(['authToken', 'currentUser', 'privyId']);
  console.log('[Bangit] Storage verification:', {
    hasAuthToken: !!verification.authToken,
    hasCurrentUser: !!verification.currentUser,
    hasPrivyId: !!verification.privyId,
  });

  // Connect to WebSocket
  connectSocket();

  // Schedule proactive token refresh before expiry
  scheduleTokenRefresh();

  // Notify all tabs
  notifyAllTabs({ type: 'AUTH_STATUS_CHANGED', isAuthenticated: true, user: currentUser });

  console.log('[Bangit] saveAuth completed successfully');

  return { success: true };
}

// Register or sync user with backend
async function registerWithBackend(authData) {
  const { privyId, twitterAccount, oauthTokens, registeredAt, walletAddress, identityToken, deviceFingerprint } = authData;
  console.log('[Bangit] registerWithBackend called:', {
    hasTwitterAccount: !!authData.twitterAccount,
    hasWalletAddress: !!authData.walletAddress,
  });

  if (!twitterAccount?.subject) {
    console.error('[Bangit] No Twitter account found for registration');
    return { success: false, error: 'Missing Twitter account for registration' };
  }

  if (!walletAddress) {
    return { success: false, error: WALLET_REQUIRED_ERROR };
  }

  try {
    // Get timezone
    let timeZone = 'UTC';
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      console.warn('[Bangit] Failed to get timezone:', e);
    }

    const body = {
      twitterId: twitterAccount.subject,
      twitterUsername: twitterAccount.username || null,
      twitterName: twitterAccount.name || null,
      twitterAvatarUrl: twitterAccount.profilePictureUrl || null,
      privyId: privyId,
      registeredAt: registeredAt || Date.now(),
      walletAddress,
      timeZone: timeZone,
      identityToken: identityToken || null, // Privy identity token for Twitter ownership verification
      deviceFingerprint: deviceFingerprint || null, // Device fingerprint for sybil detection
    };

    console.log('[Bangit] Registering user with backend...');

    const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/register-user`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorCode = errorData?.code || errorData?.error || 'BACKEND_REGISTRATION_FAILED';
      const errorMessage = errorData?.message || errorData?.error || `Backend registration failed with status ${response.status}`;
      console.error('[Bangit] Backend registration failed:', errorCode, errorMessage);
      return { success: false, error: errorCode, message: errorMessage };
    }

    const data = await response.json();
    console.log('[Bangit] Backend registration successful');

    console.log('[Bangit Auth] Registration response:', {
      hasUserId: !!data.user?.id,
      canParticipate: data.userStatus?.canParticipate,
    });

    // Check if registration is incomplete (no wallet or user not found)
    if (data.userStatus) {
      const reason = data.userStatus.reason;
      if (reason === WALLET_REQUIRED_ERROR || reason === 'USER_NOT_FOUND') {
        console.error('[Bangit] Registration incomplete:', reason);
        return { success: false, error: reason };
      }
    }

    return { success: true, data };
  } catch (error) {
    console.error('[Bangit] Backend registration error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Backend registration error' };
  }
}

// Notify all X/Twitter tabs
async function notifyAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script loaded
      }
    }
  } catch (error) {
    console.error('[Bangit] Error notifying tabs:', error);
  }
}

// Socket.IO connection management (direct — no offscreen relay)

function connectSocket() {
  if (socket?.connected) {
    console.log('[Bangit] Socket already connected');
    return;
  }

  if (!authToken) {
    console.warn('[Bangit] Cannot connect socket: no auth token');
    return;
  }

  // Tear down stale instance if any
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  console.log('[Bangit] Connecting Socket.IO...');
  socket = io(CONFIG.WS_URL, {
    auth: async (cb) => {
      // Refresh token if near/past expiry before each connection attempt (including reconnections)
      if (tokenExpiresAt && Date.now() > tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
        await refreshAccessToken();
      }
      cb({ token: authToken });
    },
    transports: ['websocket'], // websocket-only — no XMLHttpRequest in service workers
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('[Bangit] Socket.IO connected');
    // Re-subscribe to active feed room after (re)connect
    if (currentFeedSubscription) {
      console.log('[Bangit] Re-subscribing to feed room:', currentFeedSubscription);
      socket.emit('feed:subscribe', { feedType: currentFeedSubscription });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[Bangit] Socket.IO disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[Bangit] Socket.IO connection error:', error.message);
  });

  // Forward realtime events to content scripts
  const eventsToForward = [
    'tweet:impactUpdate',
    'feed:scoreUpdate',
    'feed:newPost',
    'user:metadataUpdate',
  ];
  eventsToForward.forEach(event => {
    socket.on(event, (data) => handleSocketEvent(event, data));
  });
}

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Handle Socket.IO events forwarded from offscreen document
function handleSocketEvent(event, data) {
  if (event === 'tweet:impactUpdate') {

    // Forward to content scripts
    notifyAllTabs({
      type: 'VOTE_UPDATE',
      tweetId: data.tweetId,
      data: {
        upPower: data.upPower,
        downPower: data.downPower,
        upvoters: data.upvoters,
        downvoters: data.downvoters,
        realtimeNetImpact: data.realtimeNetImpact,
        previousRealtimeNetImpact: data.previousRealtimeNetImpact,
        timestamp: data.timestamp,
      }
    });
  }

  if (event === 'feed:scoreUpdate') {

    // Forward feed score updates for real-time reordering
    notifyAllTabs({
      type: 'FEED_SCORE_UPDATE',
      feedType: data.feedType,
      tweetId: data.tweetId,
      postId: data.postId,
      score: data.score,
      realtimeNetImpact: data.realtimeNetImpact,
      timestamp: data.timestamp,
    });
  }

  if (event === 'user:metadataUpdate') {

    // Forward user metadata updates to content scripts
    notifyAllTabs({
      type: 'USER_METADATA_UPDATE',
      data: data,
    });
  }

  if (event === 'feed:newPost') {

    // Forward new post events to content scripts (for NEW feed)
    notifyAllTabs({
      type: 'FEED_NEW_POST',
      tweetId: data.tweetId,
      tweet: data.tweet,
      timestamp: data.timestamp,
    });
  }
}

// Fetch wrapper with auth headers and automatic token refresh on 401
async function fetchWithAuth(url, options = {}, retryOnAuth = true) {
  // Preflight: if token is already expired, refresh before sending (catches missed alarms)
  if (authToken && tokenExpiresAt && Date.now() > tokenExpiresAt && retryOnAuth) {
    console.log('[Bangit API] Token expired, refreshing before request...');
    await refreshAccessToken();
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add JWT Bearer token if available
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, { ...options, headers });

  // Handle 401 with token refresh
  if (response.status === 401 && retryOnAuth) {
    console.warn('[Bangit API] Got 401, attempting token refresh...');

    const refreshed = await refreshAccessToken();
    if (refreshed) {
      console.log('[Bangit API] Token refreshed, retrying request...');
      // Retry with new token (but don't retry again to avoid infinite loop)
      return fetchWithAuth(url, options, false);
    } else {
      console.warn('[Bangit API] Token refresh failed, user may need to re-login');
    }
  }

  return response;
}

// API request helper
async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || `API error: ${response.status}`);
  }

  return response.json();
}

// Cast a vote
async function castVote(tweetId, voteType, maxPowerPct) {
  const endpoint = voteType === 'up' ? '/upvote' : '/downvote';

  const result = await apiRequest(endpoint, 'POST', {
    tweetId,
    maxPowerPct,
  });

  return result;
}

// Get basic data for multiple tweets
async function getTweetsBasic(tweetIds) {
  if (!tweetIds || tweetIds.length === 0) {
    return { tweets: [] };
  }

  try {
    const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/tweets-basic`, {
      method: 'POST',
      body: JSON.stringify({
        tweetIds,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error('[Bangit] Error fetching tweets basic data:', error);
    return { tweets: [] };
  }
}

// Get full tweet data by IDs (for feed insertion)
async function getTweetsByIds(tweetIds) {
  if (!tweetIds || tweetIds.length === 0) {
    return { tweets: [] };
  }

  try {
    const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/tweets-by-ids`, {
      method: 'POST',
      body: JSON.stringify({
        tweetIds,
        useSourceUrls: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error('[Bangit] Error fetching tweets by IDs:', error);
    return { tweets: [] };
  }
}

// Get user status from backend
async function getUserStatus() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  console.log('[Bangit Auth] Fetching user status...');

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/get-user-status`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    console.error('[Bangit Auth] Failed to get user status:', response.status);
    throw new Error('Failed to get user status');
  }

  const data = await response.json();

  console.log('[Bangit Auth] User status response:', {
    canParticipate: data.userStatus?.canParticipate,
    hasVotingStatus: !!data.votingStatus,
  });

  return data;
}

// Get user power stats from backend
async function getUserPower() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/power/me`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to get user power');
  }

  const data = await response.json();
  return data;
}

// Get user account data from backend
async function getAccountData() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  if (!currentUser?.walletAddress) {
    throw new Error(WALLET_REQUIRED_ERROR);
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/account/me`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData?.code === WALLET_REQUIRED_ERROR || errorData?.error === WALLET_REQUIRED_ERROR) {
      throw new Error(WALLET_REQUIRED_ERROR);
    }
    throw new Error(errorData.error || 'Failed to get account data');
  }

  const data = await response.json();
  return data;
}

// Claim and stake rewards
async function claimAndStakeRewards() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/claim-and-stake-rewards/me`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to claim and stake rewards');
  }

  const data = await response.json();
  return data;
}

// Claim rewards (to wallet, 10% fee)
async function claimRewards() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/claim-rewards/me`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to claim rewards');
  }

  const data = await response.json();
  return data;
}

// Claim vested tokens
async function claimVestedTokens() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/claim-vested/me`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to claim vested tokens');
  }

  const data = await response.json();
  return data;
}

// Get invite details
async function getInviteDetails(inviteId) {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/invite-details/${inviteId}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to get invite details');
  }

  const data = await response.json();
  return data;
}

// Refill power by burning staked BANG
async function refillPower(refillPct) {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/refill-power`, {
    method: 'POST',
    body: JSON.stringify({
      privyId: currentUser.privyId,
      refillPct: refillPct,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || 'Failed to refill power');
  }

  const data = await response.json();
  return data;
}

// =====================================================
// RESTRICTION HANDLING API FUNCTIONS
// =====================================================

// Redeem an invite code
async function redeemInviteCode(inviteCode) {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  console.log('[Bangit Auth] Redeeming invite code...');

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/redeem-invite-code`, {
    method: 'POST',
    body: JSON.stringify({
      privyId: currentUser.privyId,
      inviteCode: inviteCode.trim(),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[Bangit Auth] Invite code redemption failed:', {
      status: response.status,
      error: errorData.error || 'Invalid invite code',
    });
    throw new Error(errorData.error || 'Invalid invite code');
  }

  const data = await response.json();

  console.log('[Bangit Auth] Invite code redemption response:', {
    success: data.success,
    canParticipateAfterRedemption: data.twitterAccountValidation?.validated ?? true,
  });

  // Update local userStatus if successful
  if (data.success) {
    currentUser.userStatus = {
      canParticipate: data.twitterAccountValidation?.validated ?? true,
      reason: data.twitterAccountValidation?.validated === false ? 'TWITTER_ACCOUNT' : null,
      restrictedUntil: data.twitterAccountValidation?.restrictedUntil || null,
    };
    await chrome.storage.local.set({ currentUser });
    console.log('[Bangit Auth] Updated local userStatus after invite redemption');
  }

  return data;
}

// Validate Twitter account (for retry after TWITTER_ACCOUNT restriction)
async function validateTwitterAccount() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const twitterId = currentUser.twitterId;
  if (!twitterId) {
    throw new Error('No Twitter account linked');
  }

  console.log('[Bangit Auth] Validating Twitter account...');

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/validate-twitter-account`, {
    method: 'POST',
    body: JSON.stringify({
      twitterId: twitterId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[Bangit Auth] Twitter account validation failed:', {
      status: response.status,
      error: errorData.error || 'Validation failed',
    });
    throw new Error(errorData.error || 'Validation failed');
  }

  const data = await response.json();

  console.log('[Bangit Auth] Twitter account validation response:', {
    validated: data.twitterAccountValidation?.validated,
    hasUserStatus: !!data.userStatus,
  });

  // Update local userStatus from backend response
  // Backend returns the correct userStatus with proper reason (INVITE_CODE if Twitter validated but no invite code)
  if (data.userStatus) {
    currentUser.userStatus = data.userStatus;
    await chrome.storage.local.set({ currentUser });
    console.log('[Bangit Auth] Updated local userStatus after Twitter validation');
  } else if (data.twitterAccountValidation) {
    // Fallback for backward compatibility if backend doesn't return userStatus
    currentUser.userStatus = {
      canParticipate: data.twitterAccountValidation.validated,
      reason: data.twitterAccountValidation.validated ? null : 'TWITTER_ACCOUNT',
      restrictedUntil: data.twitterAccountValidation.restrictedUntil || null,
    };
    await chrome.storage.local.set({ currentUser });
    console.log('[Bangit Auth] Updated local userStatus (fallback) after Twitter validation');
  }

  return data;
}

// =====================================================
// SIDEBAR BUTTONS API FUNCTIONS
// =====================================================

// Get curation stats for performance modal
async function getCurationStats(fresh = false) {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/curation-stats`, {
    method: 'POST',
    body: JSON.stringify({
      fresh: fresh,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get curation stats');
  }

  return response.json();
}

// Get reward distributions list
async function getRewardDistributions() {
  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/reward-distributions`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to get reward distributions');
  }

  return response.json();
}

// Get upcoming distribution pool estimates
async function getUpcomingDistribution() {
  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/reward-distributions/upcoming`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error('Failed to get upcoming distribution');
  }

  return response.json();
}

// Get performance details for a specific distribution
async function getDistributionPerformance(distributionId) {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(
    `${CONFIG.API_BASE_URL}/reward-distributions/${distributionId}/performance/me`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to get distribution performance');
  }

  return response.json();
}

// Get current period performance
async function getCurrentPeriodPerformance() {
  if (!currentUser?.privyId) {
    throw new Error('Not authenticated');
  }

  const response = await fetchWithAuth(
    `${CONFIG.API_BASE_URL}/current-period-performance/me`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to get current period performance');
  }

  return response.json();
}

// Get curator rewards for a specific distribution (for Rewards modal)
async function getDistributionCurators(distributionId) {
  const response = await fetchWithAuth(
    `${CONFIG.API_BASE_URL}/reward-distributions/${distributionId}/curator-rewards`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to get curator rewards');
  }

  return response.json();
}

// Get curated tweet feed for Bangit tab
async function getTweetFeed(sortType = 'hot', cursor = null, limit = 20, followingOnly = false, period = null) {
  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/feed`, {
    method: 'POST',
    body: JSON.stringify({
      sortType,
      cursor,
      limit,
      followingOnly,
      ...(period && { period }),
      useSourceUrls: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || `API error: ${response.status}`);
    error.code = typeof errorData.code === 'string' ? errorData.code : null;
    throw error;
  }

  return response.json();
}

// Get leaderboard data
async function getLeaderboard(type = 'curators', period = '24h', privyId = null) {
  const endpoint = type === 'curators' ? 'curators' : 'creators';
  const params = new URLSearchParams({ limit: '50' });
  if (period && period !== 'All') {
    params.set('period', period);
  }
  if (privyId) {
    params.set('privyId', privyId);
  }

  const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}/leaderboard/${endpoint}?${params.toString()}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }

  return response.json();
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    console.error('[Bangit] Message handler error:', error);
    sendResponse({ success: false, error: error.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  await loadSettings();

  // Restore auth from local storage if not in memory (service worker may have restarted)
  if (!currentUser?.privyId) {
    const storageData = await chrome.storage.local.get(['authToken', 'currentUser', 'privyId', 'privyUser', 'tokenExpiresAt']);
    if (storageData.authToken && storageData.currentUser) {
      authToken = storageData.authToken;
      privyUser = storageData.privyUser || null;
      tokenExpiresAt = storageData.tokenExpiresAt || getTokenExpiry(storageData.authToken);

      const walletAddress = resolveWalletAddress(storageData.currentUser?.walletAddress, privyUser);
      if (!walletAddress) {
        console.warn('[Bangit] Restored auth missing wallet address, clearing session');
        await clearAuth();
      } else {
        currentUser = {
          ...storageData.currentUser,
          walletAddress,
        };

        if (!storageData.currentUser.walletAddress) {
          await chrome.storage.local.set({ currentUser });
        }
      }

      console.log('[Bangit] Restored auth from storage');

      // If token is already near/past expiry, await refresh before processing the message
      // to avoid sending stale credentials. Otherwise just schedule an alarm for later.
      if (tokenExpiresAt && tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS <= Date.now()) {
        await refreshAccessToken();
      } else {
        scheduleTokenRefresh();
      }
    }
  }

  switch (message.type) {
    case 'GET_AUTH_STATUS':
      if (!currentUser?.walletAddress) {
        return {
          isAuthenticated: false,
          user: null,
          privyUser: null,
          error: currentUser?.privyId ? WALLET_REQUIRED_ERROR : null,
        };
      }

      return {
        isAuthenticated: !!currentUser?.privyId,
        user: currentUser,
        privyUser: privyUser,
      };

    case 'CAST_VOTE':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await castVote(message.tweetId, message.voteType, message.maxPowerPct);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_TWEETS_BASIC':
      try {
        const result = await getTweetsBasic(message.tweetIds);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_TWEETS_BY_IDS':
      try {
        const result = await getTweetsByIds(message.tweetIds);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_USER_STATUS':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getUserStatus();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_USER_POWER':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getUserPower();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_ACCOUNT_DATA':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      if (!currentUser?.walletAddress) {
        return { success: false, error: WALLET_REQUIRED_ERROR };
      }
      try {
        const result = await getAccountData();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'CLAIM_AND_STAKE':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      if (!currentUser?.walletAddress) {
        return { success: false, error: WALLET_REQUIRED_ERROR };
      }
      try {
        const result = await claimAndStakeRewards();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'CLAIM_REWARDS':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      if (!currentUser?.walletAddress) {
        return { success: false, error: WALLET_REQUIRED_ERROR };
      }
      try {
        const result = await claimRewards();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'CLAIM_VESTED':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      if (!currentUser?.walletAddress) {
        return { success: false, error: WALLET_REQUIRED_ERROR };
      }
      try {
        const result = await claimVestedTokens();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'GET_INVITE_DETAILS':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getInviteDetails(message.inviteId);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'REFILL_POWER':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await refillPower(message.refillPct);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'REDEEM_INVITE_CODE':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await redeemInviteCode(message.code);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'VALIDATE_TWITTER_ACCOUNT':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await validateTwitterAccount();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'OPEN_LOGIN':
      // Open options page for Privy authentication
      chrome.runtime.openOptionsPage();
      return { success: true };

    case 'SET_AUTH':
      // Only privileged extension pages can set auth directly.
      // External callers must use the signed onMessageExternal callback flow.
      {
        const allowedAuthSenderUrls = [
          chrome.runtime.getURL('options.html'),
          chrome.runtime.getURL('popup.html'),
          chrome.runtime.getURL('offscreen.html'),
        ];
        const senderUrl = sender?.url || '';
        const isAllowedSender = allowedAuthSenderUrls.some((allowedUrl) =>
          senderUrl === allowedUrl || senderUrl.startsWith(`${allowedUrl}?`) || senderUrl.startsWith(`${allowedUrl}#`)
        );

        if (!isAllowedSender) {
          console.error('[Bangit] Blocking SET_AUTH from untrusted sender:', senderUrl || '(missing sender URL)');
          return { success: false, error: 'Unauthorized sender for SET_AUTH' };
        }
      }

      console.log('[Bangit] SET_AUTH message received');
      try {
        await saveAuth(message);
        console.log('[Bangit] Auth saved successfully');
        return { success: true };
      } catch (error) {
        console.error('[Bangit] Error saving auth:', error);
        return { success: false, error: error.message };
      }

    case 'LOGOUT':
      await clearAuth();
      return { success: true };

    case 'GET_SETTINGS':
      return {
        apiBaseUrl: CONFIG.API_BASE_URL,
        wsUrl: CONFIG.WS_URL,
        authUrl: CONFIG.AUTH_URL,
        extensionId: chrome.runtime.id,
      };

    case 'SAVE_SETTINGS':
      {
        const allowedSettingsSenderUrls = [
          chrome.runtime.getURL('options.html'),
          chrome.runtime.getURL('popup.html'),
        ];
        const settingsSenderUrl = sender?.url || '';
        const isAllowedSettingsSender = allowedSettingsSenderUrls.some((allowedUrl) =>
          settingsSenderUrl === allowedUrl || settingsSenderUrl.startsWith(`${allowedUrl}?`) || settingsSenderUrl.startsWith(`${allowedUrl}#`)
        );

        if (!isAllowedSettingsSender) {
          console.error('[Bangit] Blocking SAVE_SETTINGS from untrusted sender:', settingsSenderUrl || '(missing sender URL)');
          return { success: false, error: 'Unauthorized sender for SAVE_SETTINGS' };
        }
      }
      if (message.apiBaseUrl) {
        CONFIG.API_BASE_URL = message.apiBaseUrl;
        CONFIG.WS_URL = deriveWsUrl(message.apiBaseUrl);
        await chrome.storage.sync.set({ apiBaseUrl: message.apiBaseUrl });
      }
      return { success: true };

    case 'GET_EXTENSION_ID':
      return { extensionId: chrome.runtime.id };

    // Sidebar buttons - Curation stats
    case 'GET_CURATION_STATS':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getCurationStats(message.fresh);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Sidebar buttons - Reward distributions list
    case 'GET_REWARD_DISTRIBUTIONS':
      try {
        const result = await getRewardDistributions();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Sidebar buttons - Upcoming distribution pool estimates
    case 'GET_UPCOMING_DISTRIBUTION':
      try {
        const result = await getUpcomingDistribution();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Sidebar buttons - Distribution performance details
    case 'GET_DISTRIBUTION_PERFORMANCE':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getDistributionPerformance(message.distributionId);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Sidebar buttons - Current period performance
    case 'GET_CURRENT_PERIOD_PERFORMANCE':
      if (!currentUser?.privyId) {
        return { success: false, error: 'Not authenticated' };
      }
      try {
        const result = await getCurrentPeriodPerformance();
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Sidebar buttons - Distribution curator rewards (for Rewards modal)
    case 'GET_DISTRIBUTION_CURATORS':
      try {
        const result = await getDistributionCurators(message.distributionId);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Bangit feed - Get curated tweet feed
    case 'GET_TWEET_FEED':
      try {
        const result = await getTweetFeed(message.sortType, message.cursor, message.limit, message.followingOnly, message.period);
        console.log('[Bangit] Tweet feed loaded:', { count: result?.tweets?.length || 0 });
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: typeof error.code === 'string' ? error.code : null
        };
      }

    // Leaderboard data
    case 'GET_LEADERBOARD':
      try {
        const result = await getLeaderboard(message.leaderboardType, message.period, message.privyId);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }

    // Socket subscription - Subscribe to feed room for real-time score updates
    case 'SOCKET_SUBSCRIBE_FEED':
      currentFeedSubscription = message.feedType;
      if (!socket?.connected) {
        console.warn('[Bangit] Cannot subscribe to feed yet: socket not connected. Will subscribe on connect.');
        return { success: true };
      }
      console.log('[Bangit] Subscribing to feed room:', message.feedType);
      socket.emit('feed:subscribe', { feedType: message.feedType });
      return { success: true };

    // Socket subscription - Unsubscribe from feed room
    case 'SOCKET_UNSUBSCRIBE_FEED':
      if (currentFeedSubscription === message.feedType) {
        currentFeedSubscription = null;
      }
      if (socket?.connected) {
        console.log('[Bangit] Unsubscribing from feed room:', message.feedType);
        socket.emit('feed:unsubscribe', { feedType: message.feedType });
      }
      return { success: true };

    // Offscreen document ready notification
    case 'OFFSCREEN_READY':
      console.log('[Bangit] Offscreen document ready, authenticated:', message.authenticated);
      offscreenReady = true;
      return { success: true };

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Listen for external messages (from bangit.xyz for Privy auth callback)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[Bangit] External message received:', message.type);

  // Verify sender is from allowed origins
  const allowedOrigins = [
    'https://bangit.xyz',
    'https://www.bangit.xyz',
  ];

  const senderOrigin = sender.url ? new URL(sender.url).origin : null;

  if (!senderOrigin || !allowedOrigins.includes(senderOrigin)) {
    console.error('[Bangit] Unauthorized sender:', senderOrigin);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  if (message.type === 'REQUEST_AUTH_STATE') {
    const { state, expiresAt } = createExternalAuthState(senderOrigin);
    sendResponse({ success: true, authState: state, expiresAt });
    return false;
  }

  if (message.type === 'SET_AUTH') {
    console.error('[Bangit] External SET_AUTH is not allowed');
    sendResponse({ success: false, error: 'SET_AUTH not allowed for external callers' });
    return false;
  }

  if (message.type === 'PRIVY_AUTH_CALLBACK') {
    if (!message.authState || !consumeExternalAuthState(senderOrigin, message.authState)) {
      console.error('[Bangit] Invalid or expired external auth state');
      sendResponse({ success: false, error: 'Invalid auth state' });
      return false;
    }

    console.log('[Bangit] Processing auth callback...');

    saveAuth({
      privyId: message.privyId,
      privyUser: message.privyUser,
      twitterAccount: message.twitterAccount,
      oauthTokens: message.oauthTokens,
      walletAddress: message.walletAddress,
      registeredAt: message.registeredAt,
      accessToken: message.accessToken,
    }).then(() => {
      console.log('[Bangit] Auth saved successfully');
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[Bangit] Error saving auth:', error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep channel open for async response
  }

  // Legacy support for AUTH_CALLBACK
  if (message.type === 'AUTH_CALLBACK') {
    if (!message.authState || !consumeExternalAuthState(senderOrigin, message.authState)) {
      console.error('[Bangit] Invalid or expired external auth state (legacy callback)');
      sendResponse({ success: false, error: 'Invalid auth state' });
      return false;
    }

    saveAuth({
      privyId: message.privyId,
      privyUser: message.user,
      twitterAccount: message.twitterAccount || {
        subject: message.user?.twitterId,
        username: message.user?.twitterUsername,
        name: message.user?.twitterName,
        profilePictureUrl: message.user?.twitterAvatarUrl,
      },
      accessToken: message.token,
    }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });

    return true;
  }

  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

// Initialize on startup
loadSettings().then(checkStoredAuth);
