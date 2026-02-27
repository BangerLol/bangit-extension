// Bangit - Performance modal (Redesigned)

import { getState } from '../../core/state.js';
import { sendMessage, MessageTypes } from '../../core/rpc.js';
import { formatNumber, formatDate, escapeHtml } from '../../core/utils.js';

// Active modal reference
let activePerformanceModal = null;

// Modal state
let modalState = {
  selectedMetric: 'taste',
  selectedPeriodIndex: 0,
  expandedCurrent: false,
  expandedDistributions: new Set(),
  curationStats: null,
  distributions: null,
  currentPeriodVotes: null
};

// Metric definitions
const METRICS = [
  { key: 'vision', label: 'Vision' },
  { key: 'taste', label: 'Taste' },
  { key: 'motion', label: 'Motion' }
];

const METRIC_DESCRIPTIONS = {
  vision: "change in tweet's net impact 💥\nsince vote, in same direction, log-scaled\n\u2248 % price change since entry",
  taste: "Vision \u00D7 Conviction\nwins scaled by confidence\n\u2248 % PnL",
  motion: "Vision \u00D7 Conviction \u00D7 Power\nprimary score for rewards/slashing\n\u2248 $ PnL"
};

// Period definitions
const PERIODS = [
  { key: 'stats24h', label: 'Last 24h' },
  { key: 'stats3d', label: 'Last 3d' },
  { key: 'stats7d', label: 'Last 7d' },
  { key: 'stats30d', label: 'Last 30d' },
  { key: 'statsAllTime', label: 'All Time' }
];

/**
 * Create Performance modal
 */
export async function createPerformanceModal() {
  // Close any existing modal
  if (activePerformanceModal) {
    activePerformanceModal.remove();
    activePerformanceModal = null;
  }

  // Reset state
  modalState = {
    selectedMetric: 'taste',
    selectedPeriodIndex: 0,
    expandedCurrent: false,
    expandedDistributions: new Set(),
    curationStats: null,
    distributions: null,
    currentPeriodVotes: null
  };

  const modal = document.createElement('div');
  modal.className = 'bangit-sidebar-modal-overlay';

  modal.innerHTML = `
    <div class="bangit-sidebar-modal bangit-performance-modal">
      <button class="bangit-sidebar-modal-close" aria-label="Close">&times;</button>
      <h2 class="bangit-sidebar-modal-title">Performance</h2>
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
    if (activePerformanceModal === modal) {
      activePerformanceModal = null;
    }
  };

  modal.querySelector('.bangit-sidebar-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.body.appendChild(modal);
  activePerformanceModal = modal;

  // Fetch data in parallel
  try {
    const [statsResponse, distributionsResponse] = await Promise.all([
      sendMessage(MessageTypes.GET_CURATION_STATS),
      sendMessage(MessageTypes.GET_REWARD_DISTRIBUTIONS)
    ]);

    if (statsResponse.success) {
      modalState.curationStats = statsResponse.data;
    }
    if (distributionsResponse.success) {
      // API returns array directly, not wrapped in { distributions: [...] }
      modalState.distributions = Array.isArray(distributionsResponse.data)
        ? distributionsResponse.data
        : (distributionsResponse.data?.distributions || []);
    }

    renderPerformanceContent(modal);
  } catch (error) {
    console.error('[Bangit] Error loading performance data:', error);
    renderPerformanceError(modal, error.message);
  }
}

/**
 * Render main performance content
 */
function renderPerformanceContent(modal) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');
  const data = modalState.curationStats || {};

  content.innerHTML = `
    <!-- Stats Card -->
    <div class="bangit-modal-stats-card">
      <!-- Metric Tabs -->
      <div class="bangit-modal-metric-tabs" style="--tab-index: ${METRICS.findIndex(m => m.key === modalState.selectedMetric)}">
        <div class="bangit-modal-metric-indicator"></div>
        ${METRICS.map(m => `
          <button class="bangit-modal-metric-tab ${modalState.selectedMetric === m.key ? 'bangit-metric-tab-active' : ''}"
                  data-metric="${m.key}">
            <span class="bangit-metric-tab-label">${m.label}</span>
          </button>
        `).join('')}
      </div>

      <!-- Metric Description -->
      <div class="bangit-modal-metric-description">${METRIC_DESCRIPTIONS[modalState.selectedMetric]}</div>

      <!-- Period Navigation -->
      <div class="bangit-modal-period-nav">
        <button class="bangit-modal-period-btn bangit-period-prev" aria-label="Previous period">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="bangit-modal-period-info">
          <div class="bangit-modal-period-label">${PERIODS[modalState.selectedPeriodIndex].label}</div>
          <div class="bangit-modal-period-value ${getValueClass(getCurrentMetricValue(data))}">${formatMetricValue(getCurrentMetricValue(data))}</div>
          <div class="bangit-modal-period-percentile">${getPercentileText(data)}</div>
        </div>
        <button class="bangit-modal-period-btn bangit-period-next" aria-label="Next period">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>

      <!-- Period Dots -->
      <div class="bangit-modal-period-dots">
        ${PERIODS.map((p, i) => `
          <button class="bangit-modal-period-dot ${i === modalState.selectedPeriodIndex ? 'active' : ''}"
                  data-index="${i}" aria-label="${p.label}"></button>
        `).join('')}
      </div>
    </div>

    <!-- Period Cards Section -->
    <div class="bangit-performance-history-section">
      <div class="bangit-performance-history-list">
        <!-- Current Period Card -->
        <div class="bangit-modal-card bangit-current-period-card ${modalState.expandedCurrent ? 'expanded' : ''}" data-card="current">
          <div class="bangit-modal-card-header">
            <span class="bangit-modal-card-title">Current</span>
            <svg class="bangit-modal-card-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          <div class="bangit-modal-card-content" id="current-period-content">
            <div class="bangit-modal-loading">
              <div class="bangit-modal-spinner"></div>
            </div>
          </div>
        </div>

        <!-- Historical Distribution Cards -->
        ${renderDistributionCards()}
      </div>
    </div>
  `;

  // Set up event listeners
  setupEventListeners(modal);

  // Load current period votes if expanded
  if (modalState.expandedCurrent) {
    loadCurrentPeriodVotes(modal);
  }
}

/**
 * Render distribution cards
 */
function renderDistributionCards() {
  const distributions = modalState.distributions || [];

  if (distributions.length === 0) {
    return '';
  }

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
 * Set up event listeners
 */
function setupEventListeners(modal) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');

  // Metric tab clicks
  content.querySelectorAll('.bangit-modal-metric-tab').forEach((tab, index) => {
    tab.addEventListener('click', () => {
      const metricTabs = content.querySelector('.bangit-modal-metric-tabs');
      metricTabs.style.setProperty('--tab-index', index);
      modalState.selectedMetric = tab.dataset.metric;
      updateStatsDisplay(modal);
    });
  });

  // Period navigation
  content.querySelector('.bangit-period-prev')?.addEventListener('click', () => {
    if (modalState.selectedPeriodIndex > 0) {
      modalState.selectedPeriodIndex--;
      updateStatsDisplay(modal);
    }
  });

  content.querySelector('.bangit-period-next')?.addEventListener('click', () => {
    if (modalState.selectedPeriodIndex < PERIODS.length - 1) {
      modalState.selectedPeriodIndex++;
      updateStatsDisplay(modal);
    }
  });

  // Period dot clicks
  content.querySelectorAll('.bangit-modal-period-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      modalState.selectedPeriodIndex = parseInt(dot.dataset.index);
      updateStatsDisplay(modal);
    });
  });

  // Card expand/collapse
  content.querySelectorAll('.bangit-modal-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.bangit-modal-card');
      const cardId = card.dataset.card;

      if (cardId === 'current') {
        modalState.expandedCurrent = !modalState.expandedCurrent;
        card.classList.toggle('expanded', modalState.expandedCurrent);
        if (modalState.expandedCurrent && !modalState.currentPeriodVotes) {
          loadCurrentPeriodVotes(modal);
        }
      } else if (cardId.startsWith('dist-')) {
        const distId = cardId.replace('dist-', '');
        const isExpanded = modalState.expandedDistributions.has(distId);

        if (isExpanded) {
          modalState.expandedDistributions.delete(distId);
          card.classList.remove('expanded');
        } else {
          modalState.expandedDistributions.add(distId);
          card.classList.add('expanded');
          loadDistributionDetails(modal, distId);
        }
      }
    });
  });
}

/**
 * Update stats display (metric tabs, value, percentile, dots)
 */
function updateStatsDisplay(modal) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');
  const data = modalState.curationStats || {};

  // Update active metric tab and indicator position
  const metricTabs = content.querySelector('.bangit-modal-metric-tabs');
  if (metricTabs) {
    const tabIndex = METRICS.findIndex(m => m.key === modalState.selectedMetric);
    metricTabs.style.setProperty('--tab-index', tabIndex);
  }
  content.querySelectorAll('.bangit-modal-metric-tab').forEach((tab, idx) => {
    const isActive = tab.dataset.metric === modalState.selectedMetric;
    tab.classList.toggle('bangit-metric-tab-active', isActive);
  });

  // Update description
  const desc = content.querySelector('.bangit-modal-metric-description');
  if (desc) desc.textContent = METRIC_DESCRIPTIONS[modalState.selectedMetric];

  // Update period label
  const label = content.querySelector('.bangit-modal-period-label');
  if (label) label.textContent = PERIODS[modalState.selectedPeriodIndex].label;

  // Update value
  const value = getCurrentMetricValue(data);
  const valueEl = content.querySelector('.bangit-modal-period-value');
  if (valueEl) {
    valueEl.textContent = formatMetricValue(value);
    valueEl.className = `bangit-modal-period-value ${getValueClass(value)}`;
  }

  // Update percentile
  const percentile = content.querySelector('.bangit-modal-period-percentile');
  if (percentile) percentile.textContent = getPercentileText(data);

  // Update dots
  content.querySelectorAll('.bangit-modal-period-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === modalState.selectedPeriodIndex);
  });
}

/**
 * Get current metric value based on selected metric and period
 */
function getCurrentMetricValue(data) {
  const periodKey = PERIODS[modalState.selectedPeriodIndex].key;
  const periodData = data[periodKey] || {};
  return periodData[modalState.selectedMetric];
}

/**
 * Get percentile text for current selection
 */
function getPercentileText(data) {
  const periodKey = PERIODS[modalState.selectedPeriodIndex].key;
  const periodData = data[periodKey] || {};
  const percentileKey = `${modalState.selectedMetric}Percentile`;
  const percentile = periodData[percentileKey];

  if (percentile === undefined || percentile === null) return '';
  return `Top ${(percentile).toFixed(1)}%`;
}

/**
 * Get CSS class for value (positive/negative)
 */
function getValueClass(value) {
  if (value === undefined || value === null) return '';
  return value >= 0 ? 'positive' : 'negative';
}

/**
 * Format metric value for display (handles negative numbers with sign)
 */
function formatMetricValue(value) {
  if (value === undefined || value === null) return '--';
  const prefix = value >= 0 ? '+' : '';
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000000) return prefix + (value / 1000000).toFixed(2) + 'M';
    if (Math.abs(value) >= 1000) return prefix + (value / 1000).toFixed(2) + 'K';
    return prefix + value.toFixed(2);
  }
  return String(value);
}

/**
 * Format number with abbreviation (handles negative numbers)
 * Returns formatted string like "1.89K" or "-1.89K"
 */
function formatAbbrevNumber(value) {
  if (value === undefined || value === null) return '--';
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absValue >= 1000000) return sign + (absValue / 1000000).toFixed(2) + 'M';
  if (absValue >= 1000) return sign + (absValue / 1000).toFixed(2) + 'K';
  return sign + absValue.toFixed(2);
}

/**
 * Format distribution date range
 */
function formatDistributionDateRange(dist) {
  // API returns periodStart/periodEnd
  if (dist.periodStart && dist.periodEnd) {
    const start = new Date(dist.periodStart);
    const end = new Date(dist.periodEnd);
    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  }
  // Fallback to old field names
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
 * Load current period votes
 */
async function loadCurrentPeriodVotes(modal) {
  const container = modal.querySelector('#current-period-content');
  if (!container) return;

  try {
    const response = await sendMessage('GET_CURRENT_PERIOD_PERFORMANCE');
    if (response.success) {
      modalState.currentPeriodVotes = response.data;
      renderCurrentPeriodContent(container, response.data);
    } else {
      container.innerHTML = `<div class="bangit-modal-empty">No data available</div>`;
    }
  } catch (error) {
    console.error('[Bangit] Error loading current period:', error);
    container.innerHTML = `<div class="bangit-modal-error">Failed to load</div>`;
  }
}

/**
 * Render current period content
 */
function renderCurrentPeriodContent(container, data) {
  const votes = data.periodVotes || data.periodPerformance || data.votes || [];
  const summary = data.periodSummary || data.summary || {};

  if (votes.length === 0 && !summary.motion) {
    container.innerHTML = `<div class="bangit-modal-empty">No votes in current period</div>`;
    return;
  }

  container.innerHTML = `
    <!-- Period Summary -->
    <div class="bangit-period-summary">
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Motion</span>
        <span class="bangit-period-summary-value ${getValueClass(summary.motion)}">${formatMetricValue(summary.motion)}</span>
      </div>
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Motion Percentile</span>
        ${summary.motionPercentile !== null && summary.motionPercentile !== undefined
          ? `<span class="bangit-period-summary-value ${summary.motionPercentile > 0.5 ? 'negative' : 'positive'}">Top ${(summary.motionPercentile * 100).toFixed(2)}%</span>`
          : `<span class="bangit-period-summary-value pending">Pending</span>`}
      </div>
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Curator Rewards</span>
        ${summary.curatorRewardsEarned !== null && summary.curatorRewardsEarned !== undefined
          ? `<span class="bangit-period-summary-value ${getValueClass(summary.curatorRewardsEarned)}">${summary.curatorRewardsEarned >= 0 ? '+' : ''}${formatNumber(summary.curatorRewardsEarned / 1e9)} BANG</span>`
          : `<span class="bangit-period-summary-value pending">Pending</span>`}
      </div>
      ${summary.jackpotTokens !== null && summary.jackpotTokens > 0 ? `
        <div class="bangit-period-summary-row bangit-jackpot-row">
          <span class="bangit-period-summary-label bangit-jackpot-label">Won Jackpot!</span>
          <span class="bangit-period-summary-value bangit-jackpot-value">+${formatNumber(summary.jackpotTokens / 1e9)} BANG</span>
        </div>
      ` : ''}
    </div>

    <!-- Vote Cards -->
    <div class="bangit-period-votes">
      ${votes.map(vote => renderVoteCard(vote, true)).join('')}
    </div>
  `;
}

/**
 * Load distribution details
 */
async function loadDistributionDetails(modal, distId) {
  const card = modal.querySelector(`[data-card="dist-${distId}"]`);
  const container = card?.querySelector('.bangit-modal-card-content');
  if (!container) return;

  container.innerHTML = `<div class="bangit-modal-loading"><div class="bangit-modal-spinner"></div></div>`;

  try {
    const response = await sendMessage('GET_DISTRIBUTION_PERFORMANCE', { distributionId: distId });
    if (response.success) {
      renderDistributionContent(container, response.data);
    } else {
      container.innerHTML = `<div class="bangit-modal-error">Failed to load details</div>`;
    }
  } catch (error) {
    console.error('[Bangit] Error loading distribution details:', error);
    container.innerHTML = `<div class="bangit-modal-error">Failed to load details</div>`;
  }
}

/**
 * Render distribution content
 */
function renderDistributionContent(container, data) {
  const votes = data.periodVotes || data.periodPerformance || data.votes || [];
  const summary = data.periodSummary || data.summary || {};

  container.innerHTML = `
    <!-- Period Summary -->
    <div class="bangit-period-summary">
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Motion</span>
        <span class="bangit-period-summary-value ${getValueClass(summary.motion)}">${formatMetricValue(summary.motion)}</span>
      </div>
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Motion Percentile</span>
        ${summary.motionPercentile !== null && summary.motionPercentile !== undefined
          ? `<span class="bangit-period-summary-value ${summary.motionPercentile > 0.5 ? 'negative' : 'positive'}">Top ${(summary.motionPercentile * 100).toFixed(2)}%</span>`
          : `<span class="bangit-period-summary-value pending">Pending</span>`}
      </div>
      <div class="bangit-period-summary-row">
        <span class="bangit-period-summary-label">Curator Rewards</span>
        ${summary.curatorRewardsEarned !== null && summary.curatorRewardsEarned !== undefined
          ? `<span class="bangit-period-summary-value ${getValueClass(summary.curatorRewardsEarned)}">${summary.curatorRewardsEarned >= 0 ? '+' : ''}${formatNumber(summary.curatorRewardsEarned / 1e9)} BANG</span>`
          : `<span class="bangit-period-summary-value pending">Pending</span>`}
      </div>
      ${summary.jackpotTokens !== null && summary.jackpotTokens > 0 ? `
        <div class="bangit-period-summary-row bangit-jackpot-row">
          <span class="bangit-period-summary-label bangit-jackpot-label">Won Jackpot!</span>
          <span class="bangit-period-summary-value bangit-jackpot-value">+${formatNumber(summary.jackpotTokens / 1e9)} BANG</span>
        </div>
      ` : ''}
    </div>

    <!-- Vote Cards -->
    ${votes.length > 0 ? `
      <div class="bangit-period-votes">
        ${votes.map(vote => renderVoteCard(vote, false)).join('')}
      </div>
    ` : '<div class="bangit-modal-empty">No votes in this period</div>'}
  `;
}

/**
 * Calculate reward period progress for a vote (24h window)
 */
function getRewardPeriodProgress(createdAt) {
  if (!createdAt) return { progress: 0, timeRemaining: 'Unknown' };

  const voteTime = new Date(createdAt).getTime();
  const elapsed = Date.now() - voteTime;
  const twentyFourHours = 24 * 60 * 60 * 1000;
  const progress = Math.min(elapsed / twentyFourHours, 1);

  if (progress >= 1) {
    return { progress: 1, timeRemaining: 'Complete' };
  }

  const remaining = twentyFourHours - elapsed;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  return { progress, timeRemaining: `${hours}h ${minutes}m remaining` };
}

/**
 * Render a vote card
 * @param {Object} vote - Vote data from API
 * @param {boolean} isCurrent - Whether this is from the current period
 */
function renderVoteCard(vote, isCurrent = false) {
  // Handle both old and new data structures
  const direction = (vote.voteDirection || vote.direction || '').toLowerCase();
  const isUpvote = direction === 'upvote' || direction === 'up';
  const directionClass = isUpvote ? 'upvote' : 'downvote';

  // Get values from new structure (vote.post.author) or fallback to old structure
  const avatarUrl = vote.post?.author?.twitterAvatarUrl || vote.tweetAuthorAvatar;
  const username = vote.post?.author?.twitterUsername || vote.tweetAuthor || 'unknown';
  const tweetId = vote.post?.tweetId || vote.tweetId;
  const tweetText = vote.post?.text || '';
  const truncatedText = tweetText.length > 20 ? tweetText.slice(0, 20) + '...' : tweetText;

  // Get impact values
  const entryImpact = vote.impactAfterVote;
  const currentImpact = vote.markRealtimeNetImpact;

  // Conviction is X/20 in frontend
  const conviction = vote.conviction || 0;

  // Power allocated
  const power = vote.powerAllocated || 0;

  // Vision value
  const vision = vote.voteVision !== undefined ? vote.voteVision : vote.vision;
  const visionClass = vision >= 0 ? 'positive' : 'negative';

  // Taste value (vision × conviction)
  const taste = vote.taste !== undefined ? vote.taste : 0;
  const tasteClass = taste >= 0 ? 'positive' : 'negative';

  // Motion value (taste × sqrt(power))
  const motion = vote.motion !== undefined ? vote.motion : 0;
  const motionClass = motion >= 0 ? 'positive' : 'negative';

  // Card border based on motion value (not vote direction)
  const motionBorderClass = motion >= 0 ? 'motion-positive' : 'motion-negative';

  // Reward period progress (24h countdown from vote creation)
  const rewardProgress = getRewardPeriodProgress(vote.createdAt);

  return `
    <div class="bangit-vote-card ${motionBorderClass}">
      <p class="bangit-vote-card-direction ${directionClass}">${isUpvote ? 'Upvote' : 'Downvote'}</p>
      <div class="bangit-vote-card-avatar">
        <img src="${escapeHtml(avatarUrl || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png')}" alt="" class="bangit-vote-card-avatar-img" />
      </div>
      <div class="bangit-vote-card-info">
        <p class="bangit-vote-card-tweet">
          <span class="bangit-vote-card-tweet-link" data-tweet-id="${escapeHtml(tweetId)}">Tweet</span> by @${escapeHtml(username)}
        </p>
        ${truncatedText ? `<p class="bangit-vote-card-text">${escapeHtml(truncatedText)}</p>` : ''}
      </div>
      <div class="bangit-vote-card-grid">
        <div class="bangit-vote-card-column">
          <p class="bangit-vote-card-label">Entry</p>
          <p class="bangit-vote-card-value">${entryImpact !== undefined ? formatAbbrevNumber(entryImpact) : 'N/A'}</p>
          <p class="bangit-vote-card-label mt">${rewardProgress.progress < 1 ? 'Current' : 'Final'}</p>
          <p class="bangit-vote-card-value">${formatAbbrevNumber(currentImpact)}</p>
          <p class="bangit-vote-card-label mt">Vision</p>
          <p class="bangit-vote-card-value ${visionClass}">${vision >= 0 ? '+' : ''}${formatAbbrevNumber(vision)}</p>
        </div>
        <div class="bangit-vote-card-column">
          <div class="bangit-vote-card-spacer"></div>
          <p class="bangit-vote-card-label">Conviction</p>
          <p class="bangit-vote-card-value">${conviction}/20</p>
          <p class="bangit-vote-card-label mt">Taste</p>
          <p class="bangit-vote-card-value ${tasteClass}">${taste >= 0 ? '+' : ''}${formatAbbrevNumber(taste)}</p>
        </div>
        <div class="bangit-vote-card-column">
          <div class="bangit-vote-card-spacer"></div>
          <p class="bangit-vote-card-label">Power</p>
          <p class="bangit-vote-card-value">${formatAbbrevNumber(power)}</p>
          <p class="bangit-vote-card-label mt">Motion</p>
          <p class="bangit-vote-card-value ${motionClass}">${motion >= 0 ? '+' : ''}${formatAbbrevNumber(motion)}</p>
        </div>
      </div>
      <div class="bangit-reward-period">
        <div class="bangit-reward-period-header">
          <p class="bangit-reward-period-label">Reward Period</p>
          <p class="bangit-reward-period-time ${rewardProgress.progress >= 1 ? 'complete' : ''}">${rewardProgress.timeRemaining}</p>
        </div>
        <div class="bangit-reward-period-bar">
          <div class="bangit-reward-period-bar-fill ${rewardProgress.progress >= 1 ? 'complete' : ''}" style="width: ${rewardProgress.progress * 100}%"></div>
        </div>
        <p class="bangit-reward-period-pct">${(rewardProgress.progress * 100).toFixed(0)}%</p>
      </div>
    </div>
  `;
}

/**
 * Render error state
 */
function renderPerformanceError(modal, error) {
  const content = modal.querySelector('.bangit-sidebar-modal-content');
  content.innerHTML = `
    <div class="bangit-modal-error">${escapeHtml(error || 'Failed to load performance data')}</div>
  `;
}

/**
 * Close performance modal
 */
export function closePerformanceModal() {
  if (activePerformanceModal) {
    activePerformanceModal.remove();
    activePerformanceModal = null;
  }
}
