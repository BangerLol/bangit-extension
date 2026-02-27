// Bangit - Real-time WebSocket Event Handling for Feed
// Handles tweet:impactUpdate and feed:scoreUpdate events

import { getState, updateState } from '../../core/state.js';
import { registerHandler, unregisterHandler, MessageTypes } from '../../core/rpc.js';
import { calculateTaste } from '../../core/utils.js';
import { animateImpactChange } from '../tweets/animations.js';
import { updateTasteDisplay } from '../tweets/vote-ui.js';
import {
  capturePositions,
  calculateDeltas,
  applyInverseTransforms,
  animateToFinalPositions,
  cleanupTransforms,
  addRankGlow,
  removeRankGlows,
  prefersReducedMotion,
} from './flip.js';
import { fetchTweetsByIds } from './feed-api.js';
import { renderTweet, getFeedContent } from './timeline.js';

// Constants
const SCORE_UPDATE_DEBOUNCE_MS = 500; // 500ms - fast enough for realtime feel (matches web)
const REORDER_ANIMATION_MS = 300; // 300ms - tuned for snappy dopamine hits (matches web)
const GLOW_ANIMATION_MS = 800; // Reduced for faster rank up/down glows (was 1500)
const BUMP_GLOW_ANIMATION_MS = 1200; // BUMP/NEW feed pink glow duration
const BUMP_DEBOUNCE_MS = 300; // Debounce time for BUMP feed updates
const INSERTION_DEBOUNCE_MS = 1500; // 1.5 seconds to batch incoming tweets
const MAX_PENDING_INSERTIONS = 10; // Limit pending insertions to prevent API overload

// Feed type mapping
const FEED_TYPE_MAP = {
  hot: 'HOT',
  top: {
    '8h': 'TOP_8H',
    '24h': 'TOP_24H',
    '3d': 'TOP_3D',
    '7d': 'TOP_7D',
    '30d': 'TOP_30D',
  },
};

// Track whether handlers are registered
let handlersRegistered = false;

// Animation concurrency control
let isAnimating = false;
let pendingReorder = null;

/**
 * Get the expected feed type based on current state
 * @returns {string|null} Feed type string or null if not applicable
 */
function getExpectedFeedType() {
  const { sortType, topPeriod } = getState().feed;

  if (sortType === 'hot') {
    return FEED_TYPE_MAP.hot;
  }

  if (sortType === 'top') {
    return FEED_TYPE_MAP.top[topPeriod] || 'TOP_24H';
  }

  // bump and new feeds don't use score-based reordering
  return null;
}

/**
 * Check if a tweet is currently in the feed
 * @param {string} tweetId - Tweet ID to check
 * @returns {boolean}
 */
function isTweetInFeed(tweetId) {
  const { tweetIds } = getState().feed;
  return tweetIds.includes(tweetId);
}

/**
 * Get postId for a tweet from DOM metadata (falls back to empty string).
 * postId is used as backend-consistent tie-breaker for equal scores.
 * @param {string} tweetId
 * @returns {string}
 */
function getTweetPostId(tweetId) {
  const element = document.querySelector(`.bangit-feed-content [data-tweet-id="${tweetId}"]`);
  return element?.dataset?.postId || '';
}

/**
 * Find the currently pinned tweet in hot feed, if present.
 * @param {string[]} tweetIds
 * @returns {string|null}
 */
function getPinnedTweetId(tweetIds) {
  const { sortType } = getState().feed;
  if (sortType !== 'hot') return null;

  const pinnedTweetId = tweetIds.find((tweetId) => {
    const element = document.querySelector(`.bangit-feed-content [data-tweet-id="${tweetId}"]`);
    return element?.dataset?.isPinned === 'true';
  });

  return pinnedTweetId || null;
}

/**
 * Score comparator aligned with backend FeedEntry ordering:
 * score DESC, postId ASC (with stable fallback).
 * @param {{score:number, postId:string, originalIndex:number, tweetId:string}} a
 * @param {{score:number, postId:string, originalIndex:number, tweetId:string}} b
 * @returns {number}
 */
function compareByScoreAndPostId(a, b) {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;

  if (a.postId && b.postId && a.postId !== b.postId) {
    return a.postId.localeCompare(b.postId);
  }

  if (a.originalIndex !== b.originalIndex) {
    return a.originalIndex - b.originalIndex;
  }

  return a.tweetId.localeCompare(b.tweetId);
}

/**
 * Handle vote update (impact animation)
 * @param {object} message - Message from background
 */
function handleVoteUpdate(message) {
  const { tweetId, data } = message;
  const state = getState();

  console.log('[Bangit] Received VOTE_UPDATE:', { tweetId, impact: data.realtimeNetImpact });

  // Only process if feed is active
  if (!state.feed.active) {
    console.log('[Bangit] Ignoring VOTE_UPDATE: feed inactive');
    return;
  }

  const tweetInFeed = isTweetInFeed(tweetId);

  // BUMP feed: handle tweets not in feed by fetching and inserting at top
  if (state.feed.sortType === 'bump') {
    handleBumpFeedUpdate(tweetId, data.timestamp || Date.now(), !tweetInFeed);

    // If tweet is in feed, also animate the impact change
    if (tweetInFeed) {
      const previousValue = data.previousRealtimeNetImpact ?? state.tweets.impacts.get(tweetId) ?? 0;
      const newValue = data.realtimeNetImpact ?? 0;
      if (Math.abs(previousValue - newValue) >= 0.001) {
        const direction = newValue > previousValue ? 'up' : 'down';
        state.tweets.impacts.set(tweetId, newValue);
        animateImpactChange(tweetId, previousValue, newValue, direction);
      }
      // Recalculate taste for voted tweets
      recalcTasteForTweet(state, tweetId, data.realtimeNetImpact ?? 0);
    }
    return;
  }

  // For non-BUMP feeds, only process if tweet is in the feed
  if (!tweetInFeed) {
    console.log('[Bangit] Ignoring VOTE_UPDATE: tweet not in feed (non-BUMP mode)');
    return;
  }

  const previousValue = data.previousRealtimeNetImpact ?? state.tweets.impacts.get(tweetId) ?? 0;
  const newValue = data.realtimeNetImpact ?? 0;

  // Skip if values are effectively the same
  if (Math.abs(previousValue - newValue) < 0.001) {
    return;
  }

  // Determine direction based on change
  const direction = newValue > previousValue ? 'up' : 'down';

  // Update state first
  state.tweets.impacts.set(tweetId, newValue);

  // Animate the impact change (uses existing animation from tweets feature)
  animateImpactChange(tweetId, previousValue, newValue, direction);

  // Recalculate taste for voted tweets
  recalcTasteForTweet(state, tweetId, newValue);
}

/**
 * Recalculate and update taste display for a voted tweet
 * @param {object} state - App state
 * @param {string} tweetId - Tweet ID
 * @param {number} currentImpact - Current impact value
 */
function recalcTasteForTweet(state, tweetId, currentImpact) {
  const voteData = state.tweets.voted.get(tweetId);
  if (voteData && voteData.impactAfterVote != null && voteData.maxPowerPct != null) {
    const tasteScore = calculateTaste(voteData.voteType, currentImpact, voteData.impactAfterVote, voteData.maxPowerPct);
    updateTasteDisplay(tweetId, tasteScore);
  }
}

/**
 * Handle feed score update
 * Accumulates updates and debounces reordering
 * @param {object} message - Message from background
 */
function handleFeedScoreUpdate(message) {
  const { feedType, tweetId, score, timestamp } = message;

  if (
    typeof feedType !== 'string' ||
    typeof tweetId !== 'string' ||
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp)
  ) {
    console.warn('[Bangit] Ignoring malformed FEED_SCORE_UPDATE payload:', message);
    return;
  }

  const state = getState();

  console.log('[Bangit] Received FEED_SCORE_UPDATE:', { feedType, tweetId, score, timestamp });

  // Only process if feed is active
  if (!state.feed.active) {
    console.log('[Bangit] Ignoring FEED_SCORE_UPDATE: feed inactive');
    return;
  }

  // Check if this update is for the currently active feed
  const expectedFeedType = getExpectedFeedType();
  if (feedType !== expectedFeedType) {
    console.log('[Bangit] Ignoring FEED_SCORE_UPDATE: wrong feed type', { expected: expectedFeedType, got: feedType });
    return;
  }

  // For tweets not in feed, queue them for insertion
  if (!isTweetInFeed(tweetId)) {
    console.log('[Bangit] Tweet not in feed, queuing for insertion:', tweetId);
    handleNewTweetForInsertion(tweetId, score, timestamp);
    return;
  }

  // Timestamp guard: reject out-of-order events
  const existingTimestamp = state.feed.lastScoreTimestamp.get(tweetId) || 0;
  if (timestamp <= existingTimestamp) {
    console.log('[Bangit] Ignoring older score update for', tweetId, { existing: existingTimestamp, incoming: timestamp });
    return;
  }
  state.feed.lastScoreTimestamp.set(tweetId, timestamp);

  console.log('[Bangit] Feed score update:', { tweetId, score, feedType });

  // Accumulate the score update
  state.feed.pendingScoreUpdates.set(tweetId, { score, timestamp });

  // Clear existing debounce timeout
  if (state.feed.reorderDebounceTimeout) {
    clearTimeout(state.feed.reorderDebounceTimeout);
  }

  // Capture current feed session ID to verify at flush time
  const sessionIdAtSchedule = state.feed.feedSessionId;

  // Set new debounce timeout
  state.feed.reorderDebounceTimeout = setTimeout(() => {
    // Verify feed session hasn't changed during debounce window
    if (state.feed.feedSessionId !== sessionIdAtSchedule) {
      console.log('[Bangit] Feed session changed, discarding pending score updates');
      state.feed.pendingScoreUpdates.clear();
      state.feed.reorderDebounceTimeout = null;
      return;
    }
    flushPendingScoreUpdates();
  }, SCORE_UPDATE_DEBOUNCE_MS);
}

/**
 * Process accumulated score updates and reorder feed
 */
async function flushPendingScoreUpdates() {
  const state = getState();
  const { pendingScoreUpdates, tweetIds, scores } = state.feed;

  if (pendingScoreUpdates.size === 0) {
    return;
  }

  console.log('[Bangit] Flushing score updates:', pendingScoreUpdates.size);

  // Apply pending updates to scores map
  pendingScoreUpdates.forEach((update, tweetId) => {
    scores.set(tweetId, update.score);
  });

  // Keep pinned hot post fixed at index 4 to match backend serving behavior.
  const pinnedTweetId = getPinnedTweetId(tweetIds);
  const sortableTweetIds = pinnedTweetId
    ? tweetIds.filter((tweetId) => tweetId !== pinnedTweetId)
    : [...tweetIds];

  // Build array with scores for sorting
  const tweetsWithScores = sortableTweetIds.map((tweetId, originalIndex) => ({
    tweetId,
    score: scores.get(tweetId) || 0,
    postId: getTweetPostId(tweetId),
    originalIndex,
  }));

  // Sort by score DESC, postId ASC (backend-compatible)
  tweetsWithScores.sort(compareByScoreAndPostId);

  // Extract new order and reinsert pinned tweet if present
  const sortedNonPinned = tweetsWithScores.map((t) => t.tweetId);
  const newOrder = pinnedTweetId
    ? [
        ...sortedNonPinned.slice(0, Math.min(3, sortedNonPinned.length)),
        pinnedTweetId,
        ...sortedNonPinned.slice(Math.min(3, sortedNonPinned.length)),
      ]
    : sortedNonPinned;

  // Clear pending updates and timeout
  pendingScoreUpdates.clear();
  state.feed.reorderDebounceTimeout = null;

  // Check if order actually changed
  const orderChanged = !tweetIds.every((id, i) => id === newOrder[i]);
  if (!orderChanged) {
    console.log('[Bangit] Order unchanged, skipping reorder');
    return;
  }

  // Calculate rank changes for indicators (before state update)
  const rankChanges = calculateRankChanges(tweetIds, newOrder);

  console.log('[Bangit] Reordering feed with', rankChanges.size, 'position changes');

  // Save old order for animation, then update state first (source of truth)
  const oldOrder = [...tweetIds];
  updateState('feed', { tweetIds: newOrder });

  // Perform FLIP animation and reorder DOM
  await reorderFeedWithAnimation(oldOrder, newOrder, rankChanges);
}

/**
 * Calculate rank changes between old and new order
 * @param {string[]} oldOrder - Previous order
 * @param {string[]} newOrder - New order
 * @returns {Map<string, {direction: 'up'|'down', magnitude: number}>}
 */
function calculateRankChanges(oldOrder, newOrder) {
  const changes = new Map();

  newOrder.forEach((tweetId, newIndex) => {
    const oldIndex = oldOrder.indexOf(tweetId);

    if (oldIndex !== -1 && oldIndex !== newIndex) {
      const positionChange = oldIndex - newIndex; // positive = moved up
      changes.set(tweetId, {
        direction: positionChange > 0 ? 'up' : 'down',
        magnitude: Math.abs(positionChange),
      });
    }
  });

  return changes;
}

/**
 * Reorder feed with FLIP animation
 * @param {string[]} oldOrder - Old tweet order
 * @param {string[]} newOrder - New tweet order
 * @param {Map<string, {direction: string, magnitude: number}>} rankChanges - Rank changes
 */
async function reorderFeedWithAnimation(oldOrder, newOrder, rankChanges) {
  // Handle animation concurrency - queue if already animating
  if (isAnimating) {
    console.log('[Bangit] Animation in progress, queuing reorder');
    pendingReorder = { oldOrder, newOrder, rankChanges };
    return;
  }

  // Check for reduced motion preference - skip animation if enabled
  if (prefersReducedMotion()) {
    console.log('[Bangit] Reduced motion preferred, skipping animation');
    reorderDOMElements(newOrder);
    return;
  }

  isAnimating = true;

  try {
    // Step 1: Capture current positions (FIRST)
    const oldPositions = capturePositions(oldOrder);

    // Step 2: Reorder DOM elements (LAST)
    reorderDOMElements(newOrder);

    // Step 3: Calculate deltas and apply inverse transforms (INVERT)
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        const deltas = calculateDeltas(newOrder, oldPositions);

        if (deltas.size === 0) {
          resolve();
          return;
        }

        applyInverseTransforms(deltas);

        // Apply glow effects to changed tweets
        rankChanges.forEach((change, tweetId) => {
          addRankGlow(tweetId, change.direction);
        });

        // Force reflow
        document.body.offsetHeight;

        // Step 4: Animate to final positions (PLAY)
        requestAnimationFrame(async () => {
          await animateToFinalPositions(deltas, REORDER_ANIMATION_MS);

          // Cleanup after glow animation
          setTimeout(() => {
            cleanupTransforms(newOrder);
            removeRankGlows(newOrder);
          }, GLOW_ANIMATION_MS);

          resolve();
        });
      });
    });
  } finally {
    isAnimating = false;

    // Process queued reorder if any
    if (pendingReorder) {
      const { oldOrder: o, newOrder: n, rankChanges: r } = pendingReorder;
      pendingReorder = null;
      console.log('[Bangit] Processing queued reorder');
      await reorderFeedWithAnimation(o, n, r);
    }
  }
}

/**
 * Reorder DOM elements to match new order
 * @param {string[]} newOrder - New tweet order
 */
function reorderDOMElements(newOrder) {
  const feedContent = document.querySelector('.bangit-feed-content');
  if (!feedContent) return;

  // Get all tweet elements
  const tweetElements = new Map();
  newOrder.forEach(tweetId => {
    const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
    if (element) {
      tweetElements.set(tweetId, element);
    }
  });

  // Reorder by appending in new order
  // appendChild moves elements if they already exist
  newOrder.forEach(tweetId => {
    const element = tweetElements.get(tweetId);
    if (element) {
      feedContent.appendChild(element);
    }
  });
}

// =====================================================
// BUMP FEED HANDLING (move to top on vote activity)
// =====================================================

/**
 * Handle BUMP feed update - queue tweet for moving to top
 * @param {string} tweetId - Tweet ID
 * @param {number} timestamp - Event timestamp
 * @param {boolean} needsFetch - Whether tweet data needs to be fetched from API
 */
function handleBumpFeedUpdate(tweetId, timestamp, needsFetch = false) {
  const state = getState();

  // Queue the tweet for bump update (needsFetch indicates if we need to fetch tweet data)
  if (state.feed.pendingBumpUpdates.has(tweetId)) {
    state.feed.pendingBumpUpdates.delete(tweetId);
  }
  state.feed.pendingBumpUpdates.set(tweetId, { timestamp, needsFetch });

  console.log('[Bangit] Queued BUMP update:', tweetId, 'needsFetch:', needsFetch, 'pending count:', state.feed.pendingBumpUpdates.size);

  // Clear existing debounce timeout
  if (state.feed.bumpDebounceTimeout) {
    clearTimeout(state.feed.bumpDebounceTimeout);
  }

  // Capture session ID to verify at flush time
  const sessionIdAtSchedule = state.feed.feedSessionId;

  // Set debounce timeout
  state.feed.bumpDebounceTimeout = setTimeout(() => {
    // Verify feed session hasn't changed
    if (state.feed.feedSessionId !== sessionIdAtSchedule) {
      console.log('[Bangit] Feed session changed, discarding pending bump updates');
      state.feed.pendingBumpUpdates.clear();
      state.feed.bumpDebounceTimeout = null;
      return;
    }
    flushPendingBumpUpdates();
  }, BUMP_DEBOUNCE_MS);
}

/**
 * Flush pending BUMP updates - move tweets to top with animation
 * Fetches tweet data for tweets not currently in the feed
 */
async function flushPendingBumpUpdates() {
  const state = getState();
  const { pendingBumpUpdates, tweetIds } = state.feed;

  if (pendingBumpUpdates.size === 0) {
    return;
  }

  console.log('[Bangit] Flushing BUMP updates:', pendingBumpUpdates.size);

  // Use insertion order (most recent last), then reverse so most recent is first
  const orderedUpdates = Array.from(pendingBumpUpdates.entries());
  const updatesByRecency = orderedUpdates.slice().reverse();

  // Separate tweets into: needs fetch vs already in feed
  const tweetsToFetch = [];
  const tweetsInFeed = [];

  updatesByRecency.forEach(([tweetId, data]) => {
    if (data.needsFetch) {
      tweetsToFetch.push(tweetId);
    } else {
      tweetsInFeed.push(tweetId);
    }
  });

  // Clear pending updates
  pendingBumpUpdates.clear();
  state.feed.bumpDebounceTimeout = null;

  // Fetch tweet data for tweets not in feed
  let fetchedTweets = [];
  if (tweetsToFetch.length > 0) {
    console.log('[Bangit] Fetching', tweetsToFetch.length, 'tweets for BUMP insertion');
    const response = await fetchTweetsByIds(tweetsToFetch);

    if (response.success && response.data?.tweets?.length) {
      fetchedTweets = response.data.tweets;
      console.log('[Bangit] Fetched', fetchedTweets.length, 'tweets for BUMP insertion');
    } else {
      console.warn('[Bangit] Failed to fetch tweets for BUMP insertion:', response.error);
    }
  }

  // Render and insert fetched tweets at top of feed
  const feedContent = getFeedContent();
  const newlyInsertedIds = [];
  const fetchedTweetMap = new Map(fetchedTweets.map(tweet => [tweet.tweetId, tweet]));
  const orderedFetchedTweets = tweetsToFetch
    .map(tweetId => fetchedTweetMap.get(tweetId))
    .filter(Boolean);

  if (feedContent && orderedFetchedTweets.length > 0) {
    // Insert in reverse order so most recent ends up at top
    for (let i = orderedFetchedTweets.length - 1; i >= 0; i--) {
      const tweet = orderedFetchedTweets[i];
      const element = renderTweet(tweet);

      // Add entry animation class (slide-in + pink glow)
      if (!prefersReducedMotion()) {
        element.classList.add('bangit-bump-entry');
      }

      // Insert at top
      feedContent.insertBefore(element, feedContent.firstChild);
      newlyInsertedIds.unshift(tweet.tweetId);

      console.log('[Bangit] Inserted BUMP tweet at top:', tweet.tweetId);

      // Remove animation class after completion
      if (!prefersReducedMotion()) {
        setTimeout(() => {
          element.classList.remove('bangit-bump-entry');
        }, BUMP_GLOW_ANIMATION_MS);
      }
    }

    // Update state with newly inserted tweet IDs at front
    const currentTweetIds = getState().feed.tweetIds;
    updateState('feed', { tweetIds: [...newlyInsertedIds, ...currentTweetIds] });
  }

  // Now handle tweets that were already in feed - move them to top
  if (tweetsInFeed.length > 0) {
    const currentTweetIds = getState().feed.tweetIds;

    // Build new order: bumped tweets first, then remaining in original order
    const remainingTweetIds = currentTweetIds.filter(id => !tweetsInFeed.includes(id));
    const newOrder = [...tweetsInFeed, ...remainingTweetIds];

    // Check if order actually changed
    const orderChanged = !currentTweetIds.every((id, i) => id === newOrder[i]);
    if (orderChanged) {
      console.log('[Bangit] BUMP reordering', tweetsInFeed.length, 'existing tweets to top');

      // Save old order for animation, then update state
      const oldOrder = [...currentTweetIds];
      updateState('feed', { tweetIds: newOrder });

      // Perform BUMP animation with pink glow
      await animateBumpReorder(oldOrder, newOrder, tweetsInFeed);
    }
  }
}

/**
 * Animate BUMP feed reorder with pink glow
 * @param {string[]} oldOrder - Old tweet order
 * @param {string[]} newOrder - New tweet order
 * @param {string[]} bumpedTweetIds - Tweet IDs that were bumped to top
 */
async function animateBumpReorder(oldOrder, newOrder, bumpedTweetIds) {
  // Handle animation concurrency - queue if already animating
  if (isAnimating) {
    console.log('[Bangit] Animation in progress, queuing BUMP reorder');
    pendingReorder = { oldOrder, newOrder, rankChanges: new Map() };
    return;
  }

  // Check for reduced motion preference - skip animation if enabled
  if (prefersReducedMotion()) {
    console.log('[Bangit] Reduced motion preferred, skipping BUMP animation');
    reorderDOMElements(newOrder);
    return;
  }

  isAnimating = true;

  try {
    // Step 1: Capture current positions (FIRST)
    const oldPositions = capturePositions(oldOrder);

    // Step 2: Reorder DOM elements (LAST)
    reorderDOMElements(newOrder);

    // Step 3: Calculate deltas and apply inverse transforms (INVERT)
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        const deltas = calculateDeltas(newOrder, oldPositions);

        if (deltas.size === 0) {
          resolve();
          return;
        }

        applyInverseTransforms(deltas);

        // Add PINK glow effects to bumped tweets
        bumpedTweetIds.forEach(tweetId => {
          addBumpGlow(tweetId);
        });

        // Force reflow
        document.body.offsetHeight;

        // Step 4: Animate to final positions (PLAY)
        requestAnimationFrame(async () => {
          await animateToFinalPositions(deltas, REORDER_ANIMATION_MS);

          // Cleanup after glow animation
          setTimeout(() => {
            cleanupTransforms(newOrder);
            removeBumpGlows(newOrder);
          }, BUMP_GLOW_ANIMATION_MS);

          resolve();
        });
      });
    });
  } finally {
    isAnimating = false;

    // Process queued reorder if any
    if (pendingReorder) {
      const { oldOrder: o, newOrder: n, rankChanges: r } = pendingReorder;
      pendingReorder = null;
      console.log('[Bangit] Processing queued reorder');
      await reorderFeedWithAnimation(o, n, r);
    }
  }
}

/**
 * Add BUMP pink glow to a tweet element
 * @param {string} tweetId - Tweet ID
 */
function addBumpGlow(tweetId) {
  const feedContent = document.querySelector('.bangit-feed-content');
  if (!feedContent) return;

  const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
  if (element) {
    element.classList.add('bangit-bump-glow');
  }
}

/**
 * Remove BUMP pink glow from tweet elements
 * @param {string[]} tweetIds - Tweet IDs to remove glow from
 */
function removeBumpGlows(tweetIds) {
  const feedContent = document.querySelector('.bangit-feed-content');
  if (!feedContent) return;

  tweetIds.forEach(tweetId => {
    const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
    if (element) {
      element.classList.remove('bangit-bump-glow');
    }
  });
}

// =====================================================
// NEW FEED HANDLING (insert at top with slide-in)
// =====================================================

/**
 * Handle feed:newPost event - insert new tweet at top with animation
 * @param {object} message - Message from background
 */
function handleFeedNewPost(message) {
  const { tweetId, tweet, timestamp } = message;
  const state = getState();

  console.log('[Bangit] Received FEED_NEW_POST:', { tweetId, timestamp });

  // Only process if feed is active and in NEW sort mode
  if (!state.feed.active) {
    console.log('[Bangit] Ignoring FEED_NEW_POST: feed inactive');
    return;
  }

  if (state.feed.sortType !== 'new') {
    console.log('[Bangit] Ignoring FEED_NEW_POST: not in NEW feed mode');
    return;
  }

  // Check if tweet already in feed
  if (isTweetInFeed(tweetId)) {
    console.log('[Bangit] FEED_NEW_POST: tweet already in feed, moving to top');
    moveTweetToTop(tweetId);
    return;
  }

  // Check if tweet data is complete (has required fields)
  if (!tweet || !tweet.tweetId || !tweet.author) {
    console.log('[Bangit] Incomplete tweet data, queuing for fetch:', tweetId);
    handleNewPostForFetch(tweetId, timestamp);
    return;
  }

  // Insert tweet at top with slide-in animation
  insertNewTweetAtTop(tweet);
}

/**
 * Insert a new tweet at the top of the NEW feed with animation
 * @param {object} tweet - Tweet data from WebSocket
 */
async function insertNewTweetAtTop(tweet) {
  const state = getState();
  const feedContent = getFeedContent();
  if (!feedContent) {
    console.warn('[Bangit] Feed content not found for new tweet insertion');
    return;
  }

  const tweetId = tweet.tweetId;

  // Render the tweet element
  const element = renderTweet(tweet);

  if (prefersReducedMotion()) {
    // Reduced motion: just insert without animation
    feedContent.insertBefore(element, feedContent.firstChild);
    updateState('feed', { tweetIds: [tweetId, ...state.feed.tweetIds] });
    return;
  }

  // Add entry animation class (slide-in + pink glow)
  element.classList.add('bangit-bump-entry');

  // Insert at top
  feedContent.insertBefore(element, feedContent.firstChild);

  // Update state
  updateState('feed', { tweetIds: [tweetId, ...state.feed.tweetIds] });

  console.log('[Bangit] Inserted new tweet at top:', tweetId);

  // Remove animation class after completion
  setTimeout(() => {
    element.classList.remove('bangit-bump-entry');
  }, BUMP_GLOW_ANIMATION_MS);
}

/**
 * Move an existing tweet to the top of the feed
 * @param {string} tweetId - Tweet ID
 */
function moveTweetToTop(tweetId) {
  const state = getState();
  if (state.feed.tweetIds[0] === tweetId) {
    return;
  }

  const feedContent = getFeedContent();
  if (!feedContent) {
    return;
  }

  const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
  if (!element) {
    return;
  }

  feedContent.insertBefore(element, feedContent.firstChild);
  updateState('feed', {
    tweetIds: [tweetId, ...state.feed.tweetIds.filter(id => id !== tweetId)],
  });

  if (!prefersReducedMotion()) {
    element.classList.add('bangit-bump-entry');
    setTimeout(() => {
      element.classList.remove('bangit-bump-entry');
    }, BUMP_GLOW_ANIMATION_MS);
  }
}

/**
 * Queue a new post for batch fetching (when socket data is incomplete)
 * @param {string} tweetId - Tweet ID
 * @param {number} timestamp - Event timestamp
 */
function handleNewPostForFetch(tweetId, timestamp) {
  const state = getState();

  // Don't queue if at max pending insertions
  if (state.feed.pendingNewPosts.size >= MAX_PENDING_INSERTIONS) {
    console.log('[Bangit] Max pending new posts reached, ignoring:', tweetId);
    return;
  }

  // Queue the tweet for batch fetch
  if (state.feed.pendingNewPosts.has(tweetId)) {
    state.feed.pendingNewPosts.delete(tweetId);
  }
  state.feed.pendingNewPosts.set(tweetId, { timestamp });

  console.log('[Bangit] Queued new post for fetch:', tweetId, 'pending count:', state.feed.pendingNewPosts.size);

  // Clear existing debounce timeout
  if (state.feed.newPostDebounceTimeout) {
    clearTimeout(state.feed.newPostDebounceTimeout);
  }

  // Capture session ID to verify at flush time
  const sessionIdAtSchedule = state.feed.feedSessionId;

  // Set debounce timeout
  state.feed.newPostDebounceTimeout = setTimeout(() => {
    // Verify feed session hasn't changed
    if (state.feed.feedSessionId !== sessionIdAtSchedule) {
      console.log('[Bangit] Feed session changed, discarding pending new posts');
      state.feed.pendingNewPosts.clear();
      state.feed.newPostDebounceTimeout = null;
      return;
    }
    flushPendingNewPosts();
  }, INSERTION_DEBOUNCE_MS);
}

/**
 * Flush pending new posts - fetch tweets and insert them at top
 */
async function flushPendingNewPosts() {
  const state = getState();
  const { pendingNewPosts } = state.feed;

  if (pendingNewPosts.size === 0) {
    return;
  }

  console.log('[Bangit] Flushing pending new posts:', pendingNewPosts.size);

  // Collect tweet IDs in insertion order, then reverse so most recent is first
  const orderedTweetIds = Array.from(pendingNewPosts.keys());
  const tweetIds = orderedTweetIds.slice().reverse();

  // Clear pending new posts
  pendingNewPosts.clear();
  state.feed.newPostDebounceTimeout = null;

  // Fetch tweet data from API
  const response = await fetchTweetsByIds(tweetIds);

  if (!response.success || !response.data?.tweets?.length) {
    console.warn('[Bangit] Failed to fetch tweets for NEW feed insertion:', response.error);
    return;
  }

  const tweets = response.data.tweets;
  console.log('[Bangit] Fetched', tweets.length, 'tweets for NEW feed insertion');

  // Verify we're still in NEW feed mode
  if (state.feed.sortType !== 'new' || !state.feed.active) {
    console.log('[Bangit] No longer in NEW feed mode, discarding fetched tweets');
    return;
  }

  // Insert tweets at top (most recent first)
  const feedContent = getFeedContent();
  if (!feedContent) {
    console.warn('[Bangit] Feed content not found for new post insertion');
    return;
  }

  const newlyInsertedIds = [];
  const tweetMap = new Map(tweets.map(tweet => [tweet.tweetId, tweet]));
  const orderedTweets = tweetIds
    .map(tweetId => tweetMap.get(tweetId))
    .filter(Boolean);

  // Insert in reverse order so most recent ends up at top
  for (let i = orderedTweets.length - 1; i >= 0; i--) {
    const tweet = orderedTweets[i];

    // Skip if tweet is now in feed (could have been inserted via another path)
    if (isTweetInFeed(tweet.tweetId)) {
      console.log('[Bangit] Tweet already in feed, moving to top:', tweet.tweetId);
      moveTweetToTop(tweet.tweetId);
      continue;
    }

    const element = renderTweet(tweet);

    // Add entry animation class (slide-in + pink glow)
    if (!prefersReducedMotion()) {
      element.classList.add('bangit-bump-entry');
    }

    // Insert at top
    feedContent.insertBefore(element, feedContent.firstChild);
    newlyInsertedIds.unshift(tweet.tweetId);

    console.log('[Bangit] Inserted NEW tweet at top:', tweet.tweetId);

    // Remove animation class after completion
    if (!prefersReducedMotion()) {
      setTimeout(() => {
        element.classList.remove('bangit-bump-entry');
      }, BUMP_GLOW_ANIMATION_MS);
    }
  }

  // Update state with newly inserted tweet IDs at front
  if (newlyInsertedIds.length > 0) {
    const currentTweetIds = getState().feed.tweetIds;
    updateState('feed', { tweetIds: [...newlyInsertedIds, ...currentTweetIds] });
  }
}

/**
 * Start real-time event handlers
 */
export function startRealtimeHandlers() {
  if (handlersRegistered) {
    return;
  }

  console.log('[Bangit] Starting real-time feed handlers');

  // Register vote update handler
  registerHandler(MessageTypes.VOTE_UPDATE, handleVoteUpdate);

  // Register feed score update handler
  registerHandler(MessageTypes.FEED_SCORE_UPDATE, handleFeedScoreUpdate);

  // Register new post handler (for NEW feed)
  registerHandler(MessageTypes.FEED_NEW_POST, handleFeedNewPost);

  handlersRegistered = true;
}

/**
 * Stop real-time event handlers
 */
export function stopRealtimeHandlers() {
  if (!handlersRegistered) {
    return;
  }

  console.log('[Bangit] Stopping real-time feed handlers');

  // Clear any pending debounce timeout
  const state = getState();
  if (state.feed.reorderDebounceTimeout) {
    clearTimeout(state.feed.reorderDebounceTimeout);
    state.feed.reorderDebounceTimeout = null;
  }

  // Clear pending insertion timeout
  if (state.feed.insertionDebounceTimeout) {
    clearTimeout(state.feed.insertionDebounceTimeout);
    state.feed.insertionDebounceTimeout = null;
  }

  // Clear bump debounce timeout
  if (state.feed.bumpDebounceTimeout) {
    clearTimeout(state.feed.bumpDebounceTimeout);
    state.feed.bumpDebounceTimeout = null;
  }

  // Clear new post debounce timeout
  if (state.feed.newPostDebounceTimeout) {
    clearTimeout(state.feed.newPostDebounceTimeout);
    state.feed.newPostDebounceTimeout = null;
  }

  // Clear pending updates, insertions, bump updates, new posts, and timestamp tracking
  state.feed.pendingScoreUpdates.clear();
  state.feed.pendingInsertions.clear();
  state.feed.pendingBumpUpdates.clear();
  state.feed.pendingNewPosts.clear();
  state.feed.lastScoreTimestamp.clear();

  // Clear animation concurrency state
  isAnimating = false;
  pendingReorder = null;

  // Unregister only this feature's handlers (leave other subscribers intact)
  unregisterHandler(MessageTypes.VOTE_UPDATE, handleVoteUpdate);
  unregisterHandler(MessageTypes.FEED_SCORE_UPDATE, handleFeedScoreUpdate);
  unregisterHandler(MessageTypes.FEED_NEW_POST, handleFeedNewPost);

  handlersRegistered = false;
}

/**
 * Set initial score for a tweet (called when rendering feed)
 * @param {string} tweetId - Tweet ID
 * @param {number} score - Score value
 */
export function setInitialScore(tweetId, score) {
  const state = getState();
  if (score !== undefined && score !== null) {
    state.feed.scores.set(tweetId, score);
  }
}

/**
 * Clear all scores (called when feed is refreshed or filter changes)
 */
export function clearScores() {
  const state = getState();
  state.feed.scores.clear();
  state.feed.lastScoreTimestamp.clear();
}

// =====================================================
// TWEET INSERTION LOGIC (for tweets not in feed)
// =====================================================

/**
 * Queue a new tweet for insertion
 * @param {string} tweetId - Tweet ID
 * @param {number} score - Feed score
 * @param {number} timestamp - Event timestamp
 */
function handleNewTweetForInsertion(tweetId, score, timestamp) {
  const state = getState();

  // Don't queue if at max pending insertions
  if (state.feed.pendingInsertions.size >= MAX_PENDING_INSERTIONS) {
    console.log('[Bangit] Max pending insertions reached, ignoring:', tweetId);
    return;
  }

  // Check timestamp to avoid duplicate/stale insertions
  const existingTimestamp = state.feed.lastScoreTimestamp.get(tweetId) || 0;
  if (timestamp <= existingTimestamp) {
    console.log('[Bangit] Ignoring older insertion for', tweetId);
    return;
  }

  // Queue the tweet for batch fetch
  state.feed.pendingInsertions.set(tweetId, { score, timestamp });
  state.feed.lastScoreTimestamp.set(tweetId, timestamp);

  console.log('[Bangit] Queued tweet for insertion:', tweetId, 'pending count:', state.feed.pendingInsertions.size);

  // Clear existing debounce timeout
  if (state.feed.insertionDebounceTimeout) {
    clearTimeout(state.feed.insertionDebounceTimeout);
  }

  // Capture session ID to verify at flush time
  const sessionIdAtSchedule = state.feed.feedSessionId;

  // Set debounce timeout
  state.feed.insertionDebounceTimeout = setTimeout(() => {
    // Verify feed session hasn't changed
    if (state.feed.feedSessionId !== sessionIdAtSchedule) {
      console.log('[Bangit] Feed session changed, discarding pending insertions');
      state.feed.pendingInsertions.clear();
      state.feed.insertionDebounceTimeout = null;
      return;
    }
    flushPendingInsertions();
  }, INSERTION_DEBOUNCE_MS);
}

/**
 * Flush pending insertions - fetch tweets and insert them
 */
async function flushPendingInsertions() {
  const state = getState();
  const { pendingInsertions } = state.feed;

  if (pendingInsertions.size === 0) {
    return;
  }

  console.log('[Bangit] Flushing pending insertions:', pendingInsertions.size);

  // Collect tweet IDs and scores
  const tweetIds = Array.from(pendingInsertions.keys());
  const scoresByTweetId = new Map(pendingInsertions);

  // Clear pending insertions
  pendingInsertions.clear();
  state.feed.insertionDebounceTimeout = null;

  // Fetch tweet data from API
  const response = await fetchTweetsByIds(tweetIds);

  if (!response.success || !response.data?.tweets?.length) {
    console.warn('[Bangit] Failed to fetch tweets for insertion:', response.error);
    return;
  }

  const tweets = response.data.tweets;
  console.log('[Bangit] Fetched', tweets.length, 'tweets for insertion');

  // Insert tweets into feed with animation
  await insertTweetsIntoFeed(tweets, scoresByTweetId);
}

/**
 * Insert fetched tweets into the feed at correct positions
 * @param {Array} tweets - Tweet data array
 * @param {Map<string, {score: number, timestamp: number}>} scoresByTweetId - Scores for new tweets
 */
async function insertTweetsIntoFeed(tweets, scoresByTweetId) {
  const state = getState();
  const feedContent = getFeedContent();
  if (!feedContent) {
    console.warn('[Bangit] Feed content not found for insertion');
    return;
  }

  // Add scores to state and render tweet elements
  const newElements = [];
  tweets.forEach((tweet) => {
    const scoreData = scoresByTweetId.get(tweet.tweetId);
    if (scoreData) {
      setInitialScore(tweet.tweetId, scoreData.score);
    }

    const element = renderTweet(tweet);
    newElements.push({
      tweetId: tweet.tweetId,
      element,
      score: scoreData?.score || 0,
      postId: tweet.id || '',
    });
  });

  if (newElements.length === 0) {
    return;
  }

  // Keep visible window size stable to match backend pagination semantics.
  const currentTweetIds = [...state.feed.tweetIds];
  const { scores } = state.feed;
  const pinnedTweetId = getPinnedTweetId(currentTweetIds);
  const sortableCurrentIds = pinnedTweetId
    ? currentTweetIds.filter((tweetId) => tweetId !== pinnedTweetId)
    : [...currentTweetIds];
  const targetWindowSize = sortableCurrentIds.length;

  const allTweets = [
    ...sortableCurrentIds.map((tweetId, idx) => ({
      tweetId,
      score: scores.get(tweetId) || 0,
      postId: getTweetPostId(tweetId),
      originalIndex: idx,
      isNew: false,
    })),
    ...newElements.map((item, idx) => ({
      tweetId: item.tweetId,
      score: item.score,
      postId: item.postId,
      originalIndex: sortableCurrentIds.length + idx,
      isNew: true,
      element: item.element,
    })),
  ];

  allTweets.sort(compareByScoreAndPostId);

  const selectedTweets = allTweets.slice(0, targetWindowSize);
  const newOrderWithoutPinned = selectedTweets.map((t) => t.tweetId);
  const newOrder = pinnedTweetId
    ? [
        ...newOrderWithoutPinned.slice(0, Math.min(3, newOrderWithoutPinned.length)),
        pinnedTweetId,
        ...newOrderWithoutPinned.slice(Math.min(3, newOrderWithoutPinned.length)),
      ]
    : newOrderWithoutPinned;

  const selectedNewTweetIds = new Set(
    selectedTweets.filter((t) => t.isNew).map((t) => t.tweetId)
  );
  const selectedNewElements = newElements.filter((item) => selectedNewTweetIds.has(item.tweetId));
  const newTweetIds = selectedNewElements.map((e) => e.tweetId);

  const droppedExistingIds = sortableCurrentIds.filter((id) => !newOrderWithoutPinned.includes(id));
  const displacedTweetIds = new Set();
  newOrderWithoutPinned.forEach((tweetId, newIndex) => {
    const oldIndex = sortableCurrentIds.indexOf(tweetId);
    if (oldIndex !== -1 && newIndex > oldIndex) {
      displacedTweetIds.add(tweetId);
    }
  });

  console.log(
    '[Bangit] Inserting',
    newTweetIds.length,
    'tweets, dropping',
    droppedExistingIds.length,
    'and displacing',
    displacedTweetIds.size
  );

  // Handle animation if not reduced motion
  const reducedMotion = prefersReducedMotion();
  console.log('[Bangit] prefersReducedMotion:', reducedMotion);

  if (!reducedMotion) {
    // Capture positions before structural DOM updates
    const oldPositions = capturePositions(currentTweetIds);
    console.log('[Bangit] Captured', oldPositions.size, 'old positions');

    // Remove dropped existing tweets (fell out of visible window)
    droppedExistingIds.forEach((tweetId) => {
      const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
      if (element) {
        element.remove();
      }
    });

    // Insert selected new elements (hidden initially for FLIP)
    selectedNewElements.forEach(({ element }) => {
      element.style.opacity = '0';
      feedContent.appendChild(element);
    });

    // Update state with backend-compatible visible order
    updateState('feed', { tweetIds: newOrder });

    // Reorder all elements in DOM to match new order
    reorderDOMElements(newOrder);

    // Calculate deltas for existing tweets
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        const deltas = calculateDeltas(currentTweetIds, oldPositions);
        console.log('[Bangit] Calculated deltas:', deltas.size, 'non-zero deltas');

        if (deltas.size > 0) {
          applyInverseTransforms(deltas);
        }

        // Add glow effects
        newTweetIds.forEach((tweetId) => {
          addRankGlow(tweetId, 'up');
        });
        displacedTweetIds.forEach((tweetId) => {
          addRankGlow(tweetId, 'down');
        });

        document.body.offsetHeight;

        requestAnimationFrame(async () => {
          // Fade in inserted tweets
          selectedNewElements.forEach(({ element }) => {
            element.style.transition = `opacity ${REORDER_ANIMATION_MS}ms ease-out`;
            element.style.opacity = '1';
          });

          if (deltas.size > 0) {
            await animateToFinalPositions(deltas, REORDER_ANIMATION_MS);
          }

          setTimeout(() => {
            cleanupTransforms(newOrder);
            removeRankGlows(newOrder);
            selectedNewElements.forEach(({ element }) => {
              element.style.transition = '';
            });
          }, GLOW_ANIMATION_MS);

          resolve();
        });
      });
    });
  } else {
    // Reduced motion: apply structural updates without animation
    droppedExistingIds.forEach((tweetId) => {
      const element = feedContent.querySelector(`[data-tweet-id="${tweetId}"]`);
      if (element) {
        element.remove();
      }
    });

    selectedNewElements.forEach(({ element }) => {
      feedContent.appendChild(element);
    });

    updateState('feed', { tweetIds: newOrder });
    reorderDOMElements(newOrder);
  }
}
