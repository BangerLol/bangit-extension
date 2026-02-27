// Bangit - Feed API wrapper
// Handles fetching curated feed from backend

import { sendMessage, MessageTypes } from '../../core/rpc.js';

function createFeedValidationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_FEED_RESPONSE';
  return error;
}

function validateFeedData(data, sortType) {
  if (!data || typeof data !== 'object') {
    throw createFeedValidationError('Feed payload must be an object');
  }

  const { tweets, hasMore, nextCursor } = data;

  if (!Array.isArray(tweets)) {
    throw createFeedValidationError('Feed payload must include tweets[]');
  }

  if (typeof hasMore !== 'boolean') {
    throw createFeedValidationError('Feed payload hasMore must be boolean');
  }

  if (!(nextCursor === null || typeof nextCursor === 'string')) {
    throw createFeedValidationError('Feed payload nextCursor must be string or null');
  }

  if (hasMore && (typeof nextCursor !== 'string' || nextCursor.trim().length === 0)) {
    throw createFeedValidationError('Feed payload hasMore=true requires non-empty nextCursor');
  }

  if (sortType === 'hot' || sortType === 'top') {
    for (const tweet of tweets) {
      if (!tweet || typeof tweet !== 'object' || typeof tweet.feedScore !== 'number' || !Number.isFinite(tweet.feedScore)) {
        throw createFeedValidationError('Ranking feeds require numeric feedScore on every tweet');
      }
    }
  }

  return { tweets, hasMore, nextCursor };
}

/**
 * Fetch curated tweet feed from backend
 * @param {string} sortType - Sort type: 'hot', 'top', 'bump', 'new'
 * @param {string|null} cursor - Opaque pagination cursor from backend
 * @param {number} limit - Number of tweets to fetch
 * @param {boolean} followingOnly - Filter to only show tweets from followed users
 * @param {string|null} period - Time period for 'top' sort: '8h', '24h', '3d', '7d', '30d'
 * @returns {Promise<{success: boolean, data?: {tweets: Array, hasMore: boolean, nextCursor: string|null}, error?: string, code?: string|null}>}
 */
export async function fetchFeed(sortType = 'hot', cursor = null, limit = 20, followingOnly = false, period = null) {
  try {
    const response = await sendMessage(MessageTypes.GET_TWEET_FEED, {
      sortType,
      cursor,
      limit,
      followingOnly,
      ...(period && { period }),
    });

    if (!response?.success) {
      return {
        success: false,
        error: response?.error || 'Failed to fetch feed',
        code: response?.code || null
      };
    }

    const validatedData = validateFeedData(response.data, sortType);
    return { success: true, data: validatedData };
  } catch (error) {
    console.error('[Bangit] Error fetching feed:', error);
    return {
      success: false,
      error: error.message,
      code: typeof error.code === 'string' ? error.code : null
    };
  }
}

/**
 * Fetch tweets by IDs (for real-time insertion)
 * @param {string[]} tweetIds - Array of tweet IDs to fetch
 * @returns {Promise<{success: boolean, data?: {tweets: Array}, error?: string}>}
 */
export async function fetchTweetsByIds(tweetIds) {
  if (!tweetIds || tweetIds.length === 0) {
    return { success: true, data: { tweets: [] } };
  }

  try {
    const response = await sendMessage(MessageTypes.GET_TWEETS_BY_IDS, { tweetIds });
    return response;
  } catch (error) {
    console.error('[Bangit] Error fetching tweets by IDs:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Default sort type for the Bangit feed
 */
export const DEFAULT_SORT_TYPE = 'hot';

/**
 * Default page size
 */
export const DEFAULT_PAGE_SIZE = 20;
