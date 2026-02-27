// Bangit - Vote execution handler

import { getState } from '../../core/state.js';
import { CONFIG } from '../../core/config.js';
import { calculateTaste } from '../../core/utils.js';
import { castVote } from '../../core/rpc.js';
import { markTweetAsVoted, updateTweetVoteDisplay } from '../tweets/vote-ui.js';
import { animateImpactChange } from '../tweets/animations.js';
import { showToast } from '../modals/toast.js';

/**
 * Execute the actual vote
 * @param {string} tweetId - Tweet ID to vote on
 * @param {'up'|'down'} voteType - Vote type
 * @param {number} maxPowerPct - Power percentage to use
 */
export async function executeVote(tweetId, voteType, maxPowerPct) {
  const state = getState();
  const container = document.querySelector(`.bangit-stats-container[data-tweet-id="${tweetId}"]`);
  const voteBtn = container?.querySelector('.bangit-vote-btn');
  if (!container || !voteBtn) return;

  voteBtn.disabled = true;
  voteBtn.classList.add('bangit-loading');

  // Store the previous impact value before the vote
  const previousImpact = state.tweets.impacts.get(tweetId) || 0;

  try {
    const response = await castVote(tweetId, voteType, maxPowerPct);

    if (response.success) {
      // Extract vote record from response
      const voteRecord = response.data?.upvote || response.data?.downvote;
      const impactAfterVote = voteRecord?.realtimeNetImpactAfterVote != null
        ? Number(voteRecord.realtimeNetImpactAfterVote) : null;
      const votedMaxPowerPct = voteRecord?.maxPowerPct ?? maxPowerPct;
      const votePower = voteRecord?.power != null ? Number(voteRecord.power) : null;

      // Mark as voted with timestamp and metrics
      const voteData = {
        voteType: voteType,
        lastVotedAt: new Date()
      };
      if (impactAfterVote != null) {
        voteData.impactAfterVote = impactAfterVote;
        voteData.maxPowerPct = votedMaxPowerPct;
        voteData.power = votePower;
      }
      state.tweets.voted.set(tweetId, voteData);

      // Get the updated post data
      const updatedPost = response.data?.updatedPost || response.data;
      const newImpact = updatedPost?.realtimeNetImpact ?? previousImpact;

      // Compute initial taste (will be ~0 since impact just changed)
      let tasteScore = null;
      if (impactAfterVote != null) {
        tasteScore = calculateTaste(voteType, newImpact, impactAfterVote, votedMaxPowerPct);
      }

      // Update UI with taste score
      const hoursRemaining = CONFIG.COOLDOWN_HOURS;
      markTweetAsVoted(container, voteType, hoursRemaining, tasteScore);

      // Animate the impact change
      updateTweetVoteDisplay(tweetId, { realtimeNetImpact: newImpact }, true, voteType, animateImpactChange);

      showToast(`${voteType === 'up' ? 'Upvoted' : 'Downvoted'} successfully!`, 'success');
    } else {
      showToast(response.error || 'Failed to vote', 'error');
    }
  } catch (error) {
    console.error('[Bangit] Vote error:', error);
    showToast('Failed to cast vote. Please try again.', 'error');
  } finally {
    voteBtn.disabled = false;
    voteBtn.classList.remove('bangit-loading');
  }
}
