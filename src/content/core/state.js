// Bangit - Centralized state management

import { CONFIG } from './config.js';

/**
 * Initial state structure
 */
const initialState = {
  // Authentication
  auth: {
    isAuthenticated: false,
    currentUser: null,
  },

  // Tweet tracking
  tweets: {
    processed: new Set(),      // Tweet IDs that have been processed
    pending: new Set(),        // Tweets awaiting batch fetch
    voted: new Map(),          // tweetId -> { voteType: 'up' | 'down', lastVotedAt: Date }
    impacts: new Map(),        // tweetId -> current realtimeNetImpact (for animation)
    animations: new Map(),     // tweetId -> animation frame ID
  },

  // Observers (not serializable)
  observers: {
    intersection: null,
    sidebar: null,
    tabBar: null,
    tweets: null,
  },

  // Timeouts and intervals
  timers: {
    fetchBatchTimeout: null,
    countdownInterval: null,
    cleanupInterval: null,
  },

  // Power stats cache
  power: {
    userStats: null,
    cachedData: null,
    lastFetch: null,
  },

  // Active modals
  modals: {
    powerSelector: null,
    refill: null,
    performance: null,
    rewards: null,
  },

  // Sidebar state
  sidebar: {
    injected: false,
  },

  // Bangit feed state
  feed: {
    tabInjected: false,
    active: false,
    container: null,
    originalTimeline: null,
    view: 'feeds',             // 'feeds' | 'leaderboard'
    tweetIds: [],
    cursor: null,
    loading: false,
    hasMore: true,
    // Feed filter preferences
    sortType: 'hot',           // 'hot' | 'top' | 'bump' | 'new'
    topPeriod: '24h',          // '8h' | '24h' | '3d' | '7d' | '30d'
    showFollowingOnly: false,
    // Real-time score tracking for FLIP reordering
    scores: new Map(),              // tweetId -> score (for sorting)
    pendingScoreUpdates: new Map(), // tweetId -> { score, timestamp } (for debouncing)
    reorderDebounceTimeout: null,   // Timeout ID for debounced reorder
    feedSessionId: 0,               // Incremented on feed type change to invalidate pending updates
    lastScoreTimestamp: new Map(),  // tweetId -> timestamp (for out-of-order event rejection)
    // Real-time tweet insertion (for tweets not in feed)
    pendingInsertions: new Map(),      // tweetId -> { score, timestamp } (for batch fetch)
    insertionDebounceTimeout: null,    // Timeout ID for debounced insertions
    // BUMP feed debounce state
    pendingBumpUpdates: new Map(),     // tweetId -> { timestamp } (for BUMP feed reordering)
    bumpDebounceTimeout: null,         // Timeout ID for debounced BUMP updates
    // NEW feed batch fetch state (for incomplete socket data)
    pendingNewPosts: new Map(),        // tweetId -> { timestamp } (for batch fetch when socket data is incomplete)
    newPostDebounceTimeout: null,      // Timeout ID for debounced new post fetching
    // Leaderboard state
    leaderboard: {
      selectedType: 'curators',        // 'curators' | 'creators'
      selectedPeriod: '24h',           // '24h' | '3d' | '7d' | '30d' | 'All'
      displayType: 'curators',         // Tracks what type the current data is for
      sortField: 'motion',             // 'motion' | 'taste' | 'streak'
      sortDirection: 'desc',           // 'asc' | 'desc'
      data: [],
      currentUser: null,
      loading: false,
      refreshing: false,
      error: null,
      lastLoadedKey: null,
    },
  },

  // Navigation
  navigation: {
    lastPathname: typeof window !== 'undefined' ? window.location.pathname : '/',
  },

  // Data caches
  cache: {
    distributions: null,
    curationStats: null,
    currentPeriodPerformance: null,
    performanceDetails: {},
  },
};

/**
 * Deep clone state for reset
 */
function createInitialState() {
  return {
    auth: { ...initialState.auth },
    tweets: {
      processed: new Set(),
      pending: new Set(),
      voted: new Map(),
      impacts: new Map(),
      animations: new Map(),
    },
    observers: { ...initialState.observers },
    timers: { ...initialState.timers },
    power: { ...initialState.power },
    modals: { ...initialState.modals },
    sidebar: { ...initialState.sidebar },
    feed: {
      ...initialState.feed,
      view: 'feeds',
      tweetIds: [],
      sortType: 'hot',
      topPeriod: '24h',
      showFollowingOnly: false,
      scores: new Map(),
      pendingScoreUpdates: new Map(),
      reorderDebounceTimeout: null,
      feedSessionId: 0,
      lastScoreTimestamp: new Map(),
      pendingInsertions: new Map(),
      insertionDebounceTimeout: null,
      pendingBumpUpdates: new Map(),
      bumpDebounceTimeout: null,
      pendingNewPosts: new Map(),
      newPostDebounceTimeout: null,
      leaderboard: {
        selectedType: 'curators',
        selectedPeriod: '24h',
        displayType: 'curators',
        sortField: 'motion',
        sortDirection: 'desc',
        data: [],
        currentUser: null,
        loading: false,
        refreshing: false,
        error: null,
        lastLoadedKey: null,
      },
    },
    navigation: {
      lastPathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    },
    cache: {
      distributions: null,
      curationStats: null,
      currentPeriodPerformance: null,
      performanceDetails: {},
    },
  };
}

// Current state
let state = createInitialState();

// Subscribers for state changes
const subscribers = new Set();

/**
 * Get the current state
 * @returns {object} Current state object
 */
export function getState() {
  return state;
}

/**
 * Update state with partial changes
 * @param {object} partial - Partial state to merge
 */
export function setState(partial) {
  // Shallow merge at top level
  state = { ...state, ...partial };
  // Notify subscribers
  subscribers.forEach(fn => {
    try {
      fn(state);
    } catch (e) {
      console.error('[Bangit] State subscriber error:', e);
    }
  });
}

/**
 * Update nested state
 * @param {string} key - Top-level state key
 * @param {object} partial - Partial state to merge
 */
export function updateState(key, partial) {
  if (state[key] && typeof state[key] === 'object') {
    state[key] = { ...state[key], ...partial };
    subscribers.forEach(fn => {
      try {
        fn(state);
      } catch (e) {
        console.error('[Bangit] State subscriber error:', e);
      }
    });
  }
}

/**
 * Subscribe to state changes
 * @param {Function} fn - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Reset state to initial values
 */
export function resetState() {
  // Clean up any existing timers/observers before reset
  cleanupState();
  state = createInitialState();
  subscribers.forEach(fn => {
    try {
      fn(state);
    } catch (e) {
      console.error('[Bangit] State subscriber error:', e);
    }
  });
}

/**
 * Clean up timers and observers
 */
export function cleanupState() {
  // Clear timers
  if (state.timers.fetchBatchTimeout) {
    clearTimeout(state.timers.fetchBatchTimeout);
  }
  if (state.timers.countdownInterval) {
    clearInterval(state.timers.countdownInterval);
  }
  if (state.timers.cleanupInterval) {
    clearInterval(state.timers.cleanupInterval);
  }

  // Disconnect observers
  if (state.observers.intersection) {
    state.observers.intersection.disconnect();
  }
  if (state.observers.sidebar) {
    state.observers.sidebar.disconnect();
  }
  if (state.observers.tabBar) {
    state.observers.tabBar.disconnect();
  }
  if (state.observers.tweets) {
    state.observers.tweets.disconnect();
  }

  // Cancel any active animations
  state.tweets.animations.forEach(frameId => {
    cancelAnimationFrame(frameId);
  });
}

// Convenience getters for common state access patterns

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return state.auth.isAuthenticated;
}

/**
 * Get current user
 * @returns {object|null}
 */
export function getCurrentUser() {
  return state.auth.currentUser;
}

/**
 * Get user power stats (cached)
 * @returns {object|null}
 */
export function getUserPowerStats() {
  return state.power.userStats;
}

/**
 * Set user power stats
 * @param {object} stats - Power stats object
 */
export function setUserPowerStats(stats) {
  state.power.userStats = stats;
}

/**
 * Check if power cache is valid
 * @returns {boolean}
 */
export function isPowerCacheValid() {
  return (
    state.power.cachedData &&
    state.power.lastFetch &&
    (Date.now() - state.power.lastFetch < CONFIG.POWER_CACHE_TTL)
  );
}

/**
 * Update power cache
 * @param {object} data - Power data
 */
export function updatePowerCache(data) {
  state.power.cachedData = data;
  state.power.lastFetch = Date.now();
}

/**
 * Get power cache
 * @returns {object|null}
 */
export function getPowerCache() {
  return state.power.cachedData;
}
