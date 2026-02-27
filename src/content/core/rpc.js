// Bangit - Message RPC layer for content <-> background communication

import { isExtensionContextValid, isContextInvalidatedError } from './utils.js';

// Registered message handlers — Map<string, Set<Function>>
// Multiple handlers can subscribe to the same message type.
const handlers = new Map();

// Default timeout for messages (30 seconds)
const DEFAULT_TIMEOUT = 30000;

/**
 * Send a message to the background script
 * @param {string} type - Message type
 * @param {object} payload - Additional payload
 * @param {number} timeout - Timeout in ms (default 30s)
 * @returns {Promise<any>} Response from background
 */
export async function sendMessage(type, payload = {}, timeout = DEFAULT_TIMEOUT) {
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalidated');
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Message timeout: ${type}`));
    }, timeout);

    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * Register a message handler for a specific type.
 * Multiple handlers can be registered for the same type — all will be invoked.
 * @param {string} type - Message type to handle
 * @param {Function} handler - Handler function (message, sender) => response
 */
export function registerHandler(type, handler) {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type).add(handler);
}

/**
 * Unregister a message handler.
 * @param {string} type - Message type to unregister
 * @param {Function} [handler] - Specific handler to remove. If omitted, removes ALL handlers for this type.
 */
export function unregisterHandler(type, handler) {
  if (!handler) {
    handlers.delete(type);
    return;
  }
  const set = handlers.get(type);
  if (set) {
    set.delete(handler);
    if (set.size === 0) handlers.delete(type);
  }
}

/**
 * Initialize the message listener
 * Should be called once at startup
 */
export function initMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const set = handlers.get(message.type);

    if (!set || set.size === 0) return false;

    // Invoke every subscriber, isolating errors per handler.
    const results = [];
    let hasAsync = false;

    for (const handler of set) {
      try {
        const result = handler(message, sender);
        if (result instanceof Promise) hasAsync = true;
        results.push(result);
      } catch (error) {
        console.error(`[Bangit] Handler error for ${message.type}:`, error);
      }
    }

    if (hasAsync) {
      // Wait for all (wrap sync values so Promise.all works uniformly).
      Promise.all(results.map(r => (r instanceof Promise ? r : Promise.resolve(r))))
        .then(resolved => {
          const response = resolved.find(r => r !== undefined);
          sendResponse(response ?? { success: true });
        })
        .catch(error => {
          console.error(`[Bangit] Async handler error for ${message.type}:`, error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
    }

    // All sync — respond with first non-undefined result.
    const response = results.find(r => r !== undefined);
    if (response !== undefined) sendResponse(response);
    return false;
  });
}

// Message type constants for type safety
export const MessageTypes = {
  // Auth
  GET_AUTH_STATUS: 'GET_AUTH_STATUS',
  OPEN_LOGIN: 'OPEN_LOGIN',

  // User data
  GET_USER_POWER: 'GET_USER_POWER',
  GET_ACCOUNT_DATA: 'GET_ACCOUNT_DATA',
  GET_USER_STATUS: 'GET_USER_STATUS',

  // Voting
  CAST_VOTE: 'CAST_VOTE',
  GET_TWEETS_BASIC: 'GET_TWEETS_BASIC',

  // Power
  REFILL_POWER: 'REFILL_POWER',

  // Restrictions
  REDEEM_INVITE_CODE: 'REDEEM_INVITE_CODE',
  VALIDATE_TWITTER_ACCOUNT: 'VALIDATE_TWITTER_ACCOUNT',

  // Curation & performance
  GET_CURATION_STATS: 'GET_CURATION_STATS',
  GET_CURRENT_PERIOD_PERFORMANCE: 'GET_CURRENT_PERIOD_PERFORMANCE',
  GET_DISTRIBUTION_PERFORMANCE: 'GET_DISTRIBUTION_PERFORMANCE',

  // Rewards
  GET_REWARD_DISTRIBUTIONS: 'GET_REWARD_DISTRIBUTIONS',
  GET_DISTRIBUTION_CURATORS: 'GET_DISTRIBUTION_CURATORS',
  GET_UPCOMING_DISTRIBUTION: 'GET_UPCOMING_DISTRIBUTION',

  // Feed
  GET_TWEET_FEED: 'GET_TWEET_FEED',
  GET_TWEETS_BY_IDS: 'GET_TWEETS_BY_IDS',
  GET_LEADERBOARD: 'GET_LEADERBOARD',

  // Socket subscriptions
  SOCKET_SUBSCRIBE_FEED: 'SOCKET_SUBSCRIBE_FEED',
  SOCKET_UNSUBSCRIBE_FEED: 'SOCKET_UNSUBSCRIBE_FEED',

  // Incoming from background
  AUTH_STATUS_CHANGED: 'AUTH_STATUS_CHANGED',
  VOTE_UPDATE: 'VOTE_UPDATE',
  FEED_SCORE_UPDATE: 'FEED_SCORE_UPDATE',
  FEED_NEW_POST: 'FEED_NEW_POST',
};

// Convenience functions for common API calls

/**
 * Get authentication status
 * @returns {Promise<{isAuthenticated: boolean, user: object|null}>}
 */
export async function getAuthStatus() {
  return sendMessage(MessageTypes.GET_AUTH_STATUS);
}

/**
 * Open login page
 * @returns {Promise<void>}
 */
export async function openLogin() {
  return sendMessage(MessageTypes.OPEN_LOGIN);
}

/**
 * Get user power stats
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function getUserPower() {
  return sendMessage(MessageTypes.GET_USER_POWER);
}

/**
 * Cast a vote on a tweet
 * @param {string} tweetId - Tweet ID
 * @param {'up'|'down'} voteType - Vote type
 * @param {number} maxPowerPct - Power percentage to use
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function castVote(tweetId, voteType, maxPowerPct) {
  return sendMessage(MessageTypes.CAST_VOTE, {
    tweetId,
    voteType,
    maxPowerPct,
  });
}

/**
 * Get basic data for multiple tweets
 * @param {string[]} tweetIds - Array of tweet IDs
 * @returns {Promise<{success: boolean, data: {tweets: object[]}}>}
 */
export async function getTweetsBasic(tweetIds) {
  return sendMessage(MessageTypes.GET_TWEETS_BASIC, { tweetIds });
}

/**
 * Refill user power
 * @param {number} refillPct - Percentage to refill
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function refillPower(refillPct) {
  return sendMessage(MessageTypes.REFILL_POWER, { refillPct });
}

/**
 * Get curation stats
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function getCurationStats() {
  return sendMessage(MessageTypes.GET_CURATION_STATS);
}

/**
 * Get reward distributions
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function getRewardDistributions() {
  return sendMessage(MessageTypes.GET_REWARD_DISTRIBUTIONS);
}

/**
 * Get tweet feed
 * @param {string} sortType - Sort type: 'hot', 'top', 'new', 'forYou'
 * @param {string|null} cursor - Pagination cursor
 * @param {number} limit - Number of tweets to fetch
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function getTweetFeed(sortType = 'hot', cursor = null, limit = 20) {
  return sendMessage(MessageTypes.GET_TWEET_FEED, { sortType, cursor, limit });
}

/**
 * Redeem an invite code
 * @param {string} code - Invite code to redeem
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function redeemInviteCode(code) {
  return sendMessage(MessageTypes.REDEEM_INVITE_CODE, { code });
}

/**
 * Validate Twitter account (for TWITTER_ACCOUNT restriction retry)
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function validateTwitterAccount() {
  return sendMessage(MessageTypes.VALIDATE_TWITTER_ACCOUNT);
}

/**
 * Get user status (restriction status)
 * @returns {Promise<{success: boolean, data: object}>}
 */
export async function getUserStatus() {
  return sendMessage(MessageTypes.GET_USER_STATUS);
}

/**
 * Logout
 * @returns {Promise<{success: boolean}>}
 */
export async function logout() {
  return sendMessage('LOGOUT');
}

/**
 * Subscribe to a feed room for real-time score updates
 * @param {string} feedType - Feed type: 'HOT', 'TOP_8H', 'TOP_24H', 'TOP_3D', 'TOP_7D', 'TOP_30D'
 * @returns {Promise<{success: boolean}>}
 */
export async function subscribeFeedRanking(feedType) {
  return sendMessage(MessageTypes.SOCKET_SUBSCRIBE_FEED, { feedType });
}

/**
 * Unsubscribe from a feed room
 * @param {string} feedType - Feed type to unsubscribe from
 * @returns {Promise<{success: boolean}>}
 */
export async function unsubscribeFeedRanking(feedType) {
  return sendMessage(MessageTypes.SOCKET_UNSUBSCRIBE_FEED, { feedType });
}

/**
 * Get leaderboard data
 * @param {'curators'|'creators'} type - Leaderboard type
 * @param {'24h'|'3d'|'7d'|'30d'|'All'} period - Time period
 * @param {string|null} privyId - Current user's privyId for rank lookup
 * @returns {Promise<{success: boolean, data: {leaderboard: object[], currentUser: object|null}}>}
 */
export async function getLeaderboard(type, period, privyId = null) {
  return sendMessage(MessageTypes.GET_LEADERBOARD, { leaderboardType: type, period, privyId });
}
