// Bangit - Rewards modal

import { sendMessage, MessageTypes } from '../../core/rpc.js';
import { calculateTimeToMidnightUTC, escapeHtml } from '../../core/utils.js';

// Active modal reference
let activeRewardsModal = null;

// Modal state
let modalState = {
  distributions: null,
  expandedDistributions: new Set(),
  distributionDetails: {},
  upcomingData: null
};

/**
 * Create Rewards modal
 */
export async function createRewardsModal() {
  // Close any existing modal
  if (activeRewardsModal) {
    activeRewardsModal.remove();
    activeRewardsModal = null;
  }

  // Reset state
  modalState = {
    distributions: null,
    expandedDistributions: new Set(),
    distributionDetails: {},
    upcomingData: null
  };

  const modal = document.createElement('div');
  modal.className = 'bangit-sidebar-modal-overlay';

  modal.innerHTML = `
    <div class="bangit-sidebar-modal bangit-rewards-modal">
      <button class="bangit-sidebar-modal-close" aria-label="Close">&times;</button>
      <h2 class="bangit-sidebar-modal-title">Rewards</h2>
      <div class="bangit-sidebar-modal-content">
        <div class="bangit-modal-loading">
          <div class="bangit-modal-spinner"></div>
        </div>
      </div>
    </div>
  `;

  // Close handlers
  const closeModal = () => {
    modal.remove();
    if (activeRewardsModal === modal) {
      activeRewardsModal = null;
    }
  };

  modal.querySelector('.bangit-sidebar-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.body.appendChild(modal);
  activeRewardsModal = modal;

  // Fetch reward distributions and upcoming pool data in parallel
  try {
    const [distResponse, upcomingResponse] = await Promise.all([
      sendMessage(MessageTypes.GET_REWARD_DISTRIBUTIONS),
      sendMessage(MessageTypes.GET_UPCOMING_DISTRIBUTION).catch(() => null)
    ]);

    if (upcomingResponse?.success && upcomingResponse.data) {
      modalState.upcomingData = upcomingResponse.data;
    }

    if (distResponse.success) {
      // API returns array directly or wrapped in { distributions: [...] }
      modalState.distributions = Array.isArray(distResponse.data)
        ? distResponse.data
        : (distResponse.data?.distributions || []);
      renderRewardsContent(modal);
    } else {
      throw new Error(distResponse.error || 'Failed to load rewards data');
    }
  } catch (error) {
    console.error('[Bangit] Error loading rewards data:', error);
    renderRewardsError(modal, error.message);
  }
}

/**
 * Render rewards content
 */
function renderRewardsContent(modal) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');
  const countdown = calculateTimeToMidnightUTC();
  const distributions = modalState.distributions || [];

  const poolInfoHtml = renderPoolInfo();

  content.innerHTML = `
    <!-- Countdown Section -->
    <div class="bangit-modal-countdown-section">
      <div class="bangit-modal-countdown-label">Next Distribution</div>
      <div class="bangit-modal-countdown-timer bangit-rewards-modal-countdown">${countdown.formatted}</div>
      ${poolInfoHtml}
    </div>

    <!-- Historical Distribution Cards -->
    <div class="bangit-performance-history-section">
      <div class="bangit-performance-history-list">
        ${distributions.length === 0 ? `
          <div class="bangit-modal-empty">No historical reward distributions</div>
        ` : renderDistributionCards()}
      </div>
    </div>
  `;

  // Set up event listeners
  setupEventListeners(modal);

  // Start countdown timer
  startRewardsCountdown(content);
}

/**
 * Render distribution cards
 */
function renderDistributionCards() {
  const distributions = modalState.distributions || [];

  return distributions.slice(0, 10).map((dist, index) => {
    const isExpanded = modalState.expandedDistributions.has(dist.id || index);
    const dateRange = formatDistributionDateRange(dist);

    return `
      <div class="bangit-modal-card ${isExpanded ? 'expanded' : ''}" data-card="dist-${dist.id || index}">
        <div class="bangit-modal-card-header">
          <span class="bangit-modal-card-title">${dateRange}</span>
          <svg class="bangit-modal-card-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="bangit-modal-card-content" data-dist-id="${dist.id || index}">
          ${isExpanded ? '<div class="bangit-modal-loading"><div class="bangit-modal-spinner"></div></div>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Format distribution date range
 */
function formatDistributionDateRange(dist) {
  if (dist.periodStart && dist.periodEnd) {
    const start = new Date(dist.periodStart);
    const end = new Date(dist.periodEnd);
    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  }
  if (dist.startDate && dist.endDate) {
    const start = new Date(dist.startDate);
    const end = new Date(dist.endDate);
    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  }
  if (dist.date || dist.createdAt) {
    const date = new Date(dist.date || dist.createdAt);
    return formatShortDate(date);
  }
  return 'Distribution';
}

/**
 * Format short date (M/D/YYYY)
 */
function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

/**
 * Set up event listeners
 */
function setupEventListeners(modal) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');

  // Card expand/collapse
  content.querySelectorAll('.bangit-modal-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.bangit-modal-card');
      const cardId = card.dataset.card;

      if (cardId.startsWith('dist-')) {
        const distId = cardId.replace('dist-', '');
        const isExpanded = modalState.expandedDistributions.has(distId);

        if (isExpanded) {
          modalState.expandedDistributions.delete(distId);
          card.classList.remove('expanded');
        } else {
          modalState.expandedDistributions.add(distId);
          card.classList.add('expanded');
          loadDistributionCurators(modal, distId);
        }
      }
    });
  });
}

/**
 * Load distribution curator rewards
 */
async function loadDistributionCurators(modal, distId) {
  const card = modal.querySelector(`[data-card="dist-${distId}"]`);
  const container = card?.querySelector('.bangit-modal-card-content');
  if (!container) return;

  // Check if already loaded
  if (modalState.distributionDetails[distId]) {
    renderCuratorRewards(container, distId);
    return;
  }

  container.innerHTML = `<div class="bangit-modal-loading"><div class="bangit-modal-spinner"></div></div>`;

  try {
    const response = await sendMessage('GET_DISTRIBUTION_CURATORS', { distributionId: distId });
    if (response.success) {
      modalState.distributionDetails[distId] = {
        curators: response.data.curatorRewards || response.data.curators || [],
        jackpotWinner: response.data.jackpotWinner || null
      };
      renderCuratorRewards(container, distId);
    } else {
      modalState.distributionDetails[distId] = { error: 'Failed to load curator rewards' };
      container.innerHTML = `<div class="bangit-modal-error">Failed to load curator rewards</div>`;
    }
  } catch (error) {
    console.error('[Bangit] Error loading distribution curators:', error);
    modalState.distributionDetails[distId] = { error: 'Failed to load curator rewards' };
    container.innerHTML = `<div class="bangit-modal-error">Failed to load curator rewards</div>`;
  }
}

/**
 * Format number with abbreviation (handles large numbers)
 */
function formatAmountAbbrev(value, decimals = 2) {
  if (value === undefined || value === null) return '--';
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return (value / 1000000).toFixed(decimals) + 'M';
  if (absValue >= 1000) return (value / 1000).toFixed(decimals) + 'K';
  return value.toFixed(decimals);
}

/**
 * Render curator rewards for a distribution
 */
function renderCuratorRewards(container, distId) {
  const details = modalState.distributionDetails[distId];

  if (details?.error) {
    container.innerHTML = `<div class="bangit-modal-error">${escapeHtml(details.error)}</div>`;
    return;
  }

  const curators = details?.curators || [];
  const jackpotWinner = details?.jackpotWinner;
  const jackpotWinnerId = jackpotWinner?.user?.twitterId;

  if (curators.length === 0) {
    container.innerHTML = `<div class="bangit-modal-empty">No curator rewards in this distribution</div>`;
    return;
  }

  container.innerHTML = `
    <div class="bangit-rewards-curators-list">
      <div class="bangit-rewards-curators-header">
        <span>Curator</span>
        <span>Rewards</span>
      </div>
      ${curators.map((reward) => {
        const user = reward.user || {};
        const isJackpotWinner = jackpotWinnerId && user.twitterId === jackpotWinnerId;
        const avatarUrl = escapeHtml(user.twitterAvatarUrl || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png');
        const username = escapeHtml(user.twitterUsername || 'Unknown');
        const rewardAmount = reward.rewardAmount || reward.reward || 0;

        return `
          <div class="bangit-rewards-curator-row">
            <div class="bangit-rewards-curator-info">
              <img src="${avatarUrl}" alt="" class="bangit-rewards-curator-avatar" />
              <span class="bangit-rewards-curator-name">@${username}</span>
              ${isJackpotWinner ? `<span class="bangit-rewards-jackpot-badge">🎰</span>` : ''}
            </div>
            <span class="bangit-rewards-curator-reward">${formatAmountAbbrev(rewardAmount / 1e9, 2)} BANG</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render pool info rows for the countdown section
 */
function renderPoolInfo() {
  const data = modalState.upcomingData;
  if (!data) return '';

  const perfAmount = formatAmountAbbrev(Number(data.performancePool) / 1e9, 0);
  const jackpotAmount = formatAmountAbbrev(Number(data.jackpotPool) / 1e9, 0);
  const chance = Math.round((data.jackpotTriggerProbability || 0.07) * 100);

  return `
    <div class="bangit-modal-pool-info">
      <div class="bangit-modal-pool-row">
        <span class="bangit-modal-pool-label">Performance Pool</span>
        <span class="bangit-modal-pool-value">${perfAmount} BANG</span>
      </div>
      <div class="bangit-modal-pool-row">
        <span class="bangit-modal-pool-label">Jackpot Pool <span class="bangit-modal-pool-chance">(${chance}% chance)</span></span>
        <span class="bangit-modal-pool-value bangit-modal-pool-jackpot">${jackpotAmount} BANG</span>
      </div>
    </div>
  `;
}

/**
 * Render error state
 */
function renderRewardsError(modal, error) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');
  const countdown = calculateTimeToMidnightUTC();
  const poolInfoHtml = renderPoolInfo();

  content.innerHTML = `
    <div class="bangit-modal-countdown-section">
      <div class="bangit-modal-countdown-label">Next Distribution</div>
      <div class="bangit-modal-countdown-timer">${countdown.formatted}</div>
      ${poolInfoHtml}
    </div>
    <div class="bangit-modal-error">${escapeHtml(error)}</div>
  `;
}

/**
 * Start countdown timer for rewards modal
 */
function startRewardsCountdown(content) {
  const countdownEl = content.querySelector('.bangit-rewards-modal-countdown');
  if (!countdownEl) return;

  const updateCountdown = () => {
    const time = calculateTimeToMidnightUTC();
    countdownEl.textContent = time.formatted;
  };

  // Update every second while modal is open
  const interval = setInterval(() => {
    if (!document.contains(countdownEl)) {
      clearInterval(interval);
      return;
    }
    updateCountdown();
  }, 1000);
}

/**
 * Close rewards modal
 */
export function closeRewardsModal() {
  if (activeRewardsModal) {
    activeRewardsModal.remove();
    activeRewardsModal = null;
  }
}
