// Bangit - Configuration constants

export const CONFIG = {
  API_BASE_URL: 'https://bangit-backend-production.up.railway.app',
  POLL_INTERVAL: 1500, // How often to check for new tweets (ms)
  DEBOUNCE_DELAY: 300,
  MAX_POWER_PCT: 10, // Default voting power percentage
  BATCH_FETCH_DELAY: 500, // Delay before fetching batch of visible tweets
  COOLDOWN_HOURS: 8, // Hours before user can vote on same tweet again
  MIN_POWER_PCT: 1, // Minimum voting power percentage
  MAX_POWER_PCT_CAP: 20, // Maximum voting power percentage
  POWER_CACHE_TTL: 30000, // 30 seconds
};

// Metric descriptions for performance modal
export const METRIC_DESCRIPTIONS = {
  vision: 'How often your votes align with the final consensus',
  taste: 'How well you identify tweets that gain significant traction',
  motion: 'How early you vote on tweets before they become popular',
};
