// Bangit - Tab injector for home feed
// Injects "Bangit" tab into X/Twitter's feed tab bar

import { getState, updateState } from '../../core/state.js';

/**
 * DOM selectors for X/Twitter elements
 */
const SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  homeTimeline: '[aria-label="Home timeline"]',
  tabList: '[role="tablist"][data-testid="ScrollSnap-List"]',
  tab: '[role="tab"]',
  activeTab: '[role="tab"][aria-selected="true"]',
  tabWrapper: '[role="presentation"]',
};

/**
 * Bangit tab element ID
 */
const BANGIT_TAB_ID = 'bangit-feed-tab';

/**
 * Hash used for URL state
 */
export const BANGIT_HASH = '#bangit';

/**
 * Check if we're on the home page (x.com/home or twitter.com/home)
 * @returns {boolean}
 */
export function isOnHomePage() {
  const pathname = window.location.pathname;
  return pathname === '/home' || pathname === '/';
}

/**
 * Check if Bangit tab is already injected
 * @returns {boolean}
 */
export function isTabInjected() {
  return !!document.getElementById(BANGIT_TAB_ID);
}

/**
 * Check if Bangit feed is currently active (based on URL hash)
 * @returns {boolean}
 */
export function isBangitActive() {
  return window.location.hash === BANGIT_HASH;
}

/**
 * Find the tab list element within the Home timeline
 * @returns {HTMLElement|null}
 */
function findTabList() {
  // First find the Home timeline container to ensure we target the correct tablist
  const homeTimeline = document.querySelector(SELECTORS.homeTimeline);
  if (!homeTimeline) {
    return null;
  }
  // Find the tablist within the Home timeline
  return homeTimeline.querySelector(SELECTORS.tabList);
}

/**
 * Find an existing tab to clone
 * @returns {HTMLElement|null}
 */
function findTabToClone() {
  const tabList = findTabList();
  if (!tabList) return null;

  // Find the first tab (usually "For you")
  const tabs = tabList.querySelectorAll(SELECTORS.tab);
  if (tabs.length === 0) return null;

  // Return the wrapper div that contains the tab
  return tabs[0].closest(SELECTORS.tabWrapper);
}

/**
 * Create the Bangit tab element by cloning an existing tab
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement|null}
 */
function createBangitTab(onClick) {
  const templateTab = findTabToClone();
  if (!templateTab) {
    console.warn('[Bangit] Could not find tab to clone');
    return null;
  }

  // Clone the tab structure
  const bangitTab = templateTab.cloneNode(true);
  bangitTab.id = BANGIT_TAB_ID;

  // Find the inner tab element
  const innerTab = bangitTab.querySelector('[role="tab"]');
  if (!innerTab) {
    console.warn('[Bangit] Could not find inner tab element');
    return null;
  }

  // Update text content with logo
  const textSpan = innerTab.querySelector('span');
  if (textSpan) {
    // Create logo image
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('media/bangitLogoNew-rounded-192x192.png');
    logo.alt = 'Bangit';
    logo.style.cssText = 'width: 18px; height: 18px; margin-left: 6px; border-radius: 4px; flex-shrink: 0;';

    // Clear span and add text + logo (logo on right)
    textSpan.textContent = '';
    textSpan.style.cssText = 'display: inline-flex; align-items: center; white-space: nowrap;';
    textSpan.appendChild(document.createTextNode('Bangit'));
    textSpan.appendChild(logo);
  }

  // Set as inactive by default
  innerTab.setAttribute('aria-selected', 'false');
  innerTab.setAttribute('tabindex', '-1');

  // Remove the active indicator (blue underline)
  const activeIndicator = bangitTab.querySelector('[style*="background-color: rgb(29, 155, 240)"]');
  if (activeIndicator) {
    activeIndicator.style.display = 'none';
  }

  // Add click handler
  innerTab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return bangitTab;
}

/**
 * Update tab visual state to show Bangit as active
 */
export function setTabActive() {
  const bangitTab = document.getElementById(BANGIT_TAB_ID);
  if (!bangitTab) return;

  const innerTab = bangitTab.querySelector('[role="tab"]');
  if (innerTab) {
    innerTab.setAttribute('aria-selected', 'true');
    innerTab.setAttribute('tabindex', '0');
  }

  // Show the active indicator
  const activeIndicator = bangitTab.querySelector('[style*="display: none"]');
  if (activeIndicator) {
    activeIndicator.style.display = '';
  }

  // Deactivate other tabs
  const tabList = findTabList();
  if (tabList) {
    tabList.querySelectorAll(SELECTORS.tab).forEach((tab) => {
      if (tab !== innerTab) {
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
      }
    });
  }
}

/**
 * Update tab visual state to show Bangit as inactive
 */
export function setTabInactive() {
  const bangitTab = document.getElementById(BANGIT_TAB_ID);
  if (!bangitTab) return;

  const innerTab = bangitTab.querySelector('[role="tab"]');
  if (innerTab) {
    innerTab.setAttribute('aria-selected', 'false');
    innerTab.setAttribute('tabindex', '-1');
  }

  // Hide the active indicator
  const activeIndicator = bangitTab.querySelector('[style*="background-color"]');
  if (activeIndicator && activeIndicator.style.backgroundColor === 'rgb(29, 155, 240)') {
    activeIndicator.style.display = 'none';
  }
}

/**
 * Inject the Bangit tab into the tab bar
 * @param {Function} onTabClick - Click handler for the tab
 * @returns {boolean} Whether injection was successful
 */
export function injectTab(onTabClick) {
  // Only inject on the home page
  if (!isOnHomePage()) {
    return false;
  }

  if (isTabInjected()) {
    console.log('[Bangit] Tab already injected');
    return true;
  }

  const tabList = findTabList();
  if (!tabList) {
    console.log('[Bangit] Tab list not found, will retry');
    return false;
  }

  const bangitTab = createBangitTab(onTabClick);
  if (!bangitTab) {
    console.warn('[Bangit] Failed to create Bangit tab');
    return false;
  }

  // Prepend to the tab list (Bangit tab should appear first, before "For you")
  tabList.prepend(bangitTab);

  // Scroll tab list to start to ensure Bangit tab is visible
  // Twitter uses scroll snap which may leave the list scrolled to show other tabs
  tabList.scrollLeft = 0;

  updateState('feed', { tabInjected: true });
  console.log('[Bangit] Tab injected successfully');

  // Sync visual state with URL
  if (isBangitActive()) {
    setTabActive();
  }

  return true;
}

/**
 * Remove the Bangit tab from the tab bar
 */
export function removeTab() {
  const bangitTab = document.getElementById(BANGIT_TAB_ID);
  if (bangitTab) {
    bangitTab.remove();
    updateState('feed', { tabInjected: false });
    console.log('[Bangit] Tab removed');
  }
}

/**
 * Add click handlers to native tabs to deactivate Bangit feed
 * @param {Function} onNativeTabClick - Handler when a native tab is clicked
 */
export function addNativeTabClickHandlers(onNativeTabClick) {
  const tabList = findTabList();
  if (!tabList) return;

  tabList.querySelectorAll(SELECTORS.tab).forEach((tab) => {
    // Skip if this is the Bangit tab
    if (tab.closest(`#${BANGIT_TAB_ID}`)) return;

    // Skip if already has our handler (prevent duplicate handlers)
    if (tab.dataset.bangitHandler) return;
    tab.dataset.bangitHandler = 'true';

    // Add click handler in capture phase to run before Twitter's handlers
    tab.addEventListener('click', (e) => {
      // Check if Bangit feed is currently active (check actual state, not hash)
      const state = getState();

      if (state.feed.active) {
        // Prevent Twitter's click handler from running
        // This avoids Twitter refreshing the feed when switching from Bangit
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Deactivate Bangit - native timeline is already visible underneath
        onNativeTabClick();
      }
      // If Bangit is not active, let Twitter handle the click normally
    }, true); // Use capture phase
  });
}

/**
 * Setup MutationObserver to re-inject tab when X re-renders
 * @param {Function} onTabClick - Click handler for the tab
 * @param {Function} onNativeTabClick - Handler when native tab is clicked
 * @param {Function} [onFirstInject] - Optional callback for first successful injection via observer
 * @returns {MutationObserver}
 */
export function setupTabObserver(onTabClick, onNativeTabClick, onFirstInject = null) {
  let hasInjectedViaObserver = false;

  const observer = new MutationObserver(() => {
    // Remove tab if we're no longer on the home page
    if (!isOnHomePage()) {
      if (isTabInjected()) {
        removeTab();
      }
      return;
    }

    // Check if tab needs re-injection (only on home page)
    if (!isTabInjected()) {
      const injected = injectTab(onTabClick);
      if (injected) {
        addNativeTabClickHandlers(onNativeTabClick);

        // On first successful injection via observer, sync state with URL
        if (!hasInjectedViaObserver && onFirstInject) {
          hasInjectedViaObserver = true;
          onFirstInject();
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Store observer in state for cleanup
  updateState('observers', { tabBar: observer });

  return observer;
}

/**
 * Disconnect the tab observer
 */
export function disconnectTabObserver() {
  const state = getState();
  if (state.observers.tabBar) {
    state.observers.tabBar.disconnect();
    updateState('observers', { tabBar: null });
  }
}
