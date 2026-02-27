// Bangit - Tweet observers (Mutation & Intersection)

import { getState, updateState } from '../../core/state.js';
import { CONFIG } from '../../core/config.js';
import { debounce } from '../../core/utils.js';
import { getTweetsBasic } from '../../core/rpc.js';
import { extractTweetId, findActionBar, isMainTweet } from './processor.js';
import { createStatsContainer, updateTweetWithBasicData, updateTweetVoteDisplay } from './vote-ui.js';
import { animateImpactChange } from './animations.js';

// Module-level reference to vote click handler (set by feature init)
let voteClickHandler = null;
let pollIntervalId = null;
let cleanupIntervalId = null;
let visibilityHandler = null;

/**
 * Set the vote click handler
 * @param {Function} handler - Handler function
 */
export function setVoteClickHandler(handler) {
  voteClickHandler = handler;
}

/**
 * Set up Intersection Observer to detect when tweets enter viewport
 */
export function setupIntersectionObserver() {
  const state = getState();

  // Disconnect existing observer
  if (state.observers.intersection) {
    state.observers.intersection.disconnect();
  }

  const options = {
    root: null,
    rootMargin: '100px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const tweetElement = entry.target;
        const tweetId = extractTweetId(tweetElement);

        if (tweetId && !state.tweets.pending.has(tweetId)) {
          state.tweets.pending.add(tweetId);
          scheduleBatchFetch();
        }
      }
    });
  }, options);

  updateState('observers', { intersection: observer });
}

/**
 * Schedule a batch fetch of tweet data
 */
function scheduleBatchFetch() {
  const state = getState();

  // Clear existing timeout
  if (state.timers.fetchBatchTimeout) {
    clearTimeout(state.timers.fetchBatchTimeout);
  }

  // Wait a bit to collect multiple tweets, then fetch in batch
  const timeout = setTimeout(() => {
    fetchBatchTweetData();
  }, CONFIG.BATCH_FETCH_DELAY);

  updateState('timers', { fetchBatchTimeout: timeout });
}

/**
 * Fetch data for all pending tweets in a single batch request
 */
async function fetchBatchTweetData() {
  const state = getState();

  if (state.tweets.pending.size === 0) return;

  const tweetIds = Array.from(state.tweets.pending);
  state.tweets.pending.clear();

  try {
    const response = await getTweetsBasic(tweetIds);
    console.log('[Bangit] Tweets basic response:', { count: response.data?.tweets?.length || 0 });

    if (response.success && response.data?.tweets) {
      response.data.tweets.forEach(tweetData => {
        updateTweetWithBasicData(tweetData, (tweetId, data, animate) => {
          updateTweetVoteDisplay(tweetId, data, animate, null, animateImpactChange);
        });
      });
    }
  } catch (error) {
    console.error('[Bangit] Error fetching batch tweet data:', error);
    // Re-add failed tweets for retry
    tweetIds.forEach(id => state.tweets.pending.add(id));
  }
}

/**
 * Process visible tweets and add voting buttons
 */
export function processTweets() {
  const state = getState();
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  tweets.forEach(tweet => {
    const tweetId = extractTweetId(tweet);
    if (!tweetId) return;

    const actionBar = findActionBar(tweet);
    if (!actionBar) return;

    // Check if we already added elements to THIS specific tweet element
    if (tweet.querySelector('.bangit-stats-container')) return;

    // Check if this is the main tweet on a detail page
    const isTweetMain = isMainTweet(tweet);

    // Create the stats container with impact indicator and vote button
    const statsContainer = createStatsContainer(tweetId, isTweetMain, voteClickHandler);
    actionBar.insertAdjacentElement('afterbegin', statsContainer);

    // Trigger the graceful entry animation after insertion
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        statsContainer.classList.add('bangit-visible');
      });
    });

    // Track that we've processed this tweet ID
    state.tweets.processed.add(tweetId);

    // Start observing this tweet with Intersection Observer
    if (state.observers.intersection && !tweet.hasAttribute('data-bangit-observed')) {
      tweet.setAttribute('data-bangit-observed', 'true');
      state.observers.intersection.observe(tweet);
    }
  });
}

/**
 * Find the best container to observe for new tweets
 * Prefers more specific containers to reduce observer overhead
 */
function findTimelineContainer() {
  // Try specific timeline containers first (less frequent mutations)
  const selectors = [
    '[data-testid="primaryColumn"]',
    '[aria-label="Home timeline"]',
    '[aria-label*="Timeline"]',
    'main[role="main"]'
  ];

  for (const selector of selectors) {
    const container = document.querySelector(selector);
    if (container) return container;
  }

  // Fallback to body only if nothing else found
  return document.body;
}

/**
 * Observe DOM for new tweets
 */
export function observeTweets() {
  const state = getState();

  // Disconnect existing observer
  if (state.observers.tweets) {
    state.observers.tweets.disconnect();
  }

  // Find a more specific container to observe (reduces observer overhead)
  const timelineContainer = findTimelineContainer();

  // Use MutationObserver to detect new tweets as user scrolls
  const observer = new MutationObserver(debounce(() => {
    processTweets();
  }, CONFIG.DEBOUNCE_DELAY));

  // Observe the timeline container instead of entire document
  observer.observe(timelineContainer, {
    childList: true,
    subtree: true
  });

  updateState('observers', { tweets: observer });

  const startTweetIntervals = () => {
    if (!pollIntervalId) {
      // Fallback poll interval - much longer since MutationObserver handles most cases
      // Only needed for edge cases where mutations might be missed
      pollIntervalId = setInterval(processTweets, 5000); // Increased from 1.5s to 5s
    }

    if (!cleanupIntervalId) {
      // Periodically clean up processedTweets Set to prevent memory leaks
      // Increased from 10s to 30s since this is expensive
      cleanupIntervalId = setInterval(() => {
        const currentState = getState();
        // Use a more efficient cleanup - only clean if sets are large
        if (currentState.tweets.processed.size < 100 && currentState.tweets.pending.size < 50) {
          return; // Skip cleanup for small sets
        }

        const currentTweetIds = new Set();
        document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
          const tweetId = extractTweetId(tweet);
          if (tweetId) currentTweetIds.add(tweetId);
        });

        // Remove tweet IDs that are no longer in DOM
        for (const tweetId of currentState.tweets.processed) {
          if (!currentTweetIds.has(tweetId)) {
            currentState.tweets.processed.delete(tweetId);
          }
        }

        // Also clean up pending fetches for tweets no longer in DOM
        for (const tweetId of currentState.tweets.pending) {
          if (!currentTweetIds.has(tweetId)) {
            currentState.tweets.pending.delete(tweetId);
          }
        }
      }, 30000); // Increased from 10s to 30s

      updateState('timers', { cleanupInterval: cleanupIntervalId });
    }
  };

  const stopTweetIntervals = () => {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }

    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
      updateState('timers', { cleanupInterval: null });
    }
  };

  // Start intervals immediately
  startTweetIntervals();

  // Pause intervals when tab is hidden
  if (!visibilityHandler) {
    visibilityHandler = () => {
      if (document.hidden) {
        stopTweetIntervals();
      } else {
        startTweetIntervals();
        processTweets();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  // Store poll interval for cleanup
  // Note: We need to track this interval for proper cleanup
  return { pollInterval: pollIntervalId, cleanupInterval: cleanupIntervalId };
}

/**
 * Stop observing tweets
 */
export function stopObserving() {
  const state = getState();

  if (state.observers.tweets) {
    state.observers.tweets.disconnect();
    updateState('observers', { tweets: null });
  }

  if (state.observers.intersection) {
    state.observers.intersection.disconnect();
    updateState('observers', { intersection: null });
  }

  if (state.timers.fetchBatchTimeout) {
    clearTimeout(state.timers.fetchBatchTimeout);
    updateState('timers', { fetchBatchTimeout: null });
  }

  if (state.timers.cleanupInterval) {
    clearInterval(state.timers.cleanupInterval);
    updateState('timers', { cleanupInterval: null });
  }

  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}
