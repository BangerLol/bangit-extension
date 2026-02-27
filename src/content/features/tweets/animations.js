// Bangit - Impact counter animations

import { getState } from '../../core/state.js';
import { formatNumber, formatNumberWithDecimals } from '../../core/utils.js';

// Regex for suffix extraction - compiled once
const SUFFIX_REGEX = /[A-Za-z]+$/;

/**
 * Ensure the impact value element has the animated structure.
 * Creates the DOM structure once, then reuses it for updates.
 * @param {HTMLElement} element - Impact value element
 * @param {string} direction - 'up' or 'down'
 * @returns {Object} References to child elements
 */
function ensureAnimatedStructure(element, direction) {
  // Check if structure already exists
  let wholeSpan = element.querySelector('.bangit-value-whole');
  let decimalWrapper = element.querySelector('.bangit-value-decimal-wrapper');
  let decimalSpan = element.querySelector('.bangit-value-decimal');
  let glowSpan = element.querySelector('.bangit-value-decimal-glow');

  if (!wholeSpan || !decimalWrapper) {
    // Create structure once
    element.innerHTML = `
      <span class="bangit-value-whole"></span>
      <span class="bangit-value-decimal-wrapper">
        <span class="bangit-value-decimal bangit-decimal-${direction}"></span>
        <span class="bangit-value-decimal-glow bangit-decimal-glow-${direction}"></span>
      </span>
    `;
    wholeSpan = element.querySelector('.bangit-value-whole');
    decimalWrapper = element.querySelector('.bangit-value-decimal-wrapper');
    decimalSpan = element.querySelector('.bangit-value-decimal');
    glowSpan = element.querySelector('.bangit-value-decimal-glow');
  }

  return { wholeSpan, decimalWrapper, decimalSpan, glowSpan };
}

/**
 * Animate impact counter change
 * @param {string} tweetId - Tweet ID
 * @param {number} previousValue - Previous impact value
 * @param {number} newValue - New impact value
 * @param {string} direction - 'up' or 'down'
 */
export function animateImpactChange(tweetId, previousValue, newValue, direction) {
  const state = getState();
  const container = document.querySelector(`.bangit-stats-container[data-tweet-id="${tweetId}"]`);
  if (!container) return;

  const impactStat = container.querySelector('.bangit-impact');
  const impactValue = container.querySelector('.bangit-impact-value');
  const glowElement = container.querySelector('.bangit-impact-glow');
  const changeElement = container.querySelector('.bangit-impact-change');

  if (!impactStat || !impactValue) return;

  // Cancel any existing animation for this tweet
  if (state.tweets.animations.has(tweetId)) {
    cancelAnimationFrame(state.tweets.animations.get(tweetId));
    state.tweets.animations.delete(tweetId);
  }

  const impactChange = newValue - previousValue;
  const isIncrease = direction === 'up' || impactChange > 0;
  const directionClass = isIncrease ? 'up' : 'down';

  // Set up glow element
  if (glowElement) {
    glowElement.className = `bangit-impact-glow bangit-glow-${directionClass}`;
  }

  // Set up floating change indicator
  if (changeElement) {
    const changeText = impactChange >= 0 ? `+${impactChange.toFixed(2)}` : impactChange.toFixed(2);
    changeElement.textContent = changeText;
    changeElement.className = `bangit-impact-change bangit-change-${directionClass}`;
  }

  // Trigger animations using animation property toggle (no force reflow needed)
  impactStat.style.animation = 'none';
  if (changeElement) changeElement.style.animation = 'none';
  if (glowElement) glowElement.style.animation = 'none';

  // Use rAF to ensure style is applied before re-enabling animation
  requestAnimationFrame(() => {
    impactStat.style.animation = '';
    if (changeElement) changeElement.style.animation = '';
    if (glowElement) glowElement.style.animation = '';

    impactStat.classList.add('bangit-animating');
    if (changeElement) changeElement.classList.add('bangit-animating');
    if (glowElement) glowElement.classList.add('bangit-animating');
  });

  // Pre-create the DOM structure for animation
  const refs = ensureAnimatedStructure(impactValue, directionClass);
  impactValue.classList.add('bangit-animating-value');

  // Animate the counter value
  const duration = 1200; // 1.2 seconds
  const startTime = performance.now();

  function updateCounter(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentValue = previousValue + (impactChange * easeProgress);

    // Update values using textContent (no innerHTML in loop)
    updateAnimatedValue(refs, currentValue, progress < 1);

    if (progress < 1) {
      state.tweets.animations.set(tweetId, requestAnimationFrame(updateCounter));
    } else {
      // Animation complete - render final value
      state.tweets.animations.delete(tweetId);
      state.tweets.impacts.set(tweetId, newValue);
      renderFinalValue(impactValue, newValue);

      // Clean up animation classes after animation ends
      setTimeout(() => {
        impactStat.classList.remove('bangit-animating');
        if (changeElement) changeElement.classList.remove('bangit-animating');
        if (glowElement) glowElement.classList.remove('bangit-animating');
      }, 100);
    }
  }

  state.tweets.animations.set(tweetId, requestAnimationFrame(updateCounter));
}

/**
 * Update animated value using textContent (no innerHTML)
 * @param {Object} refs - References to DOM elements
 * @param {number} value - Current value
 * @param {boolean} isAnimating - Whether animation is in progress
 */
function updateAnimatedValue(refs, value, isAnimating) {
  // Handle negative sign separately since formatNumberWithDecimals uses abs
  const sign = value < 0 ? '-' : '';
  const formatted = formatNumberWithDecimals(value, 2);

  if (!formatted.includes('.')) {
    refs.wholeSpan.textContent = sign + formatted;
    refs.decimalWrapper.style.display = 'none';
    return;
  }

  refs.decimalWrapper.style.display = '';

  // Parse the formatted value using cached regex
  const suffixMatch = formatted.match(SUFFIX_REGEX);
  const suffix = suffixMatch ? suffixMatch[0] : '';
  const numericPart = suffix ? formatted.slice(0, -suffix.length) : formatted;
  const dotIndex = numericPart.indexOf('.');
  const wholePart = numericPart.slice(0, dotIndex);
  const decimalPart = numericPart.slice(dotIndex + 1);

  // Update using textContent only (include sign in whole part)
  refs.wholeSpan.textContent = sign + wholePart;
  refs.decimalSpan.textContent = `.${decimalPart}${suffix}`;

  if (isAnimating) {
    refs.glowSpan.classList.add('bangit-animating');
  } else {
    refs.glowSpan.classList.remove('bangit-animating');
  }
}

/**
 * Render final static value
 * @param {HTMLElement} element - Element to render into
 * @param {number} value - Final value
 */
function renderFinalValue(element, value) {
  element.classList.remove('bangit-animating-value');
  // Preserve negative sign for negative values
  const sign = value < 0 ? '-' : '';
  element.textContent = sign + formatNumber(Math.abs(value));
  element.style.color = '#f2c1fb';
}
