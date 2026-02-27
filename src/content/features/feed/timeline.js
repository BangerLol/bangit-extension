// Bangit - Timeline management for custom feed
// Handles timeline swap and tweet rendering

import { getState, updateState } from '../../core/state.js';
import { formatNumber, escapeHtml } from '../../core/utils.js';
import { CONFIG } from '../../core/config.js';
import { subscribeFeedRanking, unsubscribeFeedRanking } from '../../core/rpc.js';
import { createStatsContainer, markTweetAsVoted, markTweetAsVotable } from '../tweets/vote-ui.js';
import { fetchFeed, DEFAULT_PAGE_SIZE } from './feed-api.js';
import { createFeedHeader, loadFeedPreferences, saveFeedPreferences } from './header.js';
import { createLeaderboardUI, ensureLeaderboardData, setLeaderboardVisible, syncLeaderboardUI } from './leaderboard.js';
import { setInitialScore, clearScores } from './realtime.js';

/**
 * Feed type mapping (matches backend feed types)
 */
const FEED_TYPE_MAP = {
  hot: 'HOT',
  top: {
    '8h': 'TOP_8H',
    '24h': 'TOP_24H',
    '3d': 'TOP_3D',
    '7d': 'TOP_7D',
    '30d': 'TOP_30D',
  },
  new: 'NEW',
  // Note: BUMP feed uses global tweet:impactUpdate events (no room subscription needed)
};

/**
 * Get the current feed type string based on state
 * @returns {string|null} Feed type or null if not applicable
 */
function getCurrentFeedType() {
  const { sortType, topPeriod } = getState().feed;

  if (sortType === 'hot') {
    return FEED_TYPE_MAP.hot;
  }

  if (sortType === 'top') {
    return FEED_TYPE_MAP.top[topPeriod] || 'TOP_24H';
  }

  if (sortType === 'new') {
    return FEED_TYPE_MAP.new;
  }

  // BUMP feed uses global tweet:impactUpdate events (no room subscription needed)
  return null;
}

/**
 * Currently subscribed feed type (to track for unsubscription)
 */
let currentSubscribedFeedType = null;

/**
 * Subscribe to the current feed type's socket room
 */
async function subscribeToCurrentFeed() {
  const feedType = getCurrentFeedType();
  if (!feedType) {
    if (currentSubscribedFeedType) {
      console.log('[Bangit] Unsubscribing from previous feed (no realtime for current type):', currentSubscribedFeedType);
      await unsubscribeFeedRanking(currentSubscribedFeedType);
      currentSubscribedFeedType = null;
    }
    console.log('[Bangit] Feed type does not support real-time reordering');
    return;
  }

  // Unsubscribe from previous feed type if different
  if (currentSubscribedFeedType && currentSubscribedFeedType !== feedType) {
    console.log('[Bangit] Unsubscribing from previous feed:', currentSubscribedFeedType);
    await unsubscribeFeedRanking(currentSubscribedFeedType);
  }

  // Subscribe to new feed type
  console.log('[Bangit] Subscribing to feed room:', feedType);
  const result = await subscribeFeedRanking(feedType);
  if (result.success) {
    currentSubscribedFeedType = feedType;
  } else {
    console.warn('[Bangit] Failed to subscribe to feed:', result.error);
  }
}

/**
 * Unsubscribe from the current feed type's socket room
 */
async function unsubscribeFromCurrentFeed() {
  if (!currentSubscribedFeedType) return;

  console.log('[Bangit] Unsubscribing from feed room:', currentSubscribedFeedType);
  await unsubscribeFeedRanking(currentSubscribedFeedType);
  currentSubscribedFeedType = null;
}

/**
 * DOM selectors
 */
const SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  homeTimeline: '[aria-label="Home timeline"]',
  timeline: '[aria-label*="Timeline:"]',
  timelineContent: 'section[role="region"]',
  newPostsButton: 'button[aria-label^="New posts are available"]',
};

/**
 * Bangit feed container ID
 */
const FEED_CONTAINER_ID = 'bangit-feed-container';

/**
 * Infinite scroll sentinel ID
 */
const LOAD_MORE_SENTINEL_ID = 'bangit-load-more-sentinel';

/**
 * Reference to IntersectionObserver for infinite scroll
 */
let infiniteScrollObserver = null;

/* COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
 * Reference to MutationObserver for hiding new posts button
 */
// let newPostsObserver = null;

/**
 * Vote click handler reference
 */
let voteClickHandler = null;

/**
 * Sticky header scroll handler reference
 */
let stickyScrollHandler = null;

/**
 * Sticky header placeholder element reference
 */
let headerPlaceholder = null;

/**
 * Feed mode tabs element reference
 */
let feedModeTabs = null;

/**
 * Leaderboard UI reference
 */
let leaderboardUI = null;

/**
 * Set the vote click handler
 * @param {Function} handler - Vote click handler from index.js
 */
export function setVoteClickHandler(handler) {
  voteClickHandler = handler;
}

/**
 * Get Twitter's sticky header height
 * @returns {number} Header height in pixels
 */
function getTwitterHeaderHeight() {
  // Twitter's header with tabs
  const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
  if (primaryColumn) {
    const stickyHeader = primaryColumn.querySelector(':scope > div > div');
    if (stickyHeader) {
      const style = window.getComputedStyle(stickyHeader);
      if (style.position === 'sticky') {
        return stickyHeader.getBoundingClientRect().height;
      }
    }
  }
  return 53; // fallback
}

/**
 * Setup sticky header behavior
 * Makes the feed header stick below Twitter's header when scrolling
 */
function setupStickyHeader() {
  const feedContainer = document.getElementById(FEED_CONTAINER_ID);
  const feedSticky = feedContainer?.querySelector('.bangit-feed-sticky');
  if (!feedContainer || !feedSticky) return;

  const updateCSSVariables = () => {
    const twitterHeaderHeight = getTwitterHeaderHeight();
    const containerRect = feedContainer.getBoundingClientRect();
    const stickyHeight = feedSticky.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--bangit-twitter-header-height', `${twitterHeaderHeight}px`);
    document.documentElement.style.setProperty('--bangit-feed-left', `${containerRect.left}px`);
    document.documentElement.style.setProperty('--bangit-feed-width', `${containerRect.width}px`);
    document.documentElement.style.setProperty('--bangit-feed-sticky-height', `${stickyHeight}px`);
  };

  updateCSSVariables();

  stickyScrollHandler = () => {
    const twitterHeaderHeight = getTwitterHeaderHeight();
    const containerRect = feedContainer.getBoundingClientRect();

    // Header should stick when container top is above Twitter header bottom
    const shouldStick = containerRect.top < twitterHeaderHeight;
    const isSticky = feedSticky.classList.contains('bangit-header-sticky');

    if (shouldStick && !isSticky) {
      // Add placeholder before header to prevent content jump
      if (!headerPlaceholder) {
        headerPlaceholder = document.createElement('div');
        headerPlaceholder.className = 'bangit-header-placeholder';
        headerPlaceholder.style.height = `${feedSticky.getBoundingClientRect().height}px`;
        feedContainer.insertBefore(headerPlaceholder, feedSticky);
      }
      updateCSSVariables();
      feedSticky.classList.add('bangit-header-sticky');
    } else if (!shouldStick && isSticky) {
      // Remove sticky mode
      feedSticky.classList.remove('bangit-header-sticky');
      if (headerPlaceholder) {
        headerPlaceholder.remove();
        headerPlaceholder = null;
      }
    } else if (isSticky) {
      // Update position while sticky (for resize events)
      if (headerPlaceholder) {
        headerPlaceholder.style.height = `${feedSticky.getBoundingClientRect().height}px`;
      }
      updateCSSVariables();
    }
  };

  window.addEventListener('scroll', stickyScrollHandler, { passive: true });
  window.addEventListener('resize', stickyScrollHandler, { passive: true });
}

/**
 * Disconnect sticky header listeners and cleanup
 */
function disconnectStickyHeader() {
  if (stickyScrollHandler) {
    window.removeEventListener('scroll', stickyScrollHandler);
    window.removeEventListener('resize', stickyScrollHandler);
    stickyScrollHandler = null;
  }
  if (headerPlaceholder) {
    headerPlaceholder.remove();
    headerPlaceholder = null;
  }
  // Remove sticky class from header if present
  const feedContainer = document.getElementById(FEED_CONTAINER_ID);
  const feedSticky = feedContainer?.querySelector('.bangit-feed-sticky');
  if (feedSticky) {
    feedSticky.classList.remove('bangit-header-sticky');
  }
}

/**
 * Refresh sticky header layout after content changes
 */
function refreshStickyHeaderLayout() {
  if (stickyScrollHandler) {
    stickyScrollHandler();
  }
}

/**
 * Update feed mode tab UI
 * @param {'feeds'|'leaderboard'} view
 */
function updateFeedModeTabsUI(view) {
  if (!feedModeTabs) return;
  const buttons = feedModeTabs.querySelectorAll('.bangit-feed-mode-button');
  buttons.forEach((btn, idx) => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('bangit-feed-mode-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    if (isActive) {
      feedModeTabs.style.setProperty('--tab-index', String(idx));
    }
  });
}

/**
 * Apply the current feed view (feeds vs leaderboard)
 */
function applyFeedView() {
  const state = getState();
  const container = document.getElementById(FEED_CONTAINER_ID);
  if (!container) return;

  const isLeaderboard = state.feed.view === 'leaderboard';
  const feedHeader = container.querySelector('.bangit-feed-header');
  const feedContent = container.querySelector('.bangit-feed-content');
  const sentinel = container.querySelector('.bangit-load-more-sentinel');

  if (feedHeader) {
    feedHeader.style.display = isLeaderboard ? 'none' : '';
  }
  if (feedContent) {
    feedContent.style.display = isLeaderboard ? 'none' : '';
  }
  if (sentinel) {
    sentinel.style.display = isLeaderboard ? 'none' : '';
  }

  setLeaderboardVisible(isLeaderboard);
  if (isLeaderboard) {
    disconnectInfiniteScroll();
    ensureLeaderboardData();
  } else if (state.feed.active) {
    setupInfiniteScroll();
    if (!state.feed.loading && state.feed.tweetIds.length === 0) {
      loadFeed();
    }
  }

  updateFeedModeTabsUI(state.feed.view);
  syncLeaderboardUI();
  refreshStickyHeaderLayout();
}

/**
 * Set the active feed view
 * @param {'feeds'|'leaderboard'} view
 */
function setFeedView(view) {
  const state = getState();
  if (state.feed.view === view) return;
  updateState('feed', { view });
  applyFeedView();
}

/**
 * Create feed mode tabs (Feeds / Leaderboard)
 */
function createFeedModeTabs() {
  const container = document.createElement('div');
  container.className = 'bangit-feed-mode-tabs';
  container.setAttribute('role', 'tablist');
  container.style.setProperty('--tab-count', '2');

  const indicator = document.createElement('div');
  indicator.className = 'bangit-feed-mode-indicator';
  container.appendChild(indicator);

  const tabs = [
    { key: 'feeds', label: 'Feeds' },
    { key: 'leaderboard', label: 'Leaderboard' },
  ];

  tabs.forEach((tab, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bangit-feed-mode-button';
    button.dataset.view = tab.key;
    button.textContent = tab.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', tab.key === getState().feed.view ? 'true' : 'false');
    button.addEventListener('click', () => setFeedView(tab.key));

    container.appendChild(button);

    if (tab.key === getState().feed.view) {
      container.style.setProperty('--tab-index', String(index));
      button.classList.add('bangit-feed-mode-active');
    }
  });

  return container;
}

/**
 * Find the native timeline element (tweets section only)
 * @returns {HTMLElement|null}
 */
function findNativeTimeline() {
  // Only return the tweets section (section[role="region"]), not the broader Home timeline container
  // This ensures the feed container is positioned correctly below the header
  return document.querySelector(SELECTORS.timelineContent);
}

/**
 * Find the timeline's parent container for inserting our feed
 * @returns {HTMLElement|null}
 */
function findTimelineParent() {
  const timeline = findNativeTimeline();
  return timeline?.parentElement || null;
}

/**
 * Prepare the timeline parent for overlay positioning
 * Sets position: relative on parent so absolute overlay works correctly
 */
function prepareTimelineParentForOverlay() {
  const parent = findTimelineParent();
  if (parent) {
    // Ensure parent has relative positioning for absolute overlay to work
    if (!parent.style.position || parent.style.position === 'static') {
      parent.style.position = 'relative';
    }
    updateState('feed', { timelineParent: parent });
  }
}

// Note: hideNativeTimeline() and showNativeTimeline() removed
// Now using overlay approach - Bangit feed sits on top of native timeline
// This prevents Twitter from detecting visibility changes and refreshing the feed

/* COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
 * Now relying on z-index stacking (feed container z-index: 1000) to cover native popups
 *
 * Hide the "New posts available" button popup
 */
// function hideNewPostsButton() {
//   const button = document.querySelector(SELECTORS.newPostsButton);
//   if (button) {
//     // Find the parent container (div[role="status"])
//     const container = button.closest('[role="status"]');
//     if (container) {
//       container.style.display = 'none';
//     }
//   }
// }

/* COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
 * Show the "New posts available" button popup
 */
// function showNewPostsButton() {
//   const button = document.querySelector(SELECTORS.newPostsButton);
//   if (button) {
//     const container = button.closest('[role="status"]');
//     if (container) {
//       container.style.display = '';
//     }
//   }
// }

/* COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
 * Setup observer to keep new posts button hidden while Bangit feed is active
 */
// function setupNewPostsObserver() {
//   if (newPostsObserver) return;
//
//   const homeTimeline = document.querySelector(SELECTORS.homeTimeline);
//   if (!homeTimeline) return;
//
//   newPostsObserver = new MutationObserver(() => {
//     const state = getState();
//     if (state.feed.active) {
//       hideNewPostsButton();
//     }
//   });
//
//   newPostsObserver.observe(homeTimeline, {
//     childList: true,
//     subtree: true,
//   });
// }

/* COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
 * Disconnect the new posts observer
 */
// function disconnectNewPostsObserver() {
//   if (newPostsObserver) {
//     newPostsObserver.disconnect();
//     newPostsObserver = null;
//   }
// }

/**
 * Create the Bangit feed container
 * @returns {HTMLElement}
 */
function createFeedContainer() {
  const container = document.createElement('div');
  container.id = FEED_CONTAINER_ID;
  container.className = 'bangit-feed-container';

  // Create sticky header wrapper
  const sticky = document.createElement('div');
  sticky.className = 'bangit-feed-sticky';

  // Create feed/leaderboard mode tabs
  feedModeTabs = createFeedModeTabs();
  sticky.appendChild(feedModeTabs);

  // Create header with filter controls (feed selector)
  const header = createFeedHeader(handleFilterChange);
  sticky.appendChild(header);

  // Create leaderboard header (type/period tabs)
  leaderboardUI = createLeaderboardUI();
  sticky.appendChild(leaderboardUI.header);

  container.appendChild(sticky);

  // Create content container
  const content = document.createElement('div');
  content.className = 'bangit-feed-content';

  // Single click handler for all tweets (better performance)
  content.addEventListener('click', handleFeedContentClick);

  container.appendChild(content);

  // Create leaderboard container (hidden by default)
  container.appendChild(leaderboardUI.container);

  // Create infinite scroll sentinel
  const sentinel = document.createElement('div');
  sentinel.id = LOAD_MORE_SENTINEL_ID;
  sentinel.className = 'bangit-load-more-sentinel';
  container.appendChild(sentinel);

  return container;
}

/**
 * Handle clicks on feed content through a single shared handler
 * @param {MouseEvent} e - Click event
 */
function handleFeedContentClick(e) {
  // Don't navigate if clicking on vote button, media, links (mentions, URLs, reply chain)
  if (
    e.target.closest('.bangit-stats-container') ||
    e.target.closest('.bangit-tweet-media') ||
    e.target.closest('.bangit-reply-chain-link') ||
    e.target.closest('.bangit-mention-link') ||
    e.target.closest('.bangit-text-link')
  ) {
    return;
  }

  // Find the tweet article
  const article = e.target.closest('.bangit-tweet');
  if (!article) return;

  const tweetId = article.dataset.tweetId;
  if (!tweetId) return;

  // Check if clicking on quoted tweet - navigate to quoted tweet instead
  const quotedTweet = e.target.closest('.bangit-quoted-tweet');
  if (quotedTweet) {
    const quotedTweetId = quotedTweet.dataset.tweetId;
    const quotedHandle = quotedTweet.dataset.handle;
    if (quotedTweetId && quotedHandle) {
      window.open(`https://x.com/${quotedHandle}/status/${quotedTweetId}`, '_blank');
      return;
    }
  }

  // Get handle from article's author link
  const authorLink = article.querySelector('.bangit-author-link');
  if (authorLink) {
    const handle = authorLink.href.split('x.com/')[1]?.split('?')[0];
    if (handle) {
      window.open(`https://x.com/${handle}/status/${tweetId}`, '_blank');
    }
  }
}

/**
 * Handle filter change (sort type, period, following)
 * Clears current feed and reloads with new filters
 */
async function handleFilterChange() {
  // Save preferences
  await saveFeedPreferences();

  // Clear current tweets and scores
  clearScores();
  const feedContent = getFeedContent();
  if (feedContent) {
    feedContent.innerHTML = '';
  }

  // Reset pagination state and increment feedSessionId to invalidate pending score updates
  const state = getState();
  updateState('feed', {
    tweetIds: [],
    cursor: null,
    hasMore: true,
    feedSessionId: (state.feed.feedSessionId || 0) + 1,
  });

  // Re-subscribe to the new feed type (handles unsubscribe from old automatically)
  await subscribeToCurrentFeed();

  // Reload feed with new filters
  await loadFeed();
}

/**
 * Get the feed content container
 * @returns {HTMLElement|null}
 */
export function getFeedContent() {
  const container = document.getElementById(FEED_CONTAINER_ID);
  return container?.querySelector('.bangit-feed-content') || null;
}

/**
 * Linkify text - convert @mentions and URLs to clickable links
 * @param {string} text - Raw tweet text
 * @returns {string} HTML string with links
 */
function linkifyText(text) {
  if (!text) return '';

  // URL regex pattern to match http/https URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  // Mention regex to match @mentions
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;

  // First escape HTML to prevent XSS
  let html = escapeHtml(text);

  // Replace URLs with clickable links
  html = html.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="bangit-text-link">${url}</a>`;
  });

  // Replace @mentions with clickable links to profiles
  html = html.replace(mentionRegex, (match, username) => {
    return `<a href="https://x.com/${username}" target="_blank" rel="noopener" class="bangit-mention-link">@${username}</a>`;
  });

  return html;
}

/**
 * Format relative time (e.g., "2h", "3d")
 * @param {Date|string} date - Date to format
 * @returns {string}
 */
function formatRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d`;
  if (diffHour > 0) return `${diffHour}h`;
  if (diffMin > 0) return `${diffMin}m`;
  return 'now';
}

/**
 * Render media (images/videos/gifs) for a tweet
 * @param {Array} media - Array of media objects
 * @returns {string} HTML string
 */
function renderMedia(media) {
  if (!media || media.length === 0) return '';

  const mediaItems = media.map((item) => {
    const mediaUrl = escapeHtml(item?.sourceUrl || item?.url || '');
    const previewUrl = escapeHtml(item?.previewUrl || '');

    // Regular videos with controls
    if (item.type === 'video') {
      if (!mediaUrl) return '';
      return `
        <div class="bangit-media-item bangit-media-video">
          <video src="${mediaUrl}" controls poster="${previewUrl}" preload="metadata"></video>
        </div>
      `;
    }
    // GIFs: autoplay, loop, muted (Twitter-style) - they're actually MP4 videos
    if (item.type === 'gif') {
      if (!mediaUrl) return '';
      return `
        <div class="bangit-media-item bangit-media-video bangit-media-gif">
          <video src="${mediaUrl}" autoplay loop muted playsinline poster="${previewUrl}" preload="auto"></video>
        </div>
      `;
    }
    // Images
    if (!mediaUrl) return '';
    return `
      <div class="bangit-media-item bangit-media-image">
        <img src="${mediaUrl}" alt="Tweet media" loading="lazy" />
      </div>
    `;
  }).join('');

  const gridClass = media.length === 1 ? 'single' : media.length === 2 ? 'double' : 'grid';
  return `<div class="bangit-tweet-media bangit-media-${gridClass}">${mediaItems}</div>`;
}

/**
 * Render a quoted tweet
 * @param {object} quoted - Quoted tweet data
 * @returns {string} HTML string
 */
function renderQuotedTweet(quoted) {
  if (!quoted) return '';

  const author = quoted.author || {};
  const avatarUrl = escapeHtml(author.twitterAvatarUrl || '');
  const name = escapeHtml(author.twitterName || 'Unknown');
  const handle = escapeHtml(author.twitterUsername || 'unknown');
  const tweetId = escapeHtml(quoted.tweetId || '');

  return `
    <div class="bangit-quoted-tweet" data-tweet-id="${tweetId}" data-handle="${handle}">
      <div class="bangit-quoted-header">
        <img class="bangit-quoted-avatar" src="${avatarUrl}" alt="${name}" />
        <span class="bangit-quoted-name">${name}</span>
        <span class="bangit-quoted-handle">@${handle}</span>
      </div>
      <div class="bangit-quoted-text">${linkifyText(quoted.text)}</div>
      ${renderMedia(quoted.media)}
    </div>
  `;
}

/**
 * Render reply chain indicator
 * @param {Array} replyChainAuthors - Array of author objects
 * @returns {string} HTML string
 */
function renderReplyChain(replyChainAuthors) {
  if (!replyChainAuthors || replyChainAuthors.length === 0) return '';

  const handleLinks = replyChainAuthors.map((a) => {
    const username = escapeHtml(a.twitterUsername || '');
    return `<a href="https://x.com/${username}" target="_blank" rel="noopener" class="bangit-reply-chain-link">@${username}</a>`;
  }).join(' ');
  return `
    <div class="bangit-reply-chain">
      <span class="bangit-reply-chain-text">Replying to ${handleLinks}</span>
    </div>
  `;
}

/**
 * Render a single tweet
 * @param {object} tweet - Tweet data from API
 * @returns {HTMLElement}
 */
export function renderTweet(tweet) {
  const author = tweet.author || {};
  const avatarUrl = escapeHtml(author.twitterAvatarUrl || '');
  const name = escapeHtml(author.twitterName || 'Unknown');
  const handle = escapeHtml(author.twitterUsername || 'unknown');

  const article = document.createElement('article');
  article.className = 'bangit-tweet';
  article.dataset.tweetId = tweet.tweetId;
  if (tweet.id) {
    article.dataset.postId = tweet.id;
  }
  if (tweet.isPinned) {
    article.dataset.isPinned = 'true';
  }
  article.dataset.bangitObserved = 'true';

  // Note: Click handling is done on the feed container
  // See handleFeedContentClick() for the click handler

  article.innerHTML = `
    <div class="bangit-tweet-content">
      <div class="bangit-avatar">
        <a href="https://x.com/${handle}" target="_blank" rel="noopener">
          <img src="${avatarUrl}" alt="${name}" />
        </a>
      </div>
      <div class="bangit-tweet-body">
        <div class="bangit-tweet-header">
          <a href="https://x.com/${handle}" target="_blank" rel="noopener" class="bangit-author-link">
            <span class="bangit-name">${name}</span>
            <span class="bangit-handle">@${handle}</span>
          </a>
          <span class="bangit-time">${formatRelativeTime(tweet.postedAt)}</span>
        </div>
        ${renderReplyChain(tweet.replyChainAuthors)}
        <div class="bangit-tweet-text">${linkifyText(tweet.text)}</div>
        ${renderMedia(tweet.media)}
        ${renderQuotedTweet(tweet.quoted)}
        <div class="bangit-actions" role="group"></div>
      </div>
    </div>
  `;

  // Add vote button
  const actionsBar = article.querySelector('.bangit-actions');
  if (actionsBar && voteClickHandler) {
    const statsContainer = createStatsContainer(tweet.tweetId, false, voteClickHandler);
    actionsBar.appendChild(statsContainer);

    // Set initial impact value directly (element not in DOM yet, so can't use querySelector)
    const realtimeNetImpact = parseFloat(tweet.realtimeNetImpact) || 0;
    const impactValueEl = statsContainer.querySelector('.bangit-impact-value');
    if (impactValueEl) {
      impactValueEl.textContent = formatNumber(Math.abs(realtimeNetImpact));
    }

    // Store impact value in state for real-time updates
    const state = getState();
    state.tweets.impacts.set(tweet.tweetId, realtimeNetImpact);

    // Store feed score for real-time reordering (feedScore comes from API)
    if (tweet.feedScore !== undefined) {
      setInitialScore(tweet.tweetId, tweet.feedScore);
    }

    // Handle vote cooldown status
    if (tweet.lastVotedAt && tweet.lastVoteDirection) {
      const votedDate = new Date(tweet.lastVotedAt);
      const now = new Date();
      const hoursSinceVote = (now - votedDate) / (1000 * 60 * 60);

      state.tweets.voted.set(tweet.tweetId, {
        voteType: tweet.lastVoteDirection,
        lastVotedAt: votedDate
      });

      if (hoursSinceVote >= CONFIG.COOLDOWN_HOURS) {
        markTweetAsVotable(statsContainer);
      } else {
        const hoursRemaining = CONFIG.COOLDOWN_HOURS - hoursSinceVote;
        markTweetAsVoted(statsContainer, tweet.lastVoteDirection, hoursRemaining);
      }
    }

    // Trigger the graceful entry animation after insertion
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        statsContainer.classList.add('bangit-visible');
      });
    });
  }

  return article;
}

/**
 * Render multiple tweets
 * @param {Array} tweets - Array of tweet data
 */
function renderTweets(tweets) {
  const feedContent = getFeedContent();
  if (!feedContent) {
    console.warn('[Bangit] Feed content container not found');
    return;
  }

  tweets.forEach((tweet) => {
    const tweetElement = renderTweet(tweet);
    feedContent.appendChild(tweetElement);
  });
}

/**
 * Show loading indicator
 */
function showLoading() {
  const feedContent = getFeedContent();
  if (!feedContent) return;

  // Remove existing loading indicator
  const existing = feedContent.querySelector('.bangit-feed-loading');
  if (existing) existing.remove();

  const loading = document.createElement('div');
  loading.className = 'bangit-feed-loading';
  loading.innerHTML = '<div class="bangit-spinner"></div>';
  feedContent.appendChild(loading);
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  const feedContent = getFeedContent();
  if (!feedContent) return;

  const loading = feedContent.querySelector('.bangit-feed-loading');
  if (loading) loading.remove();
}

/**
 * Show empty state
 */
function showEmptyState() {
  const feedContent = getFeedContent();
  if (!feedContent) return;

  const state = getState();
  const empty = document.createElement('div');
  empty.className = 'bangit-feed-empty';

  let html = '<p>No tweets found</p>';
  if (state.feed.showFollowingOnly) {
    html += '<p class="bangit-feed-empty-sub">From users you follow</p>';
  }
  empty.innerHTML = html;

  feedContent.appendChild(empty);
}

/**
 * Show error state
 * @param {string} message - Error message
 */
function showError(message) {
  const feedContent = getFeedContent();
  if (!feedContent) return;

  const existingErrors = feedContent.querySelectorAll('.bangit-feed-error');
  existingErrors.forEach((el) => el.remove());

  const error = document.createElement('div');
  error.className = 'bangit-feed-error';
  error.innerHTML = `
    <p>Something went wrong</p>
    <p class="bangit-feed-error-sub">${escapeHtml(message)}</p>
  `;
  feedContent.appendChild(error);
}

/**
 * Load feed data from API
 * @param {string|null} cursor - Opaque pagination cursor from backend
 */
export async function loadFeed(cursor = null) {
  const state = getState();

  // Prevent duplicate loading
  if (state.feed.loading) {
    console.log('[Bangit] Feed already loading, skipping');
    return;
  }

  updateState('feed', { loading: true });
  showLoading();

  try {
    const { sortType, topPeriod, showFollowingOnly } = state.feed;
    const period = sortType === 'top' ? topPeriod : null;
    const response = await fetchFeed(sortType, cursor, DEFAULT_PAGE_SIZE, showFollowingOnly, period);

    hideLoading();

    if (!response.success) {
      const errorMessage = response.code
        ? `${response.error || 'Failed to load feed'} (code: ${response.code})`
        : (response.error || 'Failed to load feed');
      console.error('[Bangit] Feed fetch failed:', errorMessage);
      showError(errorMessage);
      if (cursor) {
        updateState('feed', { hasMore: false, cursor: null });
      }
      return;
    }

    const { tweets, hasMore, nextCursor } = response.data;

    if (!cursor && tweets.length === 0) {
      showEmptyState();
      updateState('feed', { hasMore: false });
      return;
    }

    renderTweets(tweets);

    updateState('feed', {
      cursor: nextCursor,
      hasMore,
      tweetIds: [...state.feed.tweetIds, ...tweets.map((t) => t.tweetId)],
    });

    console.log(`[Bangit] Loaded ${tweets.length} tweets, hasMore: ${hasMore}`);
  } catch (error) {
    console.error('[Bangit] Error loading feed:', error);
    hideLoading();
    const errorMessage = error?.message || 'Unknown error';
    showError(errorMessage);
    if (cursor) {
      updateState('feed', { hasMore: false, cursor: null });
    }
  } finally {
    updateState('feed', { loading: false });
  }
}

/**
 * Setup infinite scroll observer
 */
function setupInfiniteScroll() {
  if (infiniteScrollObserver) return;
  const sentinel = document.getElementById(LOAD_MORE_SENTINEL_ID);
  if (!sentinel) {
    console.warn('[Bangit] Load more sentinel not found');
    return;
  }

  infiniteScrollObserver = new IntersectionObserver(
    (entries) => {
      const state = getState();
      if (entries[0].isIntersecting && !state.feed.loading && state.feed.hasMore) {
        console.log('[Bangit] Loading more tweets...');
        loadFeed(state.feed.cursor);
      }
    },
    { rootMargin: '200px' }
  );

  infiniteScrollObserver.observe(sentinel);
}

/**
 * Disconnect infinite scroll observer
 */
function disconnectInfiniteScroll() {
  if (infiniteScrollObserver) {
    infiniteScrollObserver.disconnect();
    infiniteScrollObserver = null;
  }
}

/**
 * Activate the Bangit feed (show custom feed, hide native)
 */
export async function activateFeed() {
  const state = getState();

  if (state.feed.active) {
    console.log('[Bangit] Feed already active');
    return;
  }

  console.log('[Bangit] Activating Bangit feed...');

  // Load saved preferences before creating feed container
  await loadFeedPreferences();

  // Add active mode class to body for CSS targeting (hides native tab underlines)
  document.body.classList.add('bangit-feed-active-mode');

  // Prepare parent container for overlay positioning
  // Note: We no longer hide the native timeline - Bangit overlays on top
  // This prevents Twitter from detecting visibility changes and refreshing
  prepareTimelineParentForOverlay();
  // COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
  // hideNewPostsButton();
  // setupNewPostsObserver();

  // Check if feed container already exists (may be hidden from previous deactivation)
  let feedContainer = document.getElementById(FEED_CONTAINER_ID);
  if (feedContainer) {
    // Re-show existing container (fast path - no reload needed)
    feedContainer.style.display = '';
    console.log('[Bangit] Re-showing existing feed container');
  } else {
    // Wait for the correct parent element (tweets section) to exist
    // This prevents the feed from covering the header on direct navigation
    const parent = findTimelineParent();
    if (!parent) {
      console.log('[Bangit] Timeline parent not ready, will retry');
      return;
    }

    // Create new container
    feedContainer = createFeedContainer();
    parent.appendChild(feedContainer);
  }

  updateState('feed', {
    active: true,
    container: feedContainer,
  });

  // Setup sticky header behavior
  setupStickyHeader();

  // Apply view state (feeds vs leaderboard)
  applyFeedView();

  // Subscribe to feed room for real-time score updates
  await subscribeToCurrentFeed();
}

/**
 * Deactivate the Bangit feed (hide custom feed, show native)
 * @param {boolean} clearHash - Whether to clear the URL hash (default: false to avoid triggering Twitter refresh)
 */
export function deactivateFeed(clearHash = false) {
  const state = getState();

  if (!state.feed.active) {
    console.log('[Bangit] Feed not active');
    return;
  }

  console.log('[Bangit] Deactivating Bangit feed...');

  // Remove active mode class from body
  document.body.classList.remove('bangit-feed-active-mode');

  // Disconnect observers (but keep feed container hidden for faster re-activation)
  disconnectInfiniteScroll();
  // COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
  // disconnectNewPostsObserver();
  disconnectStickyHeader();

  // Hide feed container instead of removing it (preserves state for quick re-show)
  const feedContainer = document.getElementById(FEED_CONTAINER_ID);
  if (feedContainer) {
    feedContainer.style.display = 'none';
  }

  // COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
  // Show new posts button (native timeline is never hidden with overlay approach)
  // showNewPostsButton();

  // Mark as inactive but preserve tweet data for quick re-activation
  updateState('feed', {
    active: false,
    // Keep container, tweetIds, cursor, hasMore for fast re-show
  });

  // Unsubscribe from feed room (no longer receiving updates when inactive)
  unsubscribeFromCurrentFeed();

  // Only clear hash when explicitly requested (e.g., cleanup, not tab switching)
  // Avoiding hash changes prevents Twitter from refreshing the native feed
  if (clearHash && window.location.hash === '#bangit') {
    history.pushState(null, '', window.location.pathname + window.location.search);
  }
}

/**
 * Clean up all feed resources (full cleanup, not just hide)
 */
export function cleanup() {
  // Remove active mode class from body
  document.body.classList.remove('bangit-feed-active-mode');

  // Unsubscribe from feed room
  unsubscribeFromCurrentFeed();

  disconnectInfiniteScroll();
  // COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
  // disconnectNewPostsObserver();
  disconnectStickyHeader();

  // Full cleanup: remove the container entirely
  const feedContainer = document.getElementById(FEED_CONTAINER_ID);
  if (feedContainer) {
    feedContainer.remove();
  }
  feedModeTabs = null;
  leaderboardUI = null;

  // COMMENTED OUT: Removed to avoid Chrome Web Store "DomBlockers" rejection
  // Show new posts button (native timeline is never hidden with overlay approach)
  // showNewPostsButton();

  // Reset all feed state
  updateState('feed', {
    active: false,
    container: null,
    originalTimeline: null,
    tweetIds: [],
    cursor: null,
    loading: false,
    hasMore: true,
  });

  // Clear URL hash on full cleanup
  if (window.location.hash === '#bangit') {
    history.pushState(null, '', window.location.pathname + window.location.search);
  }
}
