// Bangit - Power selector modal for voting

import { getState, updateState } from '../../core/state.js';
import { CONFIG } from '../../core/config.js';
import { formatNumber } from '../../core/utils.js';
import { executeVote } from './vote-handler.js';
import { createRefillPowerModal } from './refill-modal.js';

// Active modal reference
let activePowerSelector = null;

// Function to update active modal's power stats (set inside createPowerSelector)
let updateActivePowerStats = null;

/**
 * Load default power percentage from settings
 */
async function getDefaultPowerPct() {
  try {
    const result = await chrome.storage.sync.get(['defaultPowerPct']);
    return result.defaultPowerPct || CONFIG.MAX_POWER_PCT;
  } catch (error) {
    console.error('[Bangit] Error loading default power pct:', error);
    return CONFIG.MAX_POWER_PCT;
  }
}

/**
 * Save default power percentage to settings
 */
async function saveDefaultPowerPct(powerPct) {
  try {
    await chrome.storage.sync.set({ defaultPowerPct: powerPct });
  } catch (error) {
    console.error('[Bangit] Error saving default power pct:', error);
  }
}

/**
 * Create power selector modal
 * @param {string} tweetId - Tweet ID to vote on
 * @param {'up'|'down'} voteType - Initial vote type
 * @param {object} powerStats - User power stats
 */
export function createPowerSelector(tweetId, voteType, powerStats) {
  // Close any existing power selector
  if (activePowerSelector) {
    activePowerSelector.remove();
    activePowerSelector = null;
  }

  const modal = document.createElement('div');
  modal.className = 'bangit-power-selector-overlay';

  // Use mutable reference so calculations stay up-to-date when stats are updated
  const stats = { ...powerStats };

  const calculatePower = (pct) => (stats.maxPower * pct) / 100;
  const calculateBurn = (pct) => {
    const extraPct = Math.max(0, pct - 10);
    return (stats.stakedTokens / 1e9) * (0.0025 * extraPct);
  };

  const pct = (val, min, max) => ((val - min) / (max - min)) * 100;

  modal.innerHTML = `
    <div class="bangit-power-selector-modal">
      <button class="bangit-power-selector-close" aria-label="Close">&times;</button>
      <h3 class="bangit-power-selector-title">Vote</h3>
      <div class="bangit-power-selector-stats">
        <div class="bangit-power-selector-stats-inner">
          <p class="bangit-power-stat">
            <span class="bangit-power-stat-icon">⚡</span>
            <span class="bangit-power-stat-value">${formatNumber(stats.currentPower)}</span>
          </p>
          <p class="bangit-power-stat">
            <span class="bangit-power-stat-icon">💎</span>
            <span class="bangit-power-stat-value">${formatNumber(stats.stakedTokens / 1e9)} BANG</span>
          </p>
        </div>
        <button class="bangit-power-refill-btn" type="button">Refill</button>
      </div>
      <div class="bangit-power-selector-direction-labels">
        <span class="bangit-power-selector-direction-label bangit-down-label">Down</span>
        <div style="flex: 1;"></div>
        <span class="bangit-power-selector-direction-label bangit-up-label">Up</span>
      </div>
      <div class="bangit-power-selector-slider-container">
        <div class="bangit-power-selector-slider-wrapper">
          <div class="bangit-power-selector-slider-track">
            <div class="bangit-power-selector-slider-visual-track"></div>
            <div class="bangit-power-selector-slider-filled"></div>
            <div class="bangit-power-selector-burn-glow-left"></div>
            <div class="bangit-power-selector-burn-glow-right"></div>
            <div class="bangit-power-selector-markers">
              ${[-20, -15, -10, -5, 0, 5, 10, 15, 20].map(val => {
                const leftPct = ((val + 20) / 40) * 100;
                return `<div class="bangit-power-selector-marker" data-value="${val}" style="left: ${leftPct}%"></div>`;
              }).join('')}
            </div>
          </div>
          <input
            type="range"
            min="-20"
            max="20"
            value="10"
            step="1"
            class="bangit-power-selector-slider"
          />
        </div>
      </div>
      <div class="bangit-power-selector-selected">
        <p class="bangit-power-selector-pct up">10%</p>
        <div class="bangit-power-selector-amounts">
          <div class="bangit-power-selector-amount">
            <span class="bangit-power-stat-icon">⚡</span>
            <span class="bangit-power-selector-amount-value">-0</span>
          </div>
          <div class="bangit-power-selector-burn" style="display: none">
            <span class="bangit-power-stat-icon">💎</span>
            <span class="bangit-power-selector-burn-value">-0 BANG</span>
          </div>
        </div>
      </div>
      <div class="bangit-power-selector-info info">
        <span class="bangit-power-selector-info-text">Slide to select power and direction</span>
      </div>
      <button class="bangit-power-selector-submit up">
        Upvote
      </button>
    </div>
  `;

  const slider = modal.querySelector('.bangit-power-selector-slider');
  const sliderWrapper = modal.querySelector('.bangit-power-selector-slider-wrapper');
  const pctDisplay = modal.querySelector('.bangit-power-selector-pct');
  const powerDisplay = modal.querySelector('.bangit-power-selector-amount-value');
  const burnDisplay = modal.querySelector('.bangit-power-selector-burn-value');
  const burnContainer = modal.querySelector('.bangit-power-selector-burn');
  const infoContainer = modal.querySelector('.bangit-power-selector-info');
  const infoText = modal.querySelector('.bangit-power-selector-info-text');
  const submitBtn = modal.querySelector('.bangit-power-selector-submit');
  const downLabel = modal.querySelector('.bangit-down-label');
  const upLabel = modal.querySelector('.bangit-up-label');
  const filledTrack = modal.querySelector('.bangit-power-selector-slider-filled');
  const burnGlowLeft = modal.querySelector('.bangit-power-selector-burn-glow-left');
  const burnGlowRight = modal.querySelector('.bangit-power-selector-burn-glow-right');

  // Cache marker elements once (avoid querySelectorAll on every input)
  const markers = [...modal.querySelectorAll('.bangit-power-selector-marker')];

  // Track pending rAF for batching visual updates
  let pendingUpdate = null;

  // Load default and set initial value
  getDefaultPowerPct().then(defaultPct => {
    const initialValue = voteType === 'down' ? -defaultPct : defaultPct;
    slider.value = initialValue;
    updatePowerDisplay();
  });

  const updatePowerDisplay = () => {
    // Cancel any pending update and schedule a new one
    if (pendingUpdate) {
      cancelAnimationFrame(pendingUpdate);
    }

    pendingUpdate = requestAnimationFrame(() => {
      pendingUpdate = null;

      const val = parseInt(slider.value);
      const absolutePct = Math.abs(val);
      const currentVoteType = val < 0 ? 'down' : val > 0 ? 'up' : 'neutral';
      const power = calculatePower(absolutePct);
      const burn = calculateBurn(absolutePct);
      const notEnoughPower = val !== 0 && power > stats.currentPower;
      const mustHaveStake = absolutePct > 10 && stats.stakedTokens <= 0;
      const isBurning = val !== 0 && absolutePct > 10 && !notEnoughPower && !mustHaveStake;

      // Update thumb colors via CSS variables
      const thumbBorderColor = val < 0 ? '#ff7f7f' : val > 0 ? '#81f052' : '#f2c1fb';
      const thumbBgColor = val < 0 ? 'rgb(94, 46, 46)' : val > 0 ? 'rgb(44, 85, 26)' : '#604d63';
      sliderWrapper.style.setProperty('--thumb-border-color', thumbBorderColor);
      sliderWrapper.style.setProperty('--thumb-bg-color', thumbBgColor);

      // Update glow colors via CSS variables (no style element creation needed)
      const glowColor = val < 0
        ? 'rgba(255, 127, 127, 0.3)'
        : val > 0
          ? 'rgba(129, 240, 82, 0.3)'
          : 'rgba(242, 193, 251, 0.3)';
      const glowColorActive = val < 0
        ? 'rgba(255, 127, 127, 0.45)'
        : val > 0
          ? 'rgba(129, 240, 82, 0.45)'
          : 'rgba(242, 193, 251, 0.45)';
      sliderWrapper.style.setProperty('--glow-color', glowColor);
      sliderWrapper.style.setProperty('--glow-color-active', glowColorActive);

      // Update percentage display
      pctDisplay.textContent = `${absolutePct}%`;
      pctDisplay.className = 'bangit-power-selector-pct ' + currentVoteType;

      // Update direction labels
      downLabel.classList.remove('active-down');
      upLabel.classList.remove('active-up');
      if (val < 0) downLabel.classList.add('active-down');
      if (val > 0) upLabel.classList.add('active-up');

      // Update power and burn displays
      powerDisplay.textContent = `-${formatNumber(power)}`;
      burnDisplay.textContent = `-${formatNumber(burn)} BANG`;
      burnContainer.style.display = absolutePct > 10 ? 'flex' : 'none';

      // Update filled track
      const neutralPctPos = 50;
      const valPctPos = pct(val, -20, 20);
      const filledLeftPct = val >= 0 ? neutralPctPos : valPctPos;
      const filledWidthPct = Math.abs(valPctPos - neutralPctPos);
      filledTrack.style.left = `${filledLeftPct}%`;
      filledTrack.style.width = `${filledWidthPct}%`;
      filledTrack.style.backgroundColor = thumbBgColor;

      // Update burn glow zones
      const startPct = pct(-10, -20, 20);
      const endPct = pct(10, -20, 20);
      const leftWidth = Math.max(0, startPct);
      const rightLeft = Math.min(100, endPct);
      const rightWidth = Math.max(0, 100 - rightLeft);

      if (leftWidth > 0) {
        burnGlowLeft.style.left = '0%';
        burnGlowLeft.style.width = `${leftWidth}%`;
        burnGlowLeft.style.backgroundImage = `
          radial-gradient(120% 70% at 0% 50%,
            rgba(251, 146, 60, 0.8) 35%,
            rgba(251, 146, 60, 0.44) 70%,
            transparent 100%),
          linear-gradient(to left,
            transparent 0%,
            rgba(251, 146, 60, 0.28) 45%,
            rgba(251, 146, 60, 0.6) 85%,
            rgba(251, 146, 60, 0.8) 100%)
        `;
      } else {
        burnGlowLeft.style.width = '0';
      }

      if (rightWidth > 0) {
        burnGlowRight.style.left = `${rightLeft}%`;
        burnGlowRight.style.width = `${rightWidth}%`;
        burnGlowRight.style.backgroundImage = `
          radial-gradient(120% 70% at 100% 50%,
            rgba(251, 146, 60, 0.8) 35%,
            rgba(251, 146, 60, 0.44) 70%,
            transparent 100%),
          linear-gradient(to right,
            transparent 0%,
            rgba(251, 146, 60, 0.28) 45%,
            rgba(251, 146, 60, 0.6) 85%,
            rgba(251, 146, 60, 0.8) 100%)
        `;
      } else {
        burnGlowRight.style.width = '0';
      }

      // Update info text and styling
      if (notEnoughPower) {
        infoText.textContent = 'Not enough power';
        infoContainer.className = 'bangit-power-selector-info warning';
        submitBtn.disabled = true;
      } else if (mustHaveStake) {
        infoText.textContent = 'Must have staked BANG';
        infoContainer.className = 'bangit-power-selector-info error';
        submitBtn.disabled = true;
      } else if (isBurning) {
        infoText.textContent = `Burns ${formatNumber(burn)} staked BANG`;
        infoContainer.className = 'bangit-power-selector-info burn';
        submitBtn.disabled = false;
      } else {
        infoText.textContent = 'Slide to select power and direction';
        infoContainer.className = 'bangit-power-selector-info info';
        submitBtn.disabled = val === 0;
      }

      // Update submit button
      submitBtn.setAttribute('class', 'bangit-power-selector-submit ' + currentVoteType);
      submitBtn.textContent = val > 0 ? 'Upvote' : val < 0 ? 'Downvote' : 'Vote';
      submitBtn.style.cssText = '';

      // Update markers using cached array
      for (const marker of markers) {
        const markerVal = parseInt(marker.dataset.value);
        const passed = val >= 0
          ? (markerVal >= 0 && markerVal <= val)
          : (markerVal <= 0 && markerVal >= val);

        if (passed) {
          marker.classList.add('bangit-power-selector-marker-active');
          marker.style.setProperty('--marker-color', thumbBorderColor);
        } else {
          marker.classList.remove('bangit-power-selector-marker-active');
        }
      }
    });
  };

  slider.addEventListener('input', updatePowerDisplay);
  updatePowerDisplay();

  // Set up external update function for this modal instance
  updateActivePowerStats = (newStats) => {
    if (!activePowerSelector) return;

    // Update mutable reference so calculations use new values
    Object.assign(stats, newStats);

    // Update DOM display values
    const statsValueElements = activePowerSelector.querySelectorAll('.bangit-power-stat-value');
    if (statsValueElements[0]) {
      statsValueElements[0].textContent = formatNumber(stats.currentPower);
    }
    if (statsValueElements[1]) {
      statsValueElements[1].textContent = `${formatNumber(stats.stakedTokens / 1e9)} BANG`;
    }

    // Re-run slider calculations with new data
    updatePowerDisplay();
  };

  // Close handlers
  const closeModal = () => {
    modal.remove();
    if (activePowerSelector === modal) {
      activePowerSelector = null;
      updateActivePowerStats = null;
    }
  };

  modal.querySelector('.bangit-power-selector-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Refill button handler
  modal.querySelector('.bangit-power-refill-btn').addEventListener('click', () => {
    createRefillPowerModal(stats, (updatedStats) => {
      if (updatedStats) {
        updateState('power', { userStats: updatedStats });
        // Update mutable stats reference and DOM
        Object.assign(stats, updatedStats);
        const statsValueElements = modal.querySelectorAll('.bangit-power-stat-value');
        if (statsValueElements[0]) {
          statsValueElements[0].textContent = formatNumber(stats.currentPower);
        }
        if (statsValueElements[1]) {
          statsValueElements[1].textContent = `${formatNumber(stats.stakedTokens / 1e9)} BANG`;
        }
        updatePowerDisplay();
      }
    });
  });

  // Submit handler
  submitBtn.addEventListener('click', async () => {
    const finalValue = parseInt(slider.value);
    const finalPowerPct = Math.abs(finalValue);
    const finalVoteType = finalValue < 0 ? 'down' : 'up';

    // Save as default for future votes
    await saveDefaultPowerPct(finalPowerPct);

    // Close modal
    closeModal();

    // Execute vote
    await executeVote(tweetId, finalVoteType, finalPowerPct);
  });

  document.body.appendChild(modal);
  activePowerSelector = modal;
}

/**
 * Close power selector modal
 */
export function closePowerSelector() {
  if (activePowerSelector) {
    activePowerSelector.remove();
    activePowerSelector = null;
    updateActivePowerStats = null;
  }
}

/**
 * Update power stats in an open modal
 * Called when fresh data arrives after modal was opened with cached/default data
 * @param {object} newStats - Fresh power stats from API
 */
export function updateOpenModalPowerStats(newStats) {
  if (updateActivePowerStats) {
    updateActivePowerStats(newStats);
  }
}
