// Bangit - Tweets feature module
// Handles tweet detection, UI injection, and vote data fetching

import { getState, updateState } from '../../core/state.js';
import { registerHandler, MessageTypes } from '../../core/rpc.js';
import { calculateTaste } from '../../core/utils.js';
import {
  setupIntersectionObserver,
  observeTweets,
  processTweets,
  stopObserving,
  setVoteClickHandler
} from './observer.js';
import { updateTweetVoteDisplay, updateTasteDisplay } from './vote-ui.js';
import { animateImpactChange } from './animations.js';

// Store interval IDs for cleanup
let pollInterval = null;

/**
 * Tweets feature - detects tweets and injects voting UI
 */
const tweetsFeature = {
  /**
   * Start the tweets feature
   * @param {Function} onVoteClick - Handler for vote button clicks
   */
  async start(onVoteClick) {
    console.log('[Bangit] Starting tweets feature...');

    // Set vote click handler for UI components
    if (onVoteClick) {
      setVoteClickHandler(onVoteClick);
    }

    // Register message handlers for real-time updates
    registerHandler(MessageTypes.VOTE_UPDATE, (message) => {
      const state = getState();
      const previousValue = state.tweets.impacts.get(message.tweetId) || 0;
      const newValue = message.data?.realtimeNetImpact || 0;
      const direction = newValue > previousValue ? 'up' : 'down';

      // Only animate if value actually changed
      if (previousValue !== newValue) {
        updateTweetVoteDisplay(message.tweetId, message.data, true, direction, animateImpactChange);
      } else {
        updateTweetVoteDisplay(message.tweetId, message.data, false);
      }

      // Recalculate taste if user voted on this tweet
      const voteData = state.tweets.voted.get(message.tweetId);
      if (voteData && voteData.impactAfterVote != null && voteData.maxPowerPct != null) {
        const tasteScore = calculateTaste(voteData.voteType, newValue, voteData.impactAfterVote, voteData.maxPowerPct);
        updateTasteDisplay(message.tweetId, tasteScore);
      }

      return { success: true };
    });

    // Set up Intersection Observer for efficient loading
    setupIntersectionObserver();

    // Start observing for new tweets
    const intervals = observeTweets();
    if (intervals) {
      pollInterval = intervals.pollInterval;
    }

    // Initial scan
    processTweets();

    console.log('[Bangit] Tweets feature started');
  },

  /**
   * Stop the tweets feature
   */
  async stop() {
    console.log('[Bangit] Stopping tweets feature...');

    // Stop observers
    stopObserving();

    // Clear poll interval
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // Clear vote click handler
    setVoteClickHandler(null);

    console.log('[Bangit] Tweets feature stopped');
  },

  /**
   * Refresh tweet processing (e.g., after auth change)
   */
  refresh() {
    const state = getState();
    state.tweets.processed.clear();
    processTweets();
  }
};

export default tweetsFeature;

// Export individual functions for use by other modules
export { processTweets } from './observer.js';
export { updateTweetVoteDisplay, markTweetAsVoted, markTweetAsVotable, updateTasteDisplay } from './vote-ui.js';
export { animateImpactChange } from './animations.js';
export { extractTweetId, findActionBar, isMainTweet, isOnHomePage } from './processor.js';
