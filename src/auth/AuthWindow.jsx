import React, { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy, useLogin, getIdentityToken } from '@privy-io/react-auth';
import { useCreateWallet } from '@privy-io/react-auth/solana';

const PRIVY_APP_ID = 'cmald9h5q02oujo0mvw3azkdz';
const PRIVY_CLIENT_ID = 'client-WY6LHzDPgqiWp5w1j3p4Dy7gnSupQrYQ5QYabtWNw2c1Z';
const WALLET_REQUIRED_ERROR = 'WALLET_REQUIRED';

function formatAuthError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  if (message === WALLET_REQUIRED_ERROR) {
    return 'Wallet creation is required to complete login. Please try again.';
  }

  return message || 'Failed to complete login';
}

function AuthContent() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { createWallet } = useCreateWallet();
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState(null);

  // Helper to send auth data to background script
  const sendAuthToBackground = async (privyUser, accessToken) => {
    const twitterAccount = privyUser.linkedAccounts?.find(
      (account) => account.type === 'twitter_oauth'
    );

    if (!twitterAccount) {
      throw new Error('No Twitter account found. Please try again.');
    }

    // Extract existing Solana wallet or create one
    let walletAddress = null;
    const existingWallet = privyUser.linkedAccounts?.find(
      (account) => account.type === 'wallet' && account.chainType === 'solana'
    );
    if (existingWallet) {
      walletAddress = existingWallet.address;
    } else {
      if (!createWallet) {
        throw new Error(WALLET_REQUIRED_ERROR);
      }

      try {
        const newWallet = await createWallet();
        walletAddress = newWallet?.wallet?.address || null;
      } catch (error) {
        console.error('[Bangit Auth Window] Failed to create wallet:', error);
        throw new Error(WALLET_REQUIRED_ERROR);
      }
    }

    if (!walletAddress) {
      throw new Error(WALLET_REQUIRED_ERROR);
    }

    // Get identity token for server-side Twitter ownership verification
    let identityToken = null;
    try {
      identityToken = await getIdentityToken();
    } catch (e) {
      console.warn('[Bangit Auth Window] Failed to get identity token:', e);
    }

    const response = await chrome.runtime.sendMessage({
      type: 'SET_AUTH',
      privyId: privyUser.id,
      privyUser: privyUser,
      twitterAccount: {
        subject: twitterAccount.subject,
        username: twitterAccount.username,
        name: twitterAccount.name,
        profilePictureUrl: twitterAccount.profilePictureUrl,
      },
      accessToken: accessToken, // Real JWT access token
      identityToken, // Identity token for Twitter ownership verification
      walletAddress,
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to save auth');
    }

    return response;
  };

  const { login } = useLogin({
    onComplete: async ({ user }) => {
      console.log('[Bangit Auth Window] Login complete');
      setStatus('syncing');

      try {
        // Get the actual JWT access token (not just user.id)
        const accessToken = await getAccessToken();
        console.log('[Bangit Auth Window] Got access token:', accessToken ? 'yes' : 'no');

        if (!accessToken) {
          throw new Error('Failed to get access token');
        }

        await sendAuthToBackground(user, accessToken);

        console.log('[Bangit Auth Window] Auth saved, opening popup');
        setStatus('success');
        // Brief delay to show success, then open popup and close this tab
        setTimeout(async () => {
          try {
            // Open the extension popup (requires user gesture or recent interaction)
            await chrome.action.openPopup();
          } catch (e) {
            console.log('[Bangit Auth Window] Could not open popup:', e.message);
          }
          // Close this options page tab
          window.close();
        }, 1000);
      } catch (err) {
        console.error('[Bangit Auth Window] Error saving auth:', err);
        setError(formatAuthError(err));
        setStatus('error');
      }
    },
    onError: (err) => {
      console.error('[Bangit Auth Window] Login error:', err);
      setError(formatAuthError(err));
      setStatus('error');
    },
  });

  // Auto-trigger login when ready
  useEffect(() => {
    if (ready && !authenticated && status === 'initializing') {
      setStatus('logging_in');
      login();
    }
  }, [ready, authenticated, status, login]);

  // Handle already authenticated case
  useEffect(() => {
    if (ready && authenticated && user && status === 'initializing') {
      // User is already authenticated with Privy, sync with background
      setStatus('syncing');

      (async () => {
        try {
          // Get fresh access token (auto-refreshes if expired)
          const accessToken = await getAccessToken();
          console.log('[Bangit Auth Window] Already authenticated, got token:', accessToken ? 'yes' : 'no');

          if (!accessToken) {
            throw new Error('Failed to get access token');
          }

          await sendAuthToBackground(user, accessToken);

          setStatus('success');
          setTimeout(async () => {
            try {
              await chrome.action.openPopup();
            } catch (e) {
              console.log('[Bangit Auth Window] Could not open popup:', e.message);
            }
            window.close();
          }, 1000);
        } catch (err) {
          console.error('[Bangit Auth Window] Error syncing auth:', err);
          setError(formatAuthError(err));
          setStatus('error');
        }
      })();
    }
  }, [ready, authenticated, user, status, getAccessToken]);

  const handleRetry = () => {
    setError(null);
    setStatus('logging_in');
    login();
  };

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="auth-window">
      <div className="auth-content">
        <img src="media/bangitLogoNew-rounded-192x192.png" width="64" height="64" alt="Bangit" />

        {status === 'initializing' && (
          <>
            <h2>Initializing...</h2>
            <div className="spinner"></div>
          </>
        )}

        {status === 'logging_in' && (
          <>
            <h2>Connecting to X...</h2>
            <p>Complete the authentication in the popup window.</p>
            <div className="spinner"></div>
          </>
        )}

        {status === 'syncing' && (
          <>
            <h2>Saving login...</h2>
            <div className="spinner"></div>
          </>
        )}

        {status === 'success' && (
          <>
            <h2>Login successful!</h2>
            <p>You can close this window.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2>Login failed</h2>
            <p className="error-message">{error}</p>
            <div className="auth-buttons">
              <button className="primary-btn" onClick={handleRetry}>
                Try Again
              </button>
              <button className="secondary-btn" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthWindow() {
  const privyConfig = {
    loginMethods: ['twitter'],
    appearance: {
      theme: 'dark',
      accentColor: '#f2c1fb',
    },
    externalWallets: {
      enabled: false,
    },
    captchaEnabled: false
  };

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={privyConfig}
    >
      <AuthContent />
    </PrivyProvider>
  );
}
