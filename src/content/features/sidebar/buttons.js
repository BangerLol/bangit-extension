// Bangit - Sidebar buttons injection (native nav item cloning)

import { getState, updateState } from '../../core/state.js';
import { getUserPower } from '../../core/rpc.js';
import { formatSidebarNumber, calculateTimeToMidnightUTC } from '../../core/utils.js';
import { CONFIG } from '../../core/config.js';

// Module state
let sidebarButtonsInjected = false;
let countdownInterval = null;
let cachedPowerData = null;
let powerDataLastFetch = null;
let powerRefreshInterval = null;
let visibilityHandler = null;
let sidebarModeObserver = null;
let reinjectDebounceTimer = null;

// Click handlers (set by feature init)
let onPowerClick = null;
let onRewardsClick = null;

/**
 * Set click handlers for sidebar buttons
 */
export function setSidebarClickHandlers(powerHandler, rewardsHandler) {
  onPowerClick = powerHandler;
  onRewardsClick = rewardsHandler;
}

/**
 * Start countdown timer for rewards button
 */
export function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);

  function updateCountdown() {
    const countdownEl = document.querySelector('.bangit-sidebar-countdown');
    if (countdownEl) {
      const time = calculateTimeToMidnightUTC();
      countdownEl.textContent = time.formatted;
    }
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

/**
 * Stop countdown timer
 */
export function stopCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

/**
 * Start power refresh interval (refreshes every 30 seconds)
 */
export function startPowerRefreshInterval() {
  if (powerRefreshInterval) clearInterval(powerRefreshInterval);

  powerRefreshInterval = setInterval(() => {
    const state = getState();
    if (state.auth.isAuthenticated) {
      fetchAndUpdateSidebarPower(true); // force refresh
    }
  }, CONFIG.POWER_CACHE_TTL); // 30 seconds
}

/**
 * Stop power refresh interval
 */
export function stopPowerRefreshInterval() {
  if (powerRefreshInterval) {
    clearInterval(powerRefreshInterval);
    powerRefreshInterval = null;
  }
}

/**
 * Pause sidebar timers when tab is hidden
 */
function setupVisibilityMonitoring() {
  if (visibilityHandler) return;

  visibilityHandler = () => {
    if (document.hidden) {
      stopCountdownTimer();
      stopPowerRefreshInterval();
      return;
    }

    // Resume timers when visible
    startCountdownTimer();
    const state = getState();
    if (state.auth.isAuthenticated && document.querySelector('#bangit-nav-performance')) {
      fetchAndUpdateSidebarPower();
      startPowerRefreshInterval();
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);
}

function teardownVisibilityMonitoring() {
  if (!visibilityHandler) return;
  document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
}

/**
 * Fetch and update power data for sidebar button
 */
export async function fetchAndUpdateSidebarPower(force = false) {
  // Check cache
  if (!force && cachedPowerData && powerDataLastFetch &&
      (Date.now() - powerDataLastFetch < CONFIG.POWER_CACHE_TTL)) {
    updatePowerButtonDisplay(cachedPowerData);
    return cachedPowerData;
  }

  try {
    const response = await getUserPower();
    if (response.success) {
      cachedPowerData = response.data;
      powerDataLastFetch = Date.now();
      updatePowerButtonDisplay(response.data);
      return response.data;
    }
  } catch (error) {
    console.error('[Bangit] Error fetching power data for sidebar:', error);
  }
  return null;
}

/**
 * Update power button display with current data
 * (No-op in nav item mode since we only show emoji + label)
 */
export function updatePowerButtonDisplay(powerData) {
  // Nav items only show emoji + label, no power bar
}

/**
 * Clone a nav item <a> element and customize it for Bangit.
 * Twitter's sidebar structure: nav[role="navigation"] > a[role="link"] (direct children).
 * Each <a> contains: div > [div with svg, div with span label].
 */
function createNavItem(templateLink, { id, emoji, label, onClick }) {
  const clone = templateLink.cloneNode(true);
  clone.classList.add('bangit-nav-item');
  clone.id = id;

  // The clone IS the <a> element - modify it directly
  clone.removeAttribute('href');
  clone.removeAttribute('data-testid');
  clone.removeAttribute('aria-label');
  clone.setAttribute('role', 'button');
  clone.style.cssText = 'cursor: pointer; width: 100%; display: flex; margin-top: 4px; box-sizing: border-box;';

  // Make inner div stretch to full width (match Post button width)
  const innerDiv = clone.querySelector(':scope > div');
  if (innerDiv) {
    innerDiv.style.cssText += '; flex: 1 1 auto; width: 100%; border: 2px solid #f2c1fb; border-radius: 9999px; justify-content: flex-start; padding: 12px 10px;';
  }

  clone.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  // Replace the SVG icon with our emoji
  const svg = clone.querySelector('svg');
  if (svg) {
    const iconWrapper = svg.parentElement;
    const emojiSpan = document.createElement('span');
    emojiSpan.textContent = emoji;
    emojiSpan.className = 'bangit-nav-emoji';
    iconWrapper.replaceChild(emojiSpan, svg);
    // Match native SVG intrinsic size so parent containers size identically
    iconWrapper.style.cssText = 'width: 26.25px; height: 26.25px; display: flex; align-items: center; justify-content: center;';
  }

  // Replace label text in spans (skip the emoji span we just created)
  // In compact sidebar mode, Twitter omits the label div entirely — that's fine,
  // our cloned items will be icon-only too.
  const spans = clone.querySelectorAll('span:not(.bangit-nav-emoji)');
  let labelSet = false;
  for (const span of spans) {
    if (!span.querySelector('span')) {
      if (!labelSet) {
        span.textContent = label;
        labelSet = true;
      } else {
        span.textContent = '';
      }
    }
  }

  // Remove any notification badges/counts (but not the clone itself)
  const badges = clone.querySelectorAll('[aria-label]');
  for (const badge of badges) {
    badge.remove();
  }

  return clone;
}

/**
 * Watch the Chat nav item for structural DOM changes (label added/removed)
 * which indicates the sidebar toggled between expanded and collapsed modes.
 * When detected, re-clone from the updated template so our items match.
 */
function setupSidebarModeObserver() {
  if (sidebarModeObserver) return;

  const nav = document.querySelector('nav[role="navigation"]');
  if (!nav) return;

  const chatLink = nav.querySelector('[data-testid="AppTabBar_DirectMessage_Link"]');
  if (!chatLink) return;

  sidebarModeObserver = new MutationObserver((mutations) => {
    // Only react to childList changes (structural: label added/removed on mode toggle)
    const hasStructuralChange = mutations.some(m => m.type === 'childList');
    if (!hasStructuralChange) return;

    if (reinjectDebounceTimer) clearTimeout(reinjectDebounceTimer);
    reinjectDebounceTimer = setTimeout(reinjectSidebarButtons, 200);
  });

  sidebarModeObserver.observe(chatLink, { childList: true, subtree: true });
}

function teardownSidebarModeObserver() {
  if (sidebarModeObserver) {
    sidebarModeObserver.disconnect();
    sidebarModeObserver = null;
  }
  if (reinjectDebounceTimer) {
    clearTimeout(reinjectDebounceTimer);
    reinjectDebounceTimer = null;
  }
}

/**
 * Re-inject sidebar buttons by removing stale clones and creating fresh ones
 * from the current template (which Twitter has already updated for the new mode).
 */
function reinjectSidebarButtons() {
  const container = document.querySelector('.bangit-sidebar-buttons');
  if (!container) return;

  // Tear down observer first to avoid triggering on our own DOM changes
  teardownSidebarModeObserver();

  // Remove stale items
  container.remove();
  sidebarButtonsInjected = false;

  // Stop timers (tryInjectSidebarButtons will restart them)
  stopCountdownTimer();
  stopPowerRefreshInterval();

  // Re-inject with fresh clones from the current sidebar mode
  tryInjectSidebarButtons();
}

/**
 * Try to inject sidebar buttons as native nav items
 * @returns {boolean} True if successful
 */
export function tryInjectSidebarButtons() {
  const state = getState();

  // Check if already injected
  if (document.querySelector('.bangit-sidebar-buttons')) {
    return true;
  }

  // Find Twitter's sidebar nav
  const nav = document.querySelector('nav[role="navigation"]');
  if (!nav) return false;

  // Find the Chat nav item (<a> is a direct child of <nav>)
  const chatLink = nav.querySelector('[data-testid="AppTabBar_DirectMessage_Link"]');
  if (!chatLink) return false;

  // Create a wrapper container for our items (for easy removal)
  // Use display:contents so children flow as siblings in the nav
  const container = document.createElement('div');
  container.className = 'bangit-sidebar-buttons';

  // Build nav items based on auth state - clone chatLink directly
  if (state.auth.isAuthenticated) {
    container.appendChild(createNavItem(chatLink, {
      id: 'bangit-nav-performance',
      emoji: '\u26A1',
      label: 'Performance',
      onClick: () => onPowerClick?.(),
    }));
  }

  container.appendChild(createNavItem(chatLink, {
    id: 'bangit-nav-rewards',
    emoji: '\uD83C\uDF81',
    label: 'Rewards',
    onClick: () => onRewardsClick?.(),
  }));

  // Insert after the Chat link in the nav
  chatLink.insertAdjacentElement('afterend', container);

  // Start timers
  startCountdownTimer();
  if (state.auth.isAuthenticated) {
    fetchAndUpdateSidebarPower();
    startPowerRefreshInterval();
  }
  setupVisibilityMonitoring();
  setupSidebarModeObserver();

  sidebarButtonsInjected = true;
  console.log('[Bangit] Sidebar nav items injected');
  return true;
}

/**
 * Update sidebar buttons based on auth state change
 */
export function updateSidebarAuthState() {
  const state = getState();
  const container = document.querySelector('.bangit-sidebar-buttons');

  if (!container) {
    tryInjectSidebarButtons();
    return;
  }

  const existingPerf = container.querySelector('#bangit-nav-performance');

  if (state.auth.isAuthenticated && !existingPerf) {
    // Need to add performance nav item - clone from Chat link
    const nav = document.querySelector('nav[role="navigation"]');
    const chatLink = nav?.querySelector('[data-testid="AppTabBar_DirectMessage_Link"]');
    if (chatLink) {
      const perfItem = createNavItem(chatLink, {
        id: 'bangit-nav-performance',
        emoji: '\u26A1',
        label: 'Performance',
        onClick: () => onPowerClick?.(),
      });
      // Insert as first child (before rewards)
      container.insertBefore(perfItem, container.firstChild);
    }

    fetchAndUpdateSidebarPower();
    startPowerRefreshInterval();
  } else if (!state.auth.isAuthenticated && existingPerf) {
    stopPowerRefreshInterval();
    existingPerf.remove();
    cachedPowerData = null;
    powerDataLastFetch = null;
  }
}

/**
 * Remove sidebar buttons and cleanup
 */
export function removeSidebarButtons() {
  const container = document.querySelector('.bangit-sidebar-buttons');
  if (container) {
    container.remove();
  }

  stopCountdownTimer();
  stopPowerRefreshInterval();
  teardownVisibilityMonitoring();
  teardownSidebarModeObserver();

  sidebarButtonsInjected = false;
  cachedPowerData = null;
  powerDataLastFetch = null;
}
