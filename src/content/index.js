// Bangit - Content Script Entry Point (MV3 Bootstrapper)
// This is the thin entry point that initializes features

import { getState, setState, updateState, cleanupState } from './core/state.js';
import { CONFIG } from './core/config.js';
import { injectFonts, isExtensionContextValid, isContextInvalidatedError } from './core/utils.js';
import { sendMessage, initMessageListener, registerHandler, MessageTypes, getAuthStatus, getUserPower, getUserStatus } from './core/rpc.js';
import { registerFeature, registerLazyFeature, startFeature, stopAllFeatures, loadLazyFeature } from './core/lifecycle.js';

// Import core features (always loaded)
import tweetsFeature from './features/tweets/index.js';

// Register lazy-loadable features
registerLazyFeature('voting', () => import('./features/voting/index.js'));
registerLazyFeature('sidebar', () => import('./features/sidebar/index.js'));
registerLazyFeature('modals', () => import('./features/modals/index.js'));
registerLazyFeature('feed', () => import('./features/feed/index.js'));

// User status cache (30 second TTL)
let cachedUserStatus = null;
let cachedVotingStatus = null;
let userStatusCacheTime = 0;
const USER_STATUS_CACHE_TTL = 30000; // 30 seconds

/**
 * Invalidate the user status cache
 * Called after successful invite code redemption
 */
function invalidateUserStatusCache() {
  cachedUserStatus = null;
  cachedVotingStatus = null;
  userStatusCacheTime = 0;
}

/**
 * Update the cached user status
 * Called when restriction status changes (e.g., new restrictedUntil from failed retry)
 */
function updateUserStatusCache(newStatus) {
  if (newStatus) {
    cachedUserStatus = { ...cachedUserStatus, ...newStatus };
    userStatusCacheTime = Date.now();
    console.log('[Bangit Auth] User status cache updated:', {
      canParticipate: cachedUserStatus.canParticipate,
    });
  }
}

/**
 * Handle vote button click
 * Lazy loads voting feature and opens power selector
 */
async function handleVoteClick(tweetId) {
  const state = getState();

  if (!state.auth.isAuthenticated) {
    // Load modals feature for login prompt
    try {
      const modalsModule = await loadLazyFeature('modals');
      if (modalsModule.showLoginPrompt) {
        modalsModule.showLoginPrompt();
      }
    } catch (error) {
      console.error('[Bangit] Error loading modals feature:', error);
    }
    return;
  }

  // Check for account restrictions (invite code, Twitter validation, flagged, sybil)
  try {
    const now = Date.now();
    // Refresh cache if expired
    if (!cachedUserStatus || (now - userStatusCacheTime > USER_STATUS_CACHE_TTL)) {
      console.log('[Bangit Auth] Fetching user status for restriction check...');
      const statusResponse = await getUserStatus();
      if (statusResponse.success && statusResponse.data?.userStatus) {
        cachedUserStatus = statusResponse.data.userStatus;
        console.log('[Bangit Auth] User status cached:', {
          canParticipate: cachedUserStatus.canParticipate,
        });
      } else {
        cachedUserStatus = null;
        console.log('[Bangit Auth] No user status in response, cache cleared');
      }
      // Also cache voting status for sybil detection
      if (statusResponse.success && statusResponse.data?.votingStatus) {
        cachedVotingStatus = statusResponse.data.votingStatus;
        console.log('[Bangit Auth] Voting status cached:', {
          canVote: cachedVotingStatus.canVote,
        });
      } else {
        cachedVotingStatus = null;
      }
      userStatusCacheTime = now;
    }

    // Check for sybil detection (another account already voted from this device)
    if (cachedVotingStatus && !cachedVotingStatus.canVote) {
      if (cachedVotingStatus.reason === 'SYBIL_ANOTHER_ACCOUNT_VOTED') {
        console.log('[Bangit Auth] Sybil detected, showing modal');
        const modalsModule = await loadLazyFeature('modals');
        if (modalsModule.showSybilModal) {
          modalsModule.showSybilModal(cachedVotingStatus.blockingUsername);
        }
        return;
      }
    }

    // Check if user is restricted
    if (cachedUserStatus && !cachedUserStatus.canParticipate) {
      console.log('[Bangit Auth] User is restricted, showing modal');
      const modalsModule = await loadLazyFeature('modals');
      if (modalsModule.showRestrictionModal) {
        modalsModule.showRestrictionModal(cachedUserStatus, invalidateUserStatusCache, updateUserStatusCache);
      }
      return;
    }
  } catch (error) {
    console.error('[Bangit Auth] Error checking user status:', error);
    // Continue to voting if status check fails (let backend handle it)
  }

  // Check if already voted and cooldown status
  const existingVote = state.tweets.voted.get(tweetId);
  if (existingVote) {
    const now = new Date();
    const hoursSinceVote = (now - existingVote.lastVotedAt) / (1000 * 60 * 60);

    if (hoursSinceVote < CONFIG.COOLDOWN_HOURS) {
      const hoursRemaining = CONFIG.COOLDOWN_HOURS - hoursSinceVote;
      const hours = Math.floor(hoursRemaining);
      const minutes = Math.floor((hoursRemaining - hours) * 60);
      // Load modals for toast
      try {
        const modalsModule = await loadLazyFeature('modals');
        if (modalsModule.showToast) {
          modalsModule.showToast(`You can vote on this tweet again in ${hours}h ${minutes}m`, 'info');
        }
      } catch (error) {
        console.error('[Bangit] Error showing toast:', error);
      }
      return;
    }
  }

  // Check if extension context is still valid
  if (!isExtensionContextValid()) {
    try {
      const modalsModule = await loadLazyFeature('modals');
      if (modalsModule.showToast) {
        modalsModule.showToast('Extension was updated. Please refresh the page.', 'warning');
      }
    } catch (error) {
      console.error('[Bangit] Error showing toast:', error);
    }
    return;
  }

  // Load voting feature and open modal immediately with cached or default data
  try {
    const votingModule = await loadLazyFeature('voting');

    // Use cached stats or defaults - never wait for fetch
    const powerStats = getState().power.userStats || DEFAULT_POWER_STATS;

    // Open power selector immediately
    if (votingModule.createPowerSelector) {
      votingModule.createPowerSelector(tweetId, 'up', powerStats);
    }

    // Always fetch fresh data in background and update modal + sidebar
    getUserPower()
      .then(async response => {
        if (response.success) {
          const freshStats = response.data;
          updateState('power', { userStats: freshStats, lastFetch: Date.now() });

          // Update the open modal with fresh data
          if (votingModule.updateOpenModalPowerStats) {
            votingModule.updateOpenModalPowerStats(freshStats);
          }

          // Update sidebar power bar button
          try {
            const sidebarModule = await loadLazyFeature('sidebar');
            if (sidebarModule.updatePowerButtonDisplay) {
              sidebarModule.updatePowerButtonDisplay(freshStats);
            }
          } catch (e) {
            // Sidebar may not be loaded, ignore
          }
        }
      })
      .catch(error => {
        console.error('[Bangit] Failed to fetch fresh power stats:', error);
      });
  } catch (error) {
    console.error('[Bangit] Error handling vote click:', error);
    if (isContextInvalidatedError(error)) {
      try {
        const modalsModule = await loadLazyFeature('modals');
        if (modalsModule.showToast) {
          modalsModule.showToast('Extension was updated. Please refresh the page.', 'warning');
        }
      } catch (e) {
        // Ignore
      }
    } else {
      try {
        const modalsModule = await loadLazyFeature('modals');
        if (modalsModule.showToast) {
          modalsModule.showToast('Failed to open vote modal. Please try again.', 'error');
        }
      } catch (e) {
        // Ignore
      }
    }
  }
}

/**
 * Check if currently on home page
 */
function isOnHomePage() {
  const path = window.location.pathname;
  return path === '/' || path === '/home';
}

/**
 * Check if power stats cache is fresh (within TTL)
 */
function isPowerCacheFresh() {
  const { userStats, lastFetch } = getState().power;
  if (!userStats || !lastFetch) return false;
  return (Date.now() - lastFetch) < CONFIG.POWER_CACHE_TTL;
}

/**
 * Pre-fetch user power stats (non-blocking, for cache warming)
 */
function prefetchUserPowerStats() {
  if (!isExtensionContextValid()) {
    console.log('[Bangit] Skipping prefetch - extension context invalid');
    return;
  }

  getUserPower()
    .then(response => {
      if (response.success) {
        updateState('power', { userStats: response.data, lastFetch: Date.now() });
        console.log('[Bangit] Power stats pre-fetched');
      }
    })
    .catch(error => {
      if (isContextInvalidatedError(error)) {
        console.log('[Bangit] Extension context invalidated during prefetch');
      } else {
        console.error('[Bangit] Error pre-fetching power stats:', error);
      }
    });
}

/**
 * Pre-fetch user status (non-blocking, for cache warming)
 * This ensures eligibility checks on vote click are instant
 */
function prefetchUserStatus() {
  if (!isExtensionContextValid()) {
    return;
  }

  getUserStatus()
    .then(response => {
      if (response.success && response.data?.userStatus) {
        cachedUserStatus = response.data.userStatus;
        userStatusCacheTime = Date.now();
        console.log('[Bangit] User status pre-fetched');
      }
      // Also cache voting status for sybil detection
      if (response.success && response.data?.votingStatus) {
        cachedVotingStatus = response.data.votingStatus;
        console.log('[Bangit] Voting status pre-fetched');
      }
    })
    .catch(error => {
      if (!isContextInvalidatedError(error)) {
        console.error('[Bangit] Error pre-fetching user status:', error);
      }
    });
}

// Default power stats for instant modal open when no cache exists
const DEFAULT_POWER_STATS = {
  currentPower: 0,
  maxPower: 100,
  stakedTokens: 0
};

/**
 * Initialize the extension
 */
async function init() {
  console.log('[Bangit] Initializing tweet voting extension...');

  // Inject Rubik font
  injectFonts();

  // Initialize message listener
  initMessageListener();

  // Register auth status change handler
  registerHandler(MessageTypes.AUTH_STATUS_CHANGED, (message) => {
    updateState('auth', {
      isAuthenticated: message.isAuthenticated,
      currentUser: message.user
    });

    // Pre-fetch data when user logs in, clear caches on logout
    if (message.isAuthenticated) {
      prefetchUserPowerStats();
      prefetchUserStatus();
    } else {
      // Clear caches on logout
      invalidateUserStatusCache();
      updateState('power', { userStats: null, lastFetch: null });
    }

    // Update sidebar if loaded
    try {
      const sidebarFeature = loadLazyFeature('sidebar');
      sidebarFeature.then(module => {
        if (module.updateSidebarAuthState) {
          module.updateSidebarAuthState();
        }
      }).catch(() => {});
    } catch (e) {}

    // Refresh tweets to update button states
    tweetsFeature.refresh();

    return { success: true };
  });

  // Check authentication status
  try {
    console.log('[Bangit] Checking auth status...');
    const response = await getAuthStatus();
    updateState('auth', {
      isAuthenticated: response?.isAuthenticated || false,
      currentUser: response?.user || null
    });

    console.log('[Bangit] Auth status:', {
      isAuthenticated: getState().auth.isAuthenticated,
    });

    if (getState().auth.isAuthenticated) {
      console.log('[Bangit] User authenticated');
      // Pre-fetch power stats and user status for faster modal display
      prefetchUserPowerStats();
      prefetchUserStatus();
    } else {
      console.log('[Bangit] User not authenticated');
    }
  } catch (error) {
    console.error('[Bangit] Error checking auth status:', error);
  }

  // Register tweets feature
  registerFeature('tweets', tweetsFeature);

  // Start tweets feature with vote click handler
  // NOTE: We call start() directly with the handler instead of using startFeature()
  // because the lifecycle system doesn't support passing arguments to start()
  await tweetsFeature.start(handleVoteClick);

  // Start sidebar feature (always visible)
  try {
    await loadLazyFeature('sidebar');
    await startFeature('sidebar');
  } catch (error) {
    console.error('[Bangit] Error loading sidebar feature:', error);
  }

  // Start feed feature (handles both home page and navigation to home from other pages)
  try {
    const feedFeature = await loadLazyFeature('feed');
    // Pass vote click handler to feed feature
    if (feedFeature && feedFeature.start) {
      await feedFeature.start(handleVoteClick);
    }
  } catch (error) {
    console.error('[Bangit] Error loading feed feature:', error);
  }

  console.log('[Bangit] Extension initialized');
}

// Wait for DOM to be ready, then initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopAllFeatures();
  cleanupState();
});
