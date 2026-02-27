// Bangit - Sidebar feature module
// Handles sidebar power and rewards buttons

import { getState, updateState } from '../../core/state.js';
import {
  tryInjectSidebarButtons,
  updateSidebarAuthState,
  removeSidebarButtons,
  setSidebarClickHandlers,
  fetchAndUpdateSidebarPower,
  updatePowerButtonDisplay
} from './buttons.js';
import { showLoginPrompt } from '../modals/login-prompt.js';
import { createPerformanceModal } from '../modals/performance-modal.js';
import { createRewardsModal } from '../modals/rewards-modal.js';

// Sidebar observer
let sidebarObserver = null;

/**
 * Handle power button click - show performance modal
 */
async function handlePowerClick() {
  const state = getState();

  if (!state.auth.isAuthenticated) {
    showLoginPrompt();
    return;
  }

  createPerformanceModal();
}

/**
 * Handle rewards button click - show rewards modal
 */
async function handleRewardsClick() {
  createRewardsModal();
}

/**
 * Set up MutationObserver to detect when Twitter's sidebar loads
 */
function setupSidebarObserver() {
  // Try to inject immediately if sidebar exists
  if (tryInjectSidebarButtons()) {
    return;
  }

  // Otherwise, observe for sidebar to appear
  sidebarObserver = new MutationObserver((mutations, observer) => {
    tryInjectSidebarButtons();
  });

  sidebarObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Sidebar feature - provides power and rewards buttons in Twitter sidebar
 */
const sidebarFeature = {
  async start() {
    console.log('[Bangit] Starting sidebar feature...');

    // Set click handlers
    setSidebarClickHandlers(handlePowerClick, handleRewardsClick);

    // Set up observer to inject buttons when sidebar appears
    setupSidebarObserver();

    console.log('[Bangit] Sidebar feature started');
  },

  async stop() {
    console.log('[Bangit] Stopping sidebar feature...');

    // Disconnect observer
    if (sidebarObserver) {
      sidebarObserver.disconnect();
      sidebarObserver = null;
    }

    // Remove sidebar buttons
    removeSidebarButtons();

    console.log('[Bangit] Sidebar feature stopped');
  },

  // Export functions for external use
  updateSidebarAuthState,
  fetchAndUpdateSidebarPower,
  updatePowerButtonDisplay
};

export default sidebarFeature;

// Also export individual functions
export { updateSidebarAuthState, fetchAndUpdateSidebarPower, updatePowerButtonDisplay };
