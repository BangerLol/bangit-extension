// Bangit - Sybil detection modal for users who have already voted from this device

import { logout } from '../../core/rpc.js';
import { escapeHtml } from '../../core/utils.js';
import { showToast } from './toast.js';

// Active modal reference
let activeSybilModal = null;

/**
 * Show sybil detection modal
 * @param {string} blockingUsername - The Twitter username that has already voted from this device
 * @param {Function} onClose - Optional callback when modal is closed
 */
export function showSybilModal(blockingUsername, onClose) {
  // Close any existing modal
  if (activeSybilModal) {
    closeSybilModal();
  }

  const modal = document.createElement('div');
  modal.className = 'bangit-sybil-modal';

  modal.innerHTML = `
    <div class="bangit-sybil-content">
      <button class="bangit-sybil-close" aria-label="Close">&times;</button>
      <div class="bangit-sybil-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
      </div>
      <h3 class="bangit-sybil-title">Voting Disabled</h3>
      <p class="bangit-sybil-description">
        Another account ${blockingUsername ? `<span class="bangit-sybil-username">(@${escapeHtml(blockingUsername)})</span>` : ''} has already voted from this device in the current reward period.
      </p>
      <p class="bangit-sybil-subdescription">
        Voting for this account + device will be re-enabled at the start of the next reward period (midnight UTC).
      </p>
      <button class="bangit-sybil-ok-btn">Ok</button>
      <button class="bangit-sybil-logout-btn">Logout</button>
    </div>
  `;

  const closeBtn = modal.querySelector('.bangit-sybil-close');
  const okBtn = modal.querySelector('.bangit-sybil-ok-btn');
  const logoutBtn = modal.querySelector('.bangit-sybil-logout-btn');

  const handleClose = () => {
    closeSybilModal();
    if (onClose) onClose();
  };

  // Close handlers
  closeBtn.addEventListener('click', handleClose);
  okBtn.addEventListener('click', handleClose);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) handleClose();
  });

  // Logout handler
  logoutBtn.addEventListener('click', async () => {
    try {
      await logout();
      closeSybilModal();
      // Page will update via AUTH_STATUS_CHANGED message
    } catch (error) {
      showToast('Failed to logout. Please try again.', 'error');
    }
  });

  document.body.appendChild(modal);
  activeSybilModal = modal;
}

/**
 * Close the sybil modal
 */
export function closeSybilModal() {
  if (activeSybilModal) {
    activeSybilModal.remove();
    activeSybilModal = null;
  }
}
