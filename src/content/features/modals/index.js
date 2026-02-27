// Bangit - Modals feature module
// Provides toast, login prompt, restriction modal, sybil modal, performance modal, and rewards modal

import { showToast } from './toast.js';
import { showLoginPrompt } from './login-prompt.js';
import { showRestrictionModal, closeRestrictionModal } from './restriction-modal.js';
import { showSybilModal, closeSybilModal } from './sybil-modal.js';
import { createPerformanceModal, closePerformanceModal } from './performance-modal.js';
import { createRewardsModal, closeRewardsModal } from './rewards-modal.js';

/**
 * Modals feature - provides UI notification and modal components
 */
const modalsFeature = {
  async start() {
    console.log('[Bangit] Modals feature started');
  },

  async stop() {
    // Remove any open modals
    closePerformanceModal();
    closeRewardsModal();
    closeRestrictionModal();
    closeSybilModal();
    document.querySelectorAll('.bangit-login-prompt, .bangit-toast').forEach(el => el.remove());
    console.log('[Bangit] Modals feature stopped');
  },

  // Export functions for external use
  showToast,
  showLoginPrompt,
  showRestrictionModal,
  closeRestrictionModal,
  showSybilModal,
  closeSybilModal,
  createPerformanceModal,
  closePerformanceModal,
  createRewardsModal,
  closeRewardsModal
};

export default modalsFeature;

// Also export individual functions
export { showToast, showLoginPrompt };
export { showRestrictionModal, closeRestrictionModal } from './restriction-modal.js';
export { showSybilModal, closeSybilModal } from './sybil-modal.js';
export { createPerformanceModal, closePerformanceModal } from './performance-modal.js';
export { createRewardsModal, closeRewardsModal } from './rewards-modal.js';
