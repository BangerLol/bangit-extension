// Bangit - FLIP Animation Utilities for Feed Reordering
// Pure functions for First-Last-Invert-Play animations

/**
 * Check if user prefers reduced motion
 * @returns {boolean} True if reduced motion is preferred
 */
export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Capture current Y positions of visible tweets
 * @param {string[]} tweetIds - Array of tweet IDs
 * @returns {Map<string, number>} Map of tweetId -> Y position
 */
export function capturePositions(tweetIds) {
  const positions = new Map();

  tweetIds.forEach(id => {
    const element = document.querySelector(`[data-tweet-id="${id}"]`);
    if (element) {
      const rect = element.getBoundingClientRect();
      positions.set(id, rect.top);
    }
  });

  return positions;
}

/**
 * Calculate transform deltas after reordering
 * @param {string[]} newOrder - New tweet order
 * @param {Map<string, number>} oldPositions - Captured positions before reorder
 * @returns {Map<string, number>} Map of tweetId -> deltaY
 */
export function calculateDeltas(newOrder, oldPositions) {
  const deltas = new Map();

  newOrder.forEach(id => {
    const element = document.querySelector(`[data-tweet-id="${id}"]`);
    if (element) {
      const newRect = element.getBoundingClientRect();
      const oldY = oldPositions.get(id);

      if (oldY !== undefined) {
        const delta = oldY - newRect.top;
        if (delta !== 0) {
          deltas.set(id, delta);
        }
      }
    }
  });

  return deltas;
}

/**
 * Apply inverse transforms (FLIP - Invert step)
 * Elements appear in their old positions
 * @param {Map<string, number>} deltas - Transform deltas
 */
export function applyInverseTransforms(deltas) {
  deltas.forEach((deltaY, tweetId) => {
    const element = document.querySelector(`[data-tweet-id="${tweetId}"]`);
    if (element) {
      element.style.transform = `translateY(${deltaY}px)`;
      element.style.transition = 'none';
    }
  });
}

/**
 * Animate elements to final positions (FLIP - Play step)
 * Uses staggered timing with bouncy easing
 * @param {Map<string, number>} deltas - Transform deltas
 * @param {number} duration - Animation duration in ms
 * @returns {Promise<void>} Resolves when animation completes
 */
export function animateToFinalPositions(deltas, duration = 500) {
  return new Promise(resolve => {
    const entries = Array.from(deltas.entries());
    let maxDelay = 0;

    entries.forEach(([tweetId], index) => {
      const element = document.querySelector(`[data-tweet-id="${tweetId}"]`);
      if (element) {
        // Stagger: max 150ms total
        const staggerDelay = Math.min(index * 30, 150);
        maxDelay = Math.max(maxDelay, staggerDelay);

        setTimeout(() => {
          // Bouncy cubic-bezier for satisfying overshoot
          element.style.transition = `transform ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
          element.style.transform = 'translateY(0)';
        }, staggerDelay);
      }
    });

    // Resolve after all animations complete
    setTimeout(resolve, maxDelay + duration + 50);
  });
}

/**
 * Clean up transform styles from elements
 * @param {string[]} tweetIds - Tweet IDs to clean up
 */
export function cleanupTransforms(tweetIds) {
  tweetIds.forEach(id => {
    const element = document.querySelector(`[data-tweet-id="${id}"]`);
    if (element) {
      element.style.transform = '';
      element.style.transition = '';
    }
  });
}

/**
 * Add rank change glow effect to tweet
 * @param {string} tweetId - Tweet ID
 * @param {'up'|'down'} direction - Rank change direction
 */
export function addRankGlow(tweetId, direction) {
  const element = document.querySelector(`[data-tweet-id="${tweetId}"]`);
  if (!element) return;

  // Add glow class
  element.classList.add(direction === 'up' ? 'bangit-rank-up-glow' : 'bangit-rank-down-glow');
}

/**
 * Remove rank change glow effects from tweets
 * @param {string[]} tweetIds - Tweet IDs to clean up
 */
export function removeRankGlows(tweetIds) {
  tweetIds.forEach(id => {
    const element = document.querySelector(`[data-tweet-id="${id}"]`);
    if (element) {
      element.classList.remove('bangit-rank-up-glow', 'bangit-rank-down-glow');
    }
  });
}

/**
 * Show rank change indicator on tweet
 * @param {string} tweetId - Tweet ID
 * @param {'up'|'down'} direction - Rank change direction
 * @param {number} magnitude - Number of positions changed
 */
export function showRankChangeIndicator(tweetId, direction, magnitude) {
  const element = document.querySelector(`[data-tweet-id="${tweetId}"]`);
  if (!element) return;

  // Remove any existing indicator
  const existing = element.querySelector('.bangit-rank-change');
  if (existing) existing.remove();

  // Create indicator
  const indicator = document.createElement('div');
  indicator.className = `bangit-rank-change bangit-rank-${direction}`;
  indicator.innerHTML = `
    <span class="bangit-rank-arrow">${direction === 'up' ? '↑' : '↓'}</span>
    <span class="bangit-rank-magnitude">${magnitude}</span>
  `;

  // Insert at start of tweet
  element.style.position = 'relative';
  element.insertBefore(indicator, element.firstChild);

  // Trigger animation
  requestAnimationFrame(() => {
    indicator.classList.add('bangit-rank-animating');
  });

  // Remove after animation
  setTimeout(() => {
    indicator.remove();
  }, 2000);
}
