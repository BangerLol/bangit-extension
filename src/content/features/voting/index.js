// Bangit - Voting feature module
// Handles vote power selection and execution

import { createPowerSelector, closePowerSelector, updateOpenModalPowerStats } from './power-selector.js';
import { createRefillPowerModal, closeRefillModal } from './refill-modal.js';
import { executeVote } from './vote-handler.js';

/**
 * Voting feature - provides vote UI and execution
 */
const votingFeature = {
  async start() {
    console.log('[Bangit] Voting feature started');
  },

  async stop() {
    // Close any open modals
    closePowerSelector();
    closeRefillModal();
    console.log('[Bangit] Voting feature stopped');
  },

  // Export functions for external use
  createPowerSelector,
  createRefillPowerModal,
  executeVote,
  updateOpenModalPowerStats
};

export default votingFeature;

// Also export individual functions
export { createPowerSelector, closePowerSelector, updateOpenModalPowerStats } from './power-selector.js';
export { createRefillPowerModal, closeRefillModal } from './refill-modal.js';
export { executeVote } from './vote-handler.js';
