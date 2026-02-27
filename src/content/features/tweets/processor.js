// Bangit - Tweet detection and ID extraction utilities

/**
 * Extract tweet ID from a tweet article element
 * @param {Element} tweetElement - Tweet article element
 * @returns {string|null} Tweet ID or null
 */
export function extractTweetId(tweetElement) {
  // PRIORITY 1: For main tweet on detail page, use the URL's tweet ID
  if (isOnTweetDetailPage()) {
    const urlTweetId = getTweetIdFromUrl();
    if (urlTweetId && isMainTweet(tweetElement)) {
      return urlTweetId;
    }
  }

  // PRIORITY 2: Check time element's parent link (most reliable)
  const timeElement = tweetElement.querySelector('time');
  if (timeElement) {
    const timeLink = timeElement.closest('a[href*="/status/"]');
    if (timeLink && !isInsideQuotedTweet(timeLink, tweetElement)) {
      const href = timeLink.getAttribute('href');
      const match = href.match(/\/status\/(\d+)/);
      if (match) {
        return match[1];
      }
    }
  }

  // PRIORITY 3: Look for status links, excluding quoted tweet containers
  const statusLinks = tweetElement.querySelectorAll('a[href*="/status/"]');
  for (const link of statusLinks) {
    if (!isInsideQuotedTweet(link, tweetElement)) {
      const href = link.getAttribute('href');
      const match = href.match(/\/status\/(\d+)/);
      if (match) {
        return match[1];
      }
    }
  }

  // FALLBACK: Use first status link
  const tweetLink = tweetElement.querySelector('a[href*="/status/"]');
  if (tweetLink) {
    const href = tweetLink.getAttribute('href');
    const match = href.match(/\/status\/(\d+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Check if an element is inside a quoted tweet container
 * @param {Element} element - Element to check
 * @param {Element} tweetElement - Parent tweet element
 * @returns {boolean}
 */
export function isInsideQuotedTweet(element, tweetElement) {
  let current = element.parentElement;
  while (current && current !== tweetElement) {
    if (current.getAttribute('data-testid') === 'card.wrapper' ||
        current.getAttribute('data-testid') === 'quoteTweet' ||
        (current.getAttribute('role') === 'link' &&
         current.getAttribute('tabindex') === '0' &&
         current.querySelector('time'))) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Check if current page is a tweet detail page
 * @returns {boolean}
 */
export function isOnTweetDetailPage() {
  return /\/status\/\d+/.test(window.location.pathname);
}

/**
 * Extract tweet ID from URL
 * @returns {string|null}
 */
export function getTweetIdFromUrl() {
  const match = window.location.pathname.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Check if this tweet element is the main/focal tweet on a detail page
 * @param {Element} tweetElement - Tweet element
 * @returns {boolean}
 */
export function isMainTweet(tweetElement) {
  // On tweet detail pages, the main tweet's time is NOT inside a link
  // (it shows full date like "5:57 AM · Jan 13, 2026 · 74 Views")
  // Parent tweets above and replies below have their time as clickable links
  const timeElement = tweetElement.querySelector('time');
  if (timeElement) {
    const timeLink = timeElement.closest('a[href*="/status/"]');
    if (!timeLink) {
      // Time is not a link - this is the main tweet on a detail page
      return true;
    }
    // Also check if the time link points to the URL's tweet ID
    const urlTweetId = getTweetIdFromUrl();
    if (timeLink && urlTweetId) {
      const linkMatch = timeLink.getAttribute('href').match(/\/status\/(\d+)/);
      if (linkMatch && linkMatch[1] === urlTweetId) {
        return true;
      }
    }
  }

  // Fallback for non-detail pages (home timeline, profile, etc.)
  // Only use this fallback when NOT on a tweet detail page
  if (!isOnTweetDetailPage()) {
    const timeline = tweetElement.closest('[aria-label*="Timeline"]') ||
                     tweetElement.closest('[data-testid="primaryColumn"]');
    if (timeline) {
      const allTweets = timeline.querySelectorAll('article[data-testid="tweet"]');
      if (allTweets.length > 0 && allTweets[0] === tweetElement) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find the action bar in a tweet (where like, retweet buttons are)
 * @param {Element} tweetElement - Tweet element
 * @returns {Element|null}
 */
export function findActionBar(tweetElement) {
  return tweetElement.querySelector('[role="group"]');
}

/**
 * Check if currently on home page
 * @returns {boolean}
 */
export function isOnHomePage() {
  const path = window.location.pathname;
  return path === '/' || path === '/home';
}
