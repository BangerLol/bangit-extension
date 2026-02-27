import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import LoadingState from './components/LoadingState.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import Dashboard from './components/Dashboard.jsx';

// Popup app without Privy (Privy runs in options page only)
export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  // Check auth status on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })
      .then((response) => {
        setIsAuthenticated(response?.isAuthenticated || false);
        setUser(response?.user || null);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[Bangit] Error checking auth:', err);
        setIsLoading(false);
      });
  }, []);

  // Listen for auth changes from background
  useEffect(() => {
    function handleMessage(message) {
      if (message.type === 'AUTH_STATUS_CHANGED') {
        setIsAuthenticated(message.isAuthenticated || false);
        setUser(message.user || null);
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleLogin = useCallback(() => {
    // Open the options page for Privy authentication
    chrome.runtime.openOptionsPage(() => {
      // Close popup only after options page is opened
      window.close();
    });
  }, []);

  const handleLogout = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  return (
    <div className="popup-container">
      {isAuthenticated && <Header />}

      {isLoading ? (
        <LoadingState />
      ) : !isAuthenticated ? (
        <LoginScreen onLogin={handleLogin} />
      ) : (
        <Dashboard user={user} onLogout={handleLogout} />
      )}

      <Footer />
    </div>
  );
}
