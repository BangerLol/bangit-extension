// Bangit - Restriction modal for users who need to enter invite code or await validation

import { redeemInviteCode, validateTwitterAccount, logout } from '../../core/rpc.js';
import { showToast } from './toast.js';

// Active modal reference
let activeRestrictionModal = null;
let countdownInterval = null;

/**
 * Show restriction modal based on user status
 * @param {object} userStatus - User status object with canParticipate, reason, restrictedUntil
 * @param {Function} onSuccess - Callback when restriction is resolved
 * @param {Function} onUpdateStatus - Callback to update cached user status
 */
export function showRestrictionModal(userStatus, onSuccess, onUpdateStatus) {
  // Close any existing modal
  if (activeRestrictionModal) {
    closeRestrictionModal();
  }

  const modal = document.createElement('div');
  modal.className = 'bangit-restriction-modal';

  // Determine which mode to render
  const reason = userStatus?.reason || 'INVITE_CODE';

  if (reason === 'FLAGGED') {
    renderFlaggedUI(modal, onSuccess);
  } else if (reason === 'TWITTER_ACCOUNT') {
    renderTwitterValidationUI(modal, userStatus, onSuccess, onUpdateStatus);
  } else {
    // Default to INVITE_CODE
    renderInviteCodeUI(modal, onSuccess, onUpdateStatus);
  }

  document.body.appendChild(modal);
  activeRestrictionModal = modal;
}

/**
 * Close the restriction modal
 */
export function closeRestrictionModal() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (activeRestrictionModal) {
    activeRestrictionModal.remove();
    activeRestrictionModal = null;
  }
}

/**
 * Render invite code input UI
 */
function renderInviteCodeUI(modal, onSuccess, onUpdateStatus) {
  const logoUrl = chrome.runtime.getURL('media/bangitLogoNew-rounded-192x192.png');

  modal.innerHTML = `
    <div class="bangit-restriction-content">
      <button class="bangit-restriction-close" aria-label="Close">&times;</button>
      <div class="bangit-restriction-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
          <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
        </svg>
      </div>
      <h3 class="bangit-restriction-title">Invite Required</h3>
      <a href="https://x.com/bangitdotxyz" target="_blank" rel="noopener noreferrer" class="bangit-need-code-link">Need a code?</a>
      <p class="bangit-restriction-description">Enter a valid invite code:</p>
      <div class="bangit-invite-form">
        <input
          type="text"
          class="bangit-invite-input"
          placeholder="Invite code"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="bangit-invite-error" style="display: none;"></div>
        <button class="bangit-invite-submit-btn">Enter</button>
      </div>
    </div>
  `;

  const input = modal.querySelector('.bangit-invite-input');
  const submitBtn = modal.querySelector('.bangit-invite-submit-btn');
  const errorEl = modal.querySelector('.bangit-invite-error');
  const closeBtn = modal.querySelector('.bangit-restriction-close');

  // Close handlers
  closeBtn.addEventListener('click', closeRestrictionModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRestrictionModal();
  });

  // Helper to show error state
  const showError = (message) => {
    input.blur();
    input.classList.add('error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  };

  // Helper to clear error state
  const clearError = () => {
    input.classList.remove('error');
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  };

  // Clear error on input
  input.addEventListener('input', clearError);
  input.addEventListener('focus', clearError);

  // Enter handler
  const handleEnter = async () => {
    const code = input.value.trim();

    // Handle empty/blank submission
    if (!code) {
      showError('Invalid code');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="bangit-spinner-small"></span> Checking...';
    clearError();

    try {
      const response = await redeemInviteCode(code);

      if (response.success && response.data?.success) {
        // In the new flow, Twitter validation is already complete when redeeming invite code
        // So successful redemption means user is fully onboarded
        showToast('Welcome to Bangit!', 'success');
        closeRestrictionModal();
        if (onSuccess) onSuccess();
      } else {
        // Check for TWITTER_NOT_VALIDATED error (NEW FLOW)
        // User needs to complete Twitter validation first
        if (response.data?.error === 'TWITTER_NOT_VALIDATED') {
          console.log('Twitter not validated - switching to Twitter validation UI');
          renderTwitterValidationUI(modal, {
            reason: 'TWITTER_ACCOUNT',
            restrictedUntil: response.data.restrictedUntil,
          }, onSuccess, onUpdateStatus);
        } else {
          showError('Invalid code');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enter';
        }
      }
    } catch (error) {
      showError('Invalid code');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enter';
    }
  };

  submitBtn.addEventListener('click', handleEnter);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleEnter();
  });

  // Focus input
  setTimeout(() => input.focus(), 100);
}

/**
 * Render Twitter account validation UI with countdown
 */
function renderTwitterValidationUI(modal, userStatus, onSuccess, onUpdateStatus) {
  const restrictedUntil = userStatus?.restrictedUntil ? new Date(userStatus.restrictedUntil) : null;

  modal.innerHTML = `
    <div class="bangit-restriction-content">
      <button class="bangit-restriction-close" aria-label="Close">&times;</button>
      <div class="bangit-restriction-icon bangit-restriction-icon-shield">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
          <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
        </svg>
      </div>
      <h3 class="bangit-restriction-title">Account Validation Required</h3>
      <div class="bangit-restriction-criteria">
        <p class="bangit-restriction-description">Your account is ineligible. Must be:</p>
        <p class="bangit-restriction-description">&gt;100 followers</p>
        <p class="bangit-restriction-description">&gt;90 days old</p>
      </div>
      <div class="bangit-validation-timer" style="display: none;">
        <p class="bangit-timer-label">Try again in:</p>
        <span class="bangit-timer-value">00:00:00</span>
      </div>
      <button class="bangit-validation-retry-btn" style="display: none;">Try Again</button>
      <button class="bangit-restriction-ok-btn">Ok</button>
      <button class="bangit-restriction-logout-btn">Logout</button>
    </div>
  `;

  const closeBtn = modal.querySelector('.bangit-restriction-close');
  const okBtn = modal.querySelector('.bangit-restriction-ok-btn');
  const logoutBtn = modal.querySelector('.bangit-restriction-logout-btn');
  const timerContainer = modal.querySelector('.bangit-validation-timer');
  const timerValue = modal.querySelector('.bangit-timer-value');
  const retryBtn = modal.querySelector('.bangit-validation-retry-btn');

  // Close handlers
  closeBtn.addEventListener('click', closeRestrictionModal);
  okBtn.addEventListener('click', closeRestrictionModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRestrictionModal();
  });

  // Logout handler
  logoutBtn.addEventListener('click', async () => {
    try {
      await logout();
      closeRestrictionModal();
      // Page will update via AUTH_STATUS_CHANGED message
    } catch (error) {
      showToast('Failed to logout. Please try again.', 'error');
    }
  });

  // Setup countdown if restrictedUntil is set
  if (restrictedUntil) {
    timerContainer.style.display = 'block';

    const updateTimer = () => {
      const now = new Date();
      const diff = restrictedUntil.getTime() - now.getTime();

      if (diff <= 0) {
        // Timer expired, show retry button
        timerContainer.style.display = 'none';
        retryBtn.style.display = 'block';
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      timerValue.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
  } else {
    // No restrictedUntil, show retry button immediately
    retryBtn.style.display = 'block';
  }

  // Retry button handler
  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    retryBtn.innerHTML = '<span class="bangit-spinner-small"></span> Checking...';

    try {
      const response = await validateTwitterAccount();

      // Check userStatus for the new flow
      const userStatus = response.data?.userStatus;
      const twitterValidation = response.data?.twitterAccountValidation;

      if (userStatus?.canParticipate) {
        // Fully validated and has invite code - user is unrestricted
        showToast('Account validated successfully!', 'success');
        closeRestrictionModal();
        if (onSuccess) onSuccess();
      } else if (userStatus?.reason === 'INVITE_CODE' || (twitterValidation?.validated && !userStatus?.canParticipate)) {
        // Twitter validation succeeded, now need invite code (NEW FLOW)
        showToast('Account validated! Now enter your invite code.', 'success');

        // Update the cached user status to reflect Twitter validation complete
        if (onUpdateStatus) {
          onUpdateStatus({
            reason: 'INVITE_CODE',
            canParticipate: false,
            restrictedUntil: null,
          });
        }

        renderInviteCodeUI(modal, onSuccess, onUpdateStatus);
      } else {
        // Validation failed - check for restrictedUntil in all possible locations
        const newRestrictedUntil = response.data?.restrictedUntil || userStatus?.restrictedUntil || twitterValidation?.restrictedUntil;
        if (newRestrictedUntil) {
          // Update cached user status with new restrictedUntil
          if (onUpdateStatus) {
            onUpdateStatus({
              reason: 'TWITTER_ACCOUNT',
              restrictedUntil: newRestrictedUntil,
              canParticipate: false,
            });
          }

          // Show countdown timer with new restrictedUntil
          const restrictedDate = new Date(newRestrictedUntil);
          retryBtn.style.display = 'none';
          retryBtn.disabled = false;
          retryBtn.textContent = 'Try Again';
          timerContainer.style.display = 'block';

          // Clear existing interval if any
          if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
          }

          const updateTimer = () => {
            const now = new Date();
            const diff = restrictedDate.getTime() - now.getTime();

            if (diff <= 0) {
              timerContainer.style.display = 'none';
              retryBtn.style.display = 'block';
              if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
              }
              return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            timerValue.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
          };

          updateTimer();
          countdownInterval = setInterval(updateTimer, 1000);
        } else {
          // No restrictedUntil available - re-enable retry button
          retryBtn.disabled = false;
          retryBtn.textContent = 'Try Again';
          showToast('Validation failed. Please try again.', 'error');
        }
      }
    } catch (error) {
      retryBtn.disabled = false;
      retryBtn.textContent = 'Try Again';
      showToast(error.message || 'Validation failed. Please try again.', 'error');
    }
  });
}

/**
 * Render flagged account UI
 */
function renderFlaggedUI(modal, onSuccess) {
  modal.innerHTML = `
    <div class="bangit-restriction-content">
      <button class="bangit-restriction-close" aria-label="Close">&times;</button>
      <div class="bangit-restriction-icon bangit-restriction-icon-warning">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>
      </div>
      <h3 class="bangit-restriction-title">Account Flagged</h3>
      <p class="bangit-restriction-description">Your account has been flagged and cannot participate.</p>
      <button class="bangit-restriction-ok-btn">Ok</button>
      <button class="bangit-restriction-logout-btn">Logout</button>
    </div>
  `;

  const closeBtn = modal.querySelector('.bangit-restriction-close');
  const okBtn = modal.querySelector('.bangit-restriction-ok-btn');
  const logoutBtn = modal.querySelector('.bangit-restriction-logout-btn');

  // Close handlers
  closeBtn.addEventListener('click', closeRestrictionModal);
  okBtn.addEventListener('click', closeRestrictionModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeRestrictionModal();
  });

  // Logout handler
  logoutBtn.addEventListener('click', async () => {
    try {
      await logout();
      closeRestrictionModal();
      // Page will update via AUTH_STATUS_CHANGED message
    } catch (error) {
      showToast('Failed to logout. Please try again.', 'error');
    }
  });
}
