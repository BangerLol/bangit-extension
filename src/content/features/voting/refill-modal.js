// Bangit - Refill power modal

import { refillPower } from '../../core/rpc.js';
import { showToast } from '../modals/toast.js';

// Active modal reference
let activeRefillModal = null;

/**
 * Create refill power modal
 * @param {object} powerStats - User power stats
 * @param {Function} onSuccess - Callback when refill succeeds
 */
export function createRefillPowerModal(powerStats, onSuccess) {
  // Close any existing refill modal
  if (activeRefillModal) {
    activeRefillModal.remove();
    activeRefillModal = null;
  }

  const modal = document.createElement('div');
  modal.className = 'bangit-refill-modal-overlay';

  const { currentPower, maxPower, stakedTokens } = powerStats;

  // Calculate max refill percentage based on headroom
  const headroom = Math.max(maxPower - currentPower, 0);
  const headroomPctExact = maxPower > 0 ? (headroom / maxPower) * 100 : 0;
  const sliderMaxPct = Math.max(1, Math.floor(headroomPctExact));
  const sliderDisabled = sliderMaxPct < 1;

  // Generate slider markers
  const minPct = 1;
  const range = Math.max(0, sliderMaxPct - minPct);
  const interiorMarks = [0.25, 0.5, 0.75]
    .map(p => minPct + range * p)
    .filter(m => m > minPct && m < sliderMaxPct);
  const allMarks = [minPct, ...interiorMarks, sliderMaxPct];

  const formatNumber = (num, decimals = 0) => {
    if (num >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
    return decimals > 0 ? num.toFixed(decimals) : num.toFixed(0);
  };

  const calculateRefill = (pct) => {
    const desired = maxPower * (pct / 100);
    return Math.min(desired, headroom);
  };

  const calculateBurn = (pct) => {
    const effectiveRefill = calculateRefill(pct);
    const effectivePct = maxPower > 0 ? (effectiveRefill / maxPower) * 100 : 0;
    const burnPctOfStake = (effectivePct / 100) * 0.025;
    const stakeBang = stakedTokens / 1e9;
    return stakeBang * burnPctOfStake;
  };

  const initialPct = Math.min(25, sliderMaxPct);

  modal.innerHTML = `
    <div class="bangit-refill-modal">
      <button class="bangit-refill-modal-close" aria-label="Close">&times;</button>
      <h3 class="bangit-refill-modal-title">Refill Power</h3>
      <div class="bangit-refill-modal-stats">
        <p class="bangit-refill-stat">
          <span class="bangit-refill-stat-icon">⚡</span>
          <span class="bangit-refill-stat-value">${formatNumber(currentPower, 2)} / ${formatNumber(maxPower, 2)}</span>
        </p>
        <p class="bangit-refill-stat">
          <span class="bangit-refill-stat-icon">💎</span>
          <span class="bangit-refill-stat-value">${formatNumber(stakedTokens / 1e9, 2)} BANG</span>
        </p>
      </div>
      <p class="bangit-refill-modal-label">Select power amount to refill</p>
      <div class="bangit-refill-slider-container">
        <div class="bangit-refill-slider-wrapper">
          <div class="bangit-refill-slider-track">
            <div class="bangit-refill-slider-visual-track"></div>
            <div class="bangit-refill-slider-filled"></div>
            <div class="bangit-refill-slider-markers">
              ${allMarks.map(val => {
                const leftPct = ((val - minPct) / Math.max(1, sliderMaxPct - minPct)) * 100;
                return `<div class="bangit-refill-slider-marker" data-value="${val}" style="left: ${leftPct}%"></div>`;
              }).join('')}
            </div>
          </div>
          <input
            type="range"
            min="${minPct}"
            max="${sliderMaxPct}"
            value="${initialPct}"
            step="1"
            class="bangit-refill-slider"
            ${sliderDisabled ? 'disabled' : ''}
          />
        </div>
      </div>
      <div class="bangit-refill-preview">
        <p class="bangit-refill-preview-item">
          <span class="bangit-refill-preview-icon">⚡</span>
          <span class="bangit-refill-preview-value">+${formatNumber(calculateRefill(initialPct), 2)}</span>
        </p>
        <p class="bangit-refill-preview-item">
          <span class="bangit-refill-preview-icon">💎</span>
          <span class="bangit-refill-preview-value">-${formatNumber(calculateBurn(initialPct), 2)} BANG</span>
        </p>
      </div>
      <div class="bangit-refill-error" style="display: none;"></div>
      <div class="bangit-refill-buttons">
        <button class="bangit-refill-cancel-btn" type="button">Cancel</button>
        <button class="bangit-refill-submit-btn" type="button" ${sliderDisabled ? 'disabled' : ''}>Refill</button>
      </div>
    </div>
  `;

  const slider = modal.querySelector('.bangit-refill-slider');
  const filledTrack = modal.querySelector('.bangit-refill-slider-filled');
  const refillValueEl = modal.querySelector('.bangit-refill-preview-value');
  const burnValueEl = modal.querySelectorAll('.bangit-refill-preview-value')[1];
  const submitBtn = modal.querySelector('.bangit-refill-submit-btn');
  const cancelBtn = modal.querySelector('.bangit-refill-cancel-btn');
  const errorEl = modal.querySelector('.bangit-refill-error');

  let isLoading = false;

  const updateRefillDisplay = () => {
    const pct = parseInt(slider.value);
    const refillAmount = calculateRefill(pct);
    const burnAmount = calculateBurn(pct);

    refillValueEl.textContent = `+${formatNumber(refillAmount, 2)}`;
    burnValueEl.textContent = `-${formatNumber(burnAmount, 2)} BANG`;

    const progress = ((pct - minPct) / Math.max(1, sliderMaxPct - minPct)) * 100;
    filledTrack.style.width = `${progress}%`;

    const markers = modal.querySelectorAll('.bangit-refill-slider-marker');
    markers.forEach(marker => {
      const markerVal = parseFloat(marker.dataset.value);
      if (markerVal <= pct) {
        marker.classList.add('bangit-refill-slider-marker-active');
      } else {
        marker.classList.remove('bangit-refill-slider-marker-active');
      }
    });
  };

  slider.addEventListener('input', updateRefillDisplay);
  updateRefillDisplay();

  const closeModal = () => {
    modal.remove();
    if (activeRefillModal === modal) {
      activeRefillModal = null;
    }
  };

  modal.querySelector('.bangit-refill-modal-close').addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  submitBtn.addEventListener('click', async () => {
    if (isLoading || sliderDisabled) return;

    const pct = parseInt(slider.value);
    isLoading = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Refilling...';
    errorEl.style.display = 'none';

    try {
      const response = await refillPower(pct);

      if (response.success) {
        const data = response.data;
        showToast(`Power refilled! +${formatNumber(data.addedPower || calculateRefill(pct), 2)} ⚡`, 'success');

        const updatedStats = {
          currentPower: data.currentPower,
          maxPower: data.maxPower,
          stakedTokens: data.stakedTokens,
          maxPower: data.maxPower
        };

        closeModal();

        if (onSuccess) {
          onSuccess(updatedStats);
        }
      } else {
        throw new Error(response.error || 'Failed to refill power');
      }
    } catch (error) {
      console.error('[Bangit] Refill error:', error);
      errorEl.textContent = error.message || 'Failed to refill power';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Refill';
    } finally {
      isLoading = false;
    }
  });

  document.body.appendChild(modal);
  activeRefillModal = modal;
}

/**
 * Close refill modal
 */
export function closeRefillModal() {
  if (activeRefillModal) {
    activeRefillModal.remove();
    activeRefillModal = null;
  }
}
