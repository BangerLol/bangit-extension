import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLogout } from '@privy-io/react-auth';

const PRIVY_APP_ID = 'cmald9h5q02oujo0mvw3azkdz';
const PRIVY_CLIENT_ID = 'client-WY6LHzDPgqiWp5w1j3p4Dy7gnSupQrYQ5QYabtWNw2c1Z';
const TOKEN_REFRESH_MAX_ATTEMPTS = 4;
const TOKEN_REFRESH_BASE_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessTokenWithBackoff(getAccessTokenFn, maxAttempts = TOKEN_REFRESH_MAX_ATTEMPTS, baseDelayMs = TOKEN_REFRESH_BASE_DELAY_MS) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const accessToken = await getAccessTokenFn();
      if (accessToken) {
        return { accessToken, attempts: attempt };
      }
      lastError = 'No token returned';
    } catch (error) {
      lastError = error?.message || 'Failed to refresh token';
    }

    if (attempt < maxAttempts) {
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      console.warn('[Bangit Offscreen] Token refresh attempt failed, retrying...', {
        attempt,
        maxAttempts,
        delayMs,
        error: lastError,
      });
      await sleep(delayMs);
    }
  }

  return { accessToken: null, attempts: maxAttempts, error: lastError };
}

function TokenRefresher() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { logout } = useLogout();
  const authRef = useRef({ authenticated: false, user: null, getAccessToken: null, logout: null });
  const readyRef = useRef(false);

  useEffect(() => {
    authRef.current = { authenticated, user, getAccessToken, logout };
  }, [authenticated, user, getAccessToken, logout]);

  useEffect(() => {
    if (ready) {
      readyRef.current = true;
      console.log('[Bangit Offscreen] Privy ready, authenticated:', authenticated);

      // Notify background that we're ready
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_READY',
        authenticated: authenticated,
        userId: user?.id || null,
      });
    }
  }, [ready, authenticated, user]);

  useEffect(() => {
    const waitForPrivyReady = (timeoutMs = 3000, intervalMs = 100) => new Promise(resolve => {
      if (readyRef.current) {
        resolve(true);
        return;
      }

      const start = Date.now();
      const timer = setInterval(() => {
        if (readyRef.current) {
          clearInterval(timer);
          resolve(true);
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, intervalMs);
    });

    const handleMessage = (message, sender, sendResponse) => {
      const {
        authenticated: currentAuthenticated,
        user: currentUser,
        getAccessToken: currentGetAccessToken,
        logout: currentLogout,
      } = authRef.current;

      // Token refresh handling
      if (message.type === 'REFRESH_TOKEN') {
        console.log('[Bangit Offscreen] Token refresh requested');

        (async () => {
          if (!readyRef.current) {
            console.log('[Bangit Offscreen] Privy not ready, waiting briefly...');
            const readyNow = await waitForPrivyReady();
            if (!readyNow) {
              console.log('[Bangit Offscreen] Still not ready after wait');
              sendResponse({ success: false, error: 'Privy not ready' });
              return;
            }
          }

          if (!currentAuthenticated) {
            console.log('[Bangit Offscreen] Not authenticated (attempting token fetch anyway)');
          }

          try {
            if (typeof currentGetAccessToken !== 'function') {
              console.log('[Bangit Offscreen] Privy access token function unavailable');
              sendResponse({ success: false, error: 'Privy not ready' });
              return;
            }

            // getAccessToken() auto-refreshes when needed; use backoff to handle
            // transient "invalid auth token" windows during refresh propagation.
            const { accessToken, attempts, error } = await getAccessTokenWithBackoff(currentGetAccessToken);

            if (accessToken) {
              console.log('[Bangit Offscreen] Token refreshed successfully', { attempts });
              sendResponse({
                success: true,
                accessToken: accessToken,
                userId: currentUser?.id,
              });
            } else {
              console.log('[Bangit Offscreen] No token returned');
              sendResponse({ success: false, error: error || 'No token returned', requiresLogin: true });
            }
          } catch (err) {
            console.error('[Bangit Offscreen] Token refresh error:', err);
            sendResponse({ success: false, error: err.message, requiresLogin: true });
          }
        })();

        return true; // Keep channel open for async
      }

      if (message.type === 'PRIVY_LOGOUT') {
        console.log('[Bangit Offscreen] Privy logout requested');

        (async () => {
          if (!readyRef.current) {
            console.log('[Bangit Offscreen] Privy not ready, waiting briefly...');
            const readyNow = await waitForPrivyReady();
            if (!readyNow) {
              console.log('[Bangit Offscreen] Still not ready after wait');
              sendResponse({ success: false, error: 'Privy not ready' });
              return;
            }
          }

          try {
            if (typeof currentLogout !== 'function') {
              sendResponse({ success: false, error: 'Privy logout unavailable' });
              return;
            }

            await currentLogout();
            sendResponse({ success: true });
          } catch (err) {
            console.error('[Bangit Offscreen] Privy logout error:', err);
            sendResponse({ success: false, error: err.message || 'Failed to logout' });
          }
        })();

        return true; // Keep channel open for async
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  return null; // No UI needed
}

function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        loginMethods: ['twitter'],
        appearance: {
          theme: 'dark',
        },
        externalWallets: {
          enabled: false,
        },
        captchaEnabled: false,
      }}
    >
      <TokenRefresher />
    </PrivyProvider>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
