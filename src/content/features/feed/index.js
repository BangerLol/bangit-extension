// Bangit - Feed feature module
// Handles the custom Bangit tab and curated feeds on twitter.com/x.com home page

import { getState, updateState } from '../../core/state.js';
import {
  injectTab,
  removeTab,
  setupTabObserver,
  disconnectTabObserver,
  isBangitActive,
  setTabActive,
  setTabInactive,
  addNativeTabClickHandlers,
  BANGIT_HASH,
} from './tab-injector.js';
import {
  activateFeed,
  deactivateFeed,
  cleanup,
  setVoteClickHandler,
} from './timeline.js';
import {
  startRealtimeHandlers,
  stopRealtimeHandlers,
  clearScores,
} from './realtime.js';

/**
 * Path monitoring interval reference
 */
let pathMonitorInterval = null;

/**
 * Tab injection retry interval
 */
let tabInjectionRetryInterval = null;

/**
 * Last known pathname
 */
let lastPathname = null;

/**
 * Visibility change handler reference
 */
let visibilityHandler = null;

/**
 * Check if currently on home page
 * @returns {boolean}
 */
function isOnHomePage() {
  const path = window.location.pathname;
  return path === '/' || path === '/home';
}

/**
 * Handle Bangit tab click
 */
function handleTabClick() {
  const state = getState();

  // Check actual feed state, not just URL hash
  // (hash may still be #bangit even when feed is hidden after switching to native tab)
  if (state.feed.active) {
    // Already active, do nothing
    return;
  }

  // Activate the feed
  setTabActive();
  activateFeed();

  // Update URL hash if not already set
  if (window.location.hash !== BANGIT_HASH) {
    window.location.hash = BANGIT_HASH;
  }
}

/**
 * Handle native tab click (For you, Following, etc.)
 */
function handleNativeTabClick() {
  const state = getState();

  // Check actual feed state, not just URL hash
  if (!state.feed.active) {
    // Bangit not active, do nothing
    return;
  }

  // Deactivate Bangit feed
  deactivateFeed();
  setTabInactive();

  // Remove #bangit hash from URL using replaceState to avoid adding history entry
  // This ensures back navigation returns to the correct feed
  if (window.location.hash === BANGIT_HASH) {
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url || '/');
  }
}

/**
 * Retry interval for feed activation
 */
let activationRetryInterval = null;

/**
 * Sync state from URL hash
 */
async function syncFromHash() {
  const active = isBangitActive();

  if (active) {
    setTabActive();
    await activateFeed();

    // Check if activation succeeded (timeline parent might not be ready yet)
    const state = getState();
    if (!state.feed.active && !activationRetryInterval) {
      // Set up retry interval to wait for timeline to be ready
      console.log('[Bangit] Feed activation pending, setting up retry');
      activationRetryInterval = setInterval(async () => {
        if (!isBangitActive()) {
          // Hash changed, stop retrying
          clearInterval(activationRetryInterval);
          activationRetryInterval = null;
          return;
        }

        await activateFeed();
        const currentState = getState();
        if (currentState.feed.active) {
          // Success, stop retrying
          console.log('[Bangit] Feed activation succeeded on retry');
          clearInterval(activationRetryInterval);
          activationRetryInterval = null;
        }
      }, 200);
    }
  } else {
    // Clear any pending retry
    if (activationRetryInterval) {
      clearInterval(activationRetryInterval);
      activationRetryInterval = null;
    }

    setTabInactive();
    const state = getState();
    if (state.feed.active) {
      deactivateFeed();
    }
  }
}

/**
 * Handle hash change event
 */
function handleHashChange() {
  console.log('[Bangit] Hash changed:', window.location.hash);
  syncFromHash();
}

/**
 * Clear tab injection retry interval
 */
function clearTabInjectionRetry() {
  if (tabInjectionRetryInterval) {
    clearInterval(tabInjectionRetryInterval);
    tabInjectionRetryInterval = null;
  }
}

/**
 * Handle path change (SPA navigation)
 */
function handlePathChange() {
  const currentPath = window.location.pathname;

  if (currentPath === lastPathname) {
    return;
  }

  console.log('[Bangit] Path changed:', lastPathname, '->', currentPath);
  lastPathname = currentPath;

  if (!isOnHomePage()) {
    // Navigated away from home - cleanup
    clearTabInjectionRetry();
    cleanup();
    removeTab();
  } else {
    // Navigated to home - try to inject tab
    const injected = injectTab(handleTabClick);
    if (injected) {
      addNativeTabClickHandlers(handleNativeTabClick);
      syncFromHash();
    } else if (!tabInjectionRetryInterval) {
      // Tab list not ready yet, set up retry interval
      // Twitter's SPA navigation may render the tablist after initial page load
      console.log('[Bangit] Tab list not ready, setting up injection retry');
      let retryCount = 0;
      const maxRetries = 20; // 20 retries * 200ms = 4 seconds max

      tabInjectionRetryInterval = setInterval(() => {
        retryCount++;

        // Stop if no longer on home page
        if (!isOnHomePage()) {
          clearTabInjectionRetry();
          return;
        }

        const success = injectTab(handleTabClick);
        if (success) {
          console.log('[Bangit] Tab injection succeeded on retry', retryCount);
          addNativeTabClickHandlers(handleNativeTabClick);
          syncFromHash();
          clearTabInjectionRetry();
        } else if (retryCount >= maxRetries) {
          console.warn('[Bangit] Tab injection failed after', maxRetries, 'retries');
          clearTabInjectionRetry();
        }
      }, 200);
    }
  }
}

/**
 * Start path monitoring for SPA navigation
 */
function startPathMonitor() {
  if (pathMonitorInterval) return;
  lastPathname = window.location.pathname;
  pathMonitorInterval = setInterval(handlePathChange, 1000);
}

/**
 * Stop path monitoring
 */
function stopPathMonitor() {
  if (pathMonitorInterval) {
    clearInterval(pathMonitorInterval);
    pathMonitorInterval = null;
  }
}

/**
 * Feed feature - provides custom Bangit feed tab
 */
const feedFeature = {
  /**
   * Start the feed feature
   * @param {Function} voteClickHandler - Handler for vote button clicks
   */
  async start(voteClickHandler) {
    console.log('[Bangit] Starting feed feature...');

    // Set vote click handler for timeline rendering
    setVoteClickHandler(voteClickHandler);

    // Setup hash change listener
    window.addEventListener('hashchange', handleHashChange);

    // Start path monitoring for SPA navigation - always needed to detect navigation to home
    startPathMonitor();

    // Pause polling and retries when tab is hidden
    if (!visibilityHandler) {
      visibilityHandler = () => {
        if (document.hidden) {
          stopPathMonitor();
          clearTabInjectionRetry();
          if (activationRetryInterval) {
            clearInterval(activationRetryInterval);
            activationRetryInterval = null;
          }
        } else {
          // Force a resync on return
          lastPathname = null;
          startPathMonitor();
          handlePathChange();
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    // Start real-time WebSocket handlers for feed updates
    startRealtimeHandlers();

    if (!isOnHomePage()) {
      console.log('[Bangit] Not on home page, feed feature will activate on navigation to home');
      // Setup observer anyway so it's ready when user navigates to home
      setupTabObserver(handleTabClick, handleNativeTabClick, syncFromHash);
      console.log('[Bangit] Feed feature started (waiting for home page)');
      return;
    }

    // Setup MutationObserver for tab re-injection
    // Pass syncFromHash as callback for when observer successfully injects tab
    setupTabObserver(handleTabClick, handleNativeTabClick, syncFromHash);

    // Initial tab injection with retry if tab list not ready
    const injected = injectTab(handleTabClick);
    if (injected) {
      addNativeTabClickHandlers(handleNativeTabClick);
      // Only sync if initial injection succeeded
      // If injection failed, observer will sync when it succeeds
      syncFromHash();
    } else if (!tabInjectionRetryInterval) {
      // Tab list may not be rendered yet on initial load, set up retry
      console.log('[Bangit] Tab list not ready on start, setting up injection retry');
      let retryCount = 0;
      const maxRetries = 20;

      tabInjectionRetryInterval = setInterval(() => {
        retryCount++;

        if (!isOnHomePage()) {
          clearTabInjectionRetry();
          return;
        }

        const success = injectTab(handleTabClick);
        if (success) {
          console.log('[Bangit] Initial tab injection succeeded on retry', retryCount);
          addNativeTabClickHandlers(handleNativeTabClick);
          syncFromHash();
          clearTabInjectionRetry();
        } else if (retryCount >= maxRetries) {
          console.warn('[Bangit] Initial tab injection failed after', maxRetries, 'retries');
          clearTabInjectionRetry();
        }
      }, 200);
    }

    console.log('[Bangit] Feed feature started');
  },

  /**
   * Stop the feed feature
   */
  async stop() {
    console.log('[Bangit] Stopping feed feature...');

    // Stop real-time WebSocket handlers
    stopRealtimeHandlers();

    // Clear any pending retries
    if (activationRetryInterval) {
      clearInterval(activationRetryInterval);
      activationRetryInterval = null;
    }
    clearTabInjectionRetry();

    // Remove event listeners
    window.removeEventListener('hashchange', handleHashChange);

    // Stop path monitoring
    stopPathMonitor();

    // Remove visibility handler
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }

    // Disconnect observers
    disconnectTabObserver();

    // Cleanup feed and tab
    cleanup();
    removeTab();

    console.log('[Bangit] Feed feature stopped');
  },

  /**
   * Refresh the feed (reload data)
   */
  async refresh() {
    const state = getState();
    if (state.feed.active) {
      // Clear existing tweets, scores, and reload
      clearScores();
      updateState('feed', {
        tweetIds: [],
        cursor: null,
        hasMore: true,
      });

      const feedContent = document.querySelector('.bangit-feed-content');
      if (feedContent) {
        feedContent.innerHTML = '';
      }

      const { loadFeed } = await import('./timeline.js');
      await loadFeed();
    }
  },
};

export default feedFeature;

// Export for direct access if needed
export { activateFeed, deactivateFeed };
