// Bangit - Vote UI components for tweets

import { getState } from '../../core/state.js';
import { formatNumber, normalizeVoteType, calculateTaste } from '../../core/utils.js';
import { CONFIG } from '../../core/config.js';

/**
 * Create stats container with impact indicator and vote button
 * @param {string} tweetId - Tweet ID
 * @param {boolean} isMainTweet - Is this the main tweet on detail page
 * @param {Function} onVoteClick - Vote click handler
 * @returns {HTMLElement}
 */
export function createStatsContainer(tweetId, isMainTweet = false, onVoteClick) {
  const state = getState();
  const container = document.createElement('div');
  container.className = 'bangit-stats-container' + (isMainTweet ? ' bangit-main-tweet' : '');
  container.dataset.tweetId = tweetId;

  // Impact stat (display only, not clickable)
  const impactStat = document.createElement('div');
  impactStat.className = 'bangit-impact';
  impactStat.dataset.tweetId = tweetId;
  impactStat.dataset.tooltip = 'Net Impact\nfrom votes';
  impactStat.innerHTML = `
    <span class="bangit-impact-glow"></span>
    <span class="bangit-impact-change"></span>
    <span class="bangit-impact-icon">💥</span>
    <span class="bangit-impact-value">0</span>
  `;

  // Initialize impact value tracking
  state.tweets.impacts.set(tweetId, 0);

  // Vote button
  const voteBtn = document.createElement('button');
  voteBtn.className = 'bangit-vote-btn';
  voteBtn.dataset.tweetId = tweetId;
  voteBtn.innerHTML = `<span class="bangit-vote-btn-text">Vote</span>`;
  voteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onVoteClick) {
      onVoteClick(tweetId);
    } else {
      console.error('[Bangit] Vote click handler not set for tweet:', tweetId);
    }
  });

  container.appendChild(impactStat);
  container.appendChild(voteBtn);

  return container;
}

/**
 * Format a taste score for display (sign + 1 decimal)
 * @param {number} score - Taste score
 * @returns {string} Formatted score like "+2.3" or "-1.1"
 */
function formatTasteScore(score) {
  const rounded = Math.round(score * 100) / 100;
  if (rounded === 0) return '0.00';
  const sign = rounded > 0 ? '+' : '';
  return sign + rounded.toFixed(2);
}

/**
 * Mark tweet as already voted (in cooldown)
 * @param {HTMLElement} container - Stats container element
 * @param {string} voteType - 'up' or 'down'
 * @param {number} hoursRemaining - Hours remaining in cooldown
 * @param {number|null} tasteScore - Taste score to display (null for legacy votes)
 */
export function markTweetAsVoted(container, voteType, hoursRemaining, tasteScore = null) {
  const voteBtn = container.querySelector('.bangit-vote-btn');
  const impactStat = container.querySelector('.bangit-impact');
  const normalizedVoteType = normalizeVoteType(voteType);

  if (voteBtn) {
    voteBtn.classList.add('bangit-voted');
    voteBtn.classList.add(normalizedVoteType === 'up' ? 'bangit-voted-up' : 'bangit-voted-down');

    if (tasteScore != null) {
      voteBtn.innerHTML = `<span class="bangit-vote-btn-text" title="Taste (% PnL)">${formatTasteScore(tasteScore)}</span>`;
    } else {
      voteBtn.innerHTML = `<span class="bangit-vote-btn-text">Voted</span>`;
    }
  }

  if (impactStat) {
    impactStat.classList.add(normalizedVoteType === 'up' ? 'bangit-voted-up' : 'bangit-voted-down');
  }
}

/**
 * Update taste display on a voted tweet button
 * @param {string} tweetId - Tweet ID
 * @param {number} tasteScore - New taste score
 */
export function updateTasteDisplay(tweetId, tasteScore) {
  const container = document.querySelector(`.bangit-stats-container[data-tweet-id="${tweetId}"]`);
  if (!container) return;

  const voteBtn = container.querySelector('.bangit-vote-btn');
  if (!voteBtn || !voteBtn.classList.contains('bangit-voted')) return;

  const textEl = voteBtn.querySelector('.bangit-vote-btn-text');
  if (textEl) {
    textEl.textContent = formatTasteScore(tasteScore);
  }
}

/**
 * Mark tweet as votable again after cooldown
 * @param {HTMLElement} container - Stats container element
 */
export function markTweetAsVotable(container) {
  const voteBtn = container.querySelector('.bangit-vote-btn');
  const impactStat = container.querySelector('.bangit-impact');

  if (voteBtn) {
    voteBtn.classList.remove('bangit-voted', 'bangit-voted-up', 'bangit-voted-down');
    voteBtn.innerHTML = `<span class="bangit-vote-btn-text">Vote</span>`;
  }

  if (impactStat) {
    impactStat.classList.remove('bangit-voted-up', 'bangit-voted-down');
  }
}

/**
 * Update tweet UI with basic data from batch fetch
 * @param {object} tweetData - Tweet data from API
 * @param {Function} updateDisplay - Function to update display
 */
export function updateTweetWithBasicData(tweetData, updateDisplay) {
  const state = getState();
  const {
    tweetId, upvoters, downvoters, realtimeNetImpact, upPower, downPower,
    lastVotedAt, lastVoteDirection,
    lastVoteImpactAfterVote, lastVoteMaxPowerPct, lastVotePower
  } = tweetData;

  // Track the initial impact value (no animation on initial load)
  state.tweets.impacts.set(tweetId, realtimeNetImpact || 0);

  // Update vote display without animation (initial load)
  if (updateDisplay) {
    updateDisplay(tweetId, {
      upvoters,
      downvoters,
      realtimeNetImpact,
      upPower,
      downPower
    }, false);
  }

  // Handle user's vote status and cooldown
  if (lastVotedAt && lastVoteDirection) {
    const votedDate = new Date(lastVotedAt);
    const now = new Date();
    const hoursSinceVote = (now - votedDate) / (1000 * 60 * 60);
    const normalizedDirection = normalizeVoteType(lastVoteDirection);

    // Store vote metrics for real-time taste recalculation
    const voteData = {
      voteType: normalizedDirection,
      lastVotedAt: votedDate
    };
    if (lastVoteImpactAfterVote != null && lastVoteMaxPowerPct != null) {
      voteData.impactAfterVote = lastVoteImpactAfterVote;
      voteData.maxPowerPct = lastVoteMaxPowerPct;
      voteData.power = lastVotePower;
    }
    state.tweets.voted.set(tweetId, voteData);

    // Compute taste score if we have the snapshot data
    let tasteScore = null;
    if (lastVoteImpactAfterVote != null && lastVoteMaxPowerPct != null) {
      tasteScore = calculateTaste(normalizedDirection, realtimeNetImpact || 0, lastVoteImpactAfterVote, lastVoteMaxPowerPct);
    }

    const container = document.querySelector(`.bangit-stats-container[data-tweet-id="${tweetId}"]`);
    if (container) {
      if (hoursSinceVote >= CONFIG.COOLDOWN_HOURS) {
        markTweetAsVotable(container);
      } else {
        const hoursRemaining = CONFIG.COOLDOWN_HOURS - hoursSinceVote;
        markTweetAsVoted(container, lastVoteDirection, hoursRemaining, tasteScore);
      }
    }
  }
}

/**
 * Update tweet vote display with new values
 * @param {string} tweetId - Tweet ID
 * @param {object} data - Vote data
 * @param {boolean} animate - Whether to animate the change
 * @param {string} direction - 'up' or 'down' for animation direction
 * @param {Function} animateImpact - Animation function
 */
export function updateTweetVoteDisplay(tweetId, data, animate = false, direction = null, animateImpact = null) {
  const state = getState();
  const container = document.querySelector(`.bangit-stats-container[data-tweet-id="${tweetId}"]`);
  if (!container) return;

  const impactIndicator = container.querySelector('.bangit-impact');
  if (!impactIndicator) return;

  const newValue = data?.realtimeNetImpact || 0;
  const previousValue = state.tweets.impacts.get(tweetId) || 0;

  if (animate && animateImpact && previousValue !== newValue) {
    animateImpact(tweetId, previousValue, newValue, direction);
  } else {
    const impactValue = impactIndicator.querySelector('.bangit-impact-value');
    if (impactValue) {
      // Preserve negative sign for negative values
      const sign = newValue < 0 ? '-' : '';
      impactValue.textContent = sign + formatNumber(Math.abs(newValue));
      impactValue.style.color = '#f2c1fb';
    }
    state.tweets.impacts.set(tweetId, newValue);
  }
}
