// Bangit - Shared utility functions

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Format number for display (e.g., 1.2K, 3.4M)
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
export function formatNumber(num) {
  if (num === 0) {
    return '0';
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toFixed(1);
}

/**
 * Format number for sidebar display
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
export function formatSidebarNumber(num) {
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(1);
}

/**
 * Format number with specified decimal places
 * @param {number} num - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number with decimals
 */
export function formatNumberWithDecimals(num, decimals) {
  const absNum = Math.abs(num);
  if (absNum >= 1000000) {
    return (absNum / 1000000).toFixed(decimals) + 'M';
  } else if (absNum >= 1000) {
    return (absNum / 1000).toFixed(decimals) + 'K';
  }
  return absNum.toFixed(decimals);
}

/**
 * Format date for display (M/D/YYYY)
 * @param {string} dateStr - Date string
 * @returns {string} Formatted date
 */
export function formatDate(dateStr) {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Format relative time (e.g., "2h", "3d", "Jan 5")
 * @param {string} dateString - Date string
 * @returns {string} Formatted relative time
 */
export function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  // For older tweets, show date
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Check if extension context is still valid
 * @returns {boolean} True if context is valid
 */
export function isExtensionContextValid() {
  try {
    return chrome.runtime && !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

/**
 * Check if an error is due to extension context invalidation
 * @param {Error} error - Error to check
 * @returns {boolean} True if context invalidation error
 */
export function isContextInvalidatedError(error) {
  const message = error?.message || String(error);
  return message.includes('Extension context invalidated') ||
         message.includes('Extension context was invalidated') ||
         message.includes('context invalidated');
}

/**
 * Inject Rubik font via @font-face
 */
export function injectFonts() {
  const fontStyles = document.createElement('style');
  fontStyles.textContent = `
    @font-face {
      font-family: 'Rubik';
      font-style: normal;
      font-weight: 300 900;
      font-display: swap;
      src: url('${chrome.runtime.getURL('fonts/Rubik-Variable.woff2')}') format('woff2');
    }
  `;
  document.head.appendChild(fontStyles);
}

/**
 * Normalize vote type to 'up' or 'down'
 * Backend may send 'UPVOTE'/'DOWNVOTE' or 'up'/'down'
 * @param {string} voteType - Vote type string
 * @returns {'up'|'down'|null} Normalized vote type
 */
export function normalizeVoteType(voteType) {
  if (!voteType) return null;
  const normalized = voteType.toLowerCase();
  if (normalized === 'upvote' || normalized === 'up') return 'up';
  if (normalized === 'downvote' || normalized === 'down') return 'down';
  return null;
}

/**
 * Logarithmic scaling for vision calculation (mirrors backend logScale)
 * @param {number} x - Value to scale
 * @returns {number} log-scaled value
 */
export function logScale(x) {
  if (x >= 0) {
    return Math.log(x + 1);
  }
  return -Math.log(Math.abs(x) + 1);
}

/**
 * Calculate taste score (vision × conviction) for a single vote
 * @param {string} voteType - 'up' or 'down'
 * @param {number} currentImpact - Current realtimeNetImpact of the post
 * @param {number} impactAfterVote - realtimeNetImpactAfterVote snapshot from vote
 * @param {number} maxPowerPct - Conviction (1-20)
 * @returns {number} Taste score (positive = correct prediction)
 */
export function calculateTaste(voteType, currentImpact, impactAfterVote, maxPowerPct) {
  const logCurrent = logScale(currentImpact);
  const logAfterVote = logScale(impactAfterVote);

  // Vision: direction-aware impact change
  // Upvote: positive when impact goes UP (logCurrent > logAfterVote)
  // Downvote: positive when impact goes DOWN (logAfterVote > logCurrent)
  const vision = voteType === 'up'
    ? logCurrent - logAfterVote
    : logAfterVote - logCurrent;

  // Taste = vision × conviction
  return vision * maxPowerPct;
}

/**
 * Escape HTML entities to prevent XSS
 * @param {string} text - Raw text
 * @returns {string} Escaped HTML
 */
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Calculate time remaining until midnight UTC
 * @returns {{ hours: number, minutes: number, seconds: number, formatted: string }}
 */
export function calculateTimeToMidnightUTC() {
  const now = new Date();
  const midnightUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const diff = midnightUTC - now;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return { hours, minutes, seconds, formatted };
}
