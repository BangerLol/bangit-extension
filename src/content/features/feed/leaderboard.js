// Bangit - Leaderboard view for the Bangit feed tab

import { getState, updateState } from '../../core/state.js';
import { getLeaderboard as fetchLeaderboardRpc } from '../../core/rpc.js';

const LEADERBOARD_LIMIT = 50;

const LEADERBOARD_TYPES = [
  { key: 'curators', label: 'Curators' },
  { key: 'creators', label: 'Creators' },
];

const LEADERBOARD_PERIODS = ['24h', '3d', '7d', '30d', 'All'];

const COLUMN_TOOLTIPS = {
  motion: 'Vision × Conviction × Power\nprimary score for rewards/slashing\n≈ $ PnL',
  taste: 'Vision × Conviction\nwins scaled by confidence\n≈ % PnL',
  streak: 'Vote streak\ndays',
};

let ui = null;
let activeRequestId = 0;

function getLeaderboardState() {
  return getState().feed.leaderboard;
}

function updateLeaderboardState(partial) {
  const state = getState();
  updateState('feed', {
    leaderboard: {
      ...state.feed.leaderboard,
      ...partial,
    },
  });
}

function formatReward(amount) {
  const displayAmount = (amount || 0) / (10 ** 9);
  if (displayAmount >= 1000000) {
    return `${(displayAmount / 1000000).toFixed(1)}M`;
  }
  if (displayAmount >= 1000) {
    return `${(displayAmount / 1000).toFixed(1)}K`;
  }
  return displayAmount.toFixed(0);
}

function formatCurationScore(score) {
  const value = score || 0;
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(1);
}

function truncateName(name, maxLen = 7) {
  if (!name) return '';
  return name.length > maxLen ? `${name.slice(0, maxLen - 2)}...` : name;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map(part => part.charAt(0)).join('');
  return initials.toUpperCase() || '?';
}

function createArrowIcon(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('bangit-leaderboard-arrow');

  if (direction === 'up') {
    svg.innerHTML = '<polyline points="6 15 12 9 18 15"></polyline>';
  } else {
    svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
  }

  return svg;
}

async function fetchLeaderboard(type, period, privyId) {
  const response = await fetchLeaderboardRpc(type, period, privyId);
  if (!response.success) {
    throw new Error(response.error || `Failed to fetch ${type} leaderboard`);
  }
  return {
    leaderboard: response.data?.leaderboard || [],
    currentUser: response.data?.currentUser || null,
  };
}

function createTabs(items, onChange) {
  const container = document.createElement('div');
  container.className = 'bangit-leaderboard-tabs';
  container.setAttribute('role', 'tablist');
  container.style.setProperty('--tab-count', items.length);

  const indicator = document.createElement('div');
  indicator.className = 'bangit-leaderboard-tab-indicator';
  container.appendChild(indicator);

  const buttons = items.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bangit-leaderboard-tab-button';
    button.dataset.value = item.key || item;
    button.textContent = item.label || item;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => onChange(item.key || item, index));
    container.appendChild(button);
    return button;
  });

  return { container, indicator, buttons };
}

function updateTabsUI(tabButtons, indicator, selectedValue, items) {
  const selectedIndex = items.findIndex(item => (item.key || item) === selectedValue);
  indicator.style.setProperty('--tab-index', selectedIndex >= 0 ? selectedIndex : 0);

  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.value === selectedValue;
    btn.classList.toggle('bangit-leaderboard-tab-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function createLeaderboardHeader() {
  const header = document.createElement('div');
  header.className = 'bangit-leaderboard-header';

  const typeTabs = createTabs(LEADERBOARD_TYPES, (type) => {
    const state = getLeaderboardState();
    if (type === state.selectedType) return;

    updateLeaderboardState({
      selectedType: type,
    });
    updateTabsUI(ui.typeTabs.buttons, ui.typeTabs.indicator, type, LEADERBOARD_TYPES);
    ensureLeaderboardData({ force: true });
  });

  const periodTabs = createTabs(LEADERBOARD_PERIODS, (period) => {
    const state = getLeaderboardState();
    if (period === state.selectedPeriod) return;

    updateLeaderboardState({
      selectedPeriod: period,
    });
    updateTabsUI(ui.periodTabs.buttons, ui.periodTabs.indicator, period, LEADERBOARD_PERIODS);
    ensureLeaderboardData({ force: true });
  });

  header.appendChild(typeTabs.container);
  header.appendChild(periodTabs.container);

  return { header, typeTabs, periodTabs };
}

function createTableHeaderColumn(label, className) {
  const col = document.createElement('div');
  col.className = `bangit-leaderboard-col ${className}`;

  const span = document.createElement('span');
  span.textContent = label;
  span.className = 'bangit-leaderboard-col-label';
  col.appendChild(span);

  return col;
}

function createSortHeader(label, field) {
  const col = document.createElement('div');
  col.className = `bangit-leaderboard-col bangit-leaderboard-col-sort bangit-leaderboard-col-${field}`;

  const tooltip = document.createElement('span');
  tooltip.className = 'bangit-leaderboard-tooltip';
  tooltip.dataset.tooltip = COLUMN_TOOLTIPS[field] || '';
  col.appendChild(tooltip);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bangit-leaderboard-sort-button';
  button.textContent = label;
  button.addEventListener('click', () => handleSort(field));

  const indicator = document.createElement('span');
  indicator.className = 'bangit-leaderboard-sort-indicator';
  button.appendChild(indicator);

  col.appendChild(button);

  return col;
}

function renderTableHeader() {
  if (!ui?.tableHeader) return;

  const state = getLeaderboardState();
  const displayType = state.displayType || state.selectedType;
  const hasRows = Array.isArray(state.data) && state.data.length > 0;

  ui.tableHeader.style.display = hasRows ? 'flex' : 'none';

  ui.tableHeader.innerHTML = '';
  ui.tableHeader.appendChild(createTableHeaderColumn('Rank', 'bangit-leaderboard-col-rank'));
  ui.tableHeader.appendChild(createTableHeaderColumn('User', 'bangit-leaderboard-col-user'));

  if (displayType === 'curators') {
    ui.tableHeader.appendChild(createSortHeader('Motion', 'motion'));
    ui.tableHeader.appendChild(createSortHeader('Taste', 'taste'));
    ui.tableHeader.appendChild(createSortHeader('Streak', 'streak'));
  } else {
    ui.tableHeader.appendChild(createTableHeaderColumn('Rewards', 'bangit-leaderboard-col-rewards'));
  }

  updateSortIndicators();
}

function updateSortIndicators() {
  if (!ui?.tableHeader) return;

  const state = getLeaderboardState();
  const indicators = ui.tableHeader.querySelectorAll('.bangit-leaderboard-sort-indicator');
  indicators.forEach((indicator) => {
    indicator.innerHTML = '';
  });

  const activeButton = ui.tableHeader.querySelector(`.bangit-leaderboard-col-${state.sortField} .bangit-leaderboard-sort-button`);
  if (!activeButton) return;

  const indicator = activeButton.querySelector('.bangit-leaderboard-sort-indicator');
  if (!indicator) return;

  const icon = createArrowIcon(state.sortDirection === 'desc' ? 'down' : 'up');
  indicator.appendChild(icon);
}

function handleSort(field) {
  const state = getLeaderboardState();
  if ((state.displayType || state.selectedType) !== 'curators') return;

  let direction = state.sortDirection;
  if (state.sortField === field) {
    direction = direction === 'desc' ? 'asc' : 'desc';
  } else {
    direction = 'desc';
  }

  updateLeaderboardState({
    sortField: field,
    sortDirection: direction,
  });

  renderTableHeader();
  renderLeaderboardRows();
}

function createAvatar(user) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bangit-leaderboard-avatar-wrap';

  const img = document.createElement('img');
  img.className = 'bangit-leaderboard-avatar';
  img.src = user.twitterAvatarUrl || '';
  img.alt = `${user.twitterName || 'User'} avatar`;

  const fallback = document.createElement('span');
  fallback.className = 'bangit-leaderboard-avatar-fallback';
  fallback.textContent = getInitials(user.twitterName);
  fallback.style.display = 'none';

  img.addEventListener('error', () => {
    img.style.display = 'none';
    fallback.style.display = 'flex';
  });

  wrapper.appendChild(img);
  wrapper.appendChild(fallback);
  return wrapper;
}

function createTrendingIndicator(trending) {
  if (trending === null || trending === undefined || trending === 0) {
    return null;
  }

  const indicator = document.createElement('span');
  indicator.className = 'bangit-leaderboard-trending';

  if (trending > 0) {
    indicator.classList.add('bangit-trending-up');
    indicator.appendChild(createArrowIcon('up'));
    indicator.appendChild(document.createTextNode(String(trending)));
  } else {
    indicator.classList.add('bangit-trending-down');
    indicator.appendChild(createArrowIcon('down'));
    indicator.appendChild(document.createTextNode(String(Math.abs(trending))));
  }

  return indicator;
}

function createRow(user, displayType, isCurrent, isPinned) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'bangit-leaderboard-row';

  if (isCurrent) {
    row.classList.add('bangit-leaderboard-row-current');
  }
  if (isPinned) {
    row.classList.add('bangit-leaderboard-row-pinned');
  }

  if (user.twitterUsername) {
    row.addEventListener('click', () => {
      window.open(`https://x.com/${user.twitterUsername}`, '_blank');
    });
  }

  const rankCol = document.createElement('div');
  rankCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-rank';

  const rankWrap = document.createElement('div');
  rankWrap.className = 'bangit-leaderboard-rank';

  const trendingIndicator = createTrendingIndicator(user.trending);
  if (trendingIndicator) {
    rankWrap.appendChild(trendingIndicator);
  }

  const rankValue = document.createElement('span');
  rankValue.textContent = user.rank ?? '-';
  rankWrap.appendChild(rankValue);

  rankCol.appendChild(rankWrap);
  row.appendChild(rankCol);

  const userCol = document.createElement('div');
  userCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-user';

  const avatar = createAvatar(user);
  userCol.appendChild(avatar);

  const userText = document.createElement('div');
  userText.className = 'bangit-leaderboard-user';

  const name = document.createElement('div');
  name.className = 'bangit-leaderboard-name';
  name.textContent = truncateName(user.twitterName || 'Unknown');
  userText.appendChild(name);

  const handle = document.createElement('div');
  handle.className = 'bangit-leaderboard-handle';
  handle.textContent = `@${truncateName(user.twitterUsername || 'unknown')}`;
  userText.appendChild(handle);

  userCol.appendChild(userText);
  row.appendChild(userCol);

  if (displayType === 'curators') {
    const motionCol = document.createElement('div');
    motionCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-motion';
    motionCol.textContent = formatCurationScore(user.motion || 0);
    row.appendChild(motionCol);

    const tasteCol = document.createElement('div');
    tasteCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-taste';
    tasteCol.textContent = formatCurationScore(user.taste || 0);
    row.appendChild(tasteCol);

    const streakCol = document.createElement('div');
    streakCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-streak';

    const streakValue = document.createElement('span');
    streakValue.textContent = `${user.upvoteStreak ?? 0}`;
    streakCol.appendChild(streakValue);

    const flame = document.createElement('span');
    flame.textContent = '🔥';
    flame.className = 'bangit-leaderboard-flame';
    streakCol.appendChild(flame);

    row.appendChild(streakCol);
  } else {
    const rewardsCol = document.createElement('div');
    rewardsCol.className = 'bangit-leaderboard-col bangit-leaderboard-col-rewards';
    rewardsCol.textContent = formatReward(user.totalCreatorRewards || 0);
    row.appendChild(rewardsCol);
  }

  return row;
}

function renderLeaderboardRows() {
  if (!ui?.list) return;

  const state = getLeaderboardState();
  const displayType = state.displayType || state.selectedType;
  const data = Array.isArray(state.data) ? state.data : [];
  const currentUser = state.currentUser;

  ui.list.innerHTML = '';

  if (state.error && !state.loading && !state.refreshing) {
    ui.list.appendChild(createErrorState(`Failed to load ${state.selectedType}.`));
    return;
  }

  if (!data.length && !state.loading && !state.refreshing) {
    ui.list.appendChild(createEmptyState(`No ${state.selectedType} found yet.`));
    return;
  }

  let rowsData = data;
  if (displayType === 'curators') {
    const field = state.sortField;
    const direction = state.sortDirection;
    rowsData = [...data].sort((a, b) => {
      let aVal = 0;
      let bVal = 0;
      if (field === 'motion') {
        aVal = a.motion || 0;
        bVal = b.motion || 0;
      } else if (field === 'taste') {
        aVal = a.taste || 0;
        bVal = b.taste || 0;
      } else {
        aVal = a.upvoteStreak ?? 0;
        bVal = b.upvoteStreak ?? 0;
      }
      return direction === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }

  const fragment = document.createDocumentFragment();

  if (currentUser) {
    const currentRow = createRow(currentUser, displayType, true, true);
    fragment.appendChild(currentRow);
  }

  rowsData.forEach((user) => {
    const isCurrent = currentUser && user.twitterId === currentUser.twitterId;
    fragment.appendChild(createRow(user, displayType, isCurrent, false));
  });

  ui.list.appendChild(fragment);
}

function createEmptyState(message) {
  const empty = document.createElement('div');
  empty.className = 'bangit-leaderboard-empty';

  const title = document.createElement('div');
  title.className = 'bangit-leaderboard-empty-title';
  title.textContent = message;

  const subtitle = document.createElement('div');
  subtitle.className = 'bangit-leaderboard-empty-subtitle';
  subtitle.textContent = 'Be the first to earn rewards!';

  empty.appendChild(title);
  empty.appendChild(subtitle);

  return empty;
}

function createErrorState(message) {
  const empty = document.createElement('div');
  empty.className = 'bangit-leaderboard-empty';

  const title = document.createElement('div');
  title.className = 'bangit-leaderboard-empty-title';
  title.textContent = message;

  const subtitle = document.createElement('div');
  subtitle.className = 'bangit-leaderboard-empty-subtitle';
  subtitle.textContent = 'Please try again.';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'bangit-leaderboard-retry';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => ensureLeaderboardData({ force: true }));

  empty.appendChild(title);
  empty.appendChild(subtitle);
  empty.appendChild(retry);

  return empty;
}

function updateLoadingUI() {
  if (!ui?.loadingOverlay) return;

  const state = getLeaderboardState();
  const isLoading = state.loading || state.refreshing;

  ui.loadingOverlay.style.display = isLoading ? 'flex' : 'none';
  ui.list.classList.toggle('bangit-leaderboard-dim', state.refreshing);
}

export function syncLeaderboardUI() {
  if (!ui) return;

  const state = getLeaderboardState();
  updateTabsUI(ui.typeTabs.buttons, ui.typeTabs.indicator, state.selectedType, LEADERBOARD_TYPES);
  updateTabsUI(ui.periodTabs.buttons, ui.periodTabs.indicator, state.selectedPeriod, LEADERBOARD_PERIODS);
  renderTableHeader();
  renderLeaderboardRows();
  updateLoadingUI();
}

export function createLeaderboardUI() {
  if (ui) {
    syncLeaderboardUI();
    return ui;
  }

  const headerData = createLeaderboardHeader();
  const container = document.createElement('div');
  container.className = 'bangit-leaderboard';

  const tableHeader = document.createElement('div');
  tableHeader.className = 'bangit-leaderboard-table-header';

  const list = document.createElement('div');
  list.className = 'bangit-leaderboard-list';

  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'bangit-leaderboard-loading';
  loadingOverlay.innerHTML = '<div class="bangit-feed-spinner"></div><div class="bangit-leaderboard-loading-text">Loading...</div>';

  container.appendChild(tableHeader);
  container.appendChild(list);
  container.appendChild(loadingOverlay);

  ui = {
    header: headerData.header,
    typeTabs: headerData.typeTabs,
    periodTabs: headerData.periodTabs,
    container,
    tableHeader,
    list,
    loadingOverlay,
  };

  syncLeaderboardUI();
  return ui;
}

export function setLeaderboardVisible(isVisible) {
  if (!ui) return;
  ui.header.style.display = isVisible ? '' : 'none';
  ui.container.style.display = isVisible ? '' : 'none';
}

export async function ensureLeaderboardData({ force = false } = {}) {
  const state = getLeaderboardState();
  const key = `${state.selectedType}-${state.selectedPeriod}`;

  if (!force && state.lastLoadedKey === key && state.data.length) {
    syncLeaderboardUI();
    return;
  }

  const hasData = state.data.length > 0;
  updateLeaderboardState({
    loading: !hasData,
    refreshing: hasData,
    error: null,
  });
  updateLoadingUI();

  const requestId = ++activeRequestId;
  try {
    const privyId = getState().auth.currentUser?.privyId || null;
    const result = await fetchLeaderboard(state.selectedType, state.selectedPeriod, privyId);
    if (requestId !== activeRequestId) return;

    updateLeaderboardState({
      data: result.leaderboard,
      currentUser: result.currentUser,
      displayType: state.selectedType,
      sortField: 'motion',
      sortDirection: 'desc',
      lastLoadedKey: key,
      loading: false,
      refreshing: false,
      error: null,
    });
  } catch (error) {
    if (requestId !== activeRequestId) return;
    updateLeaderboardState({
      loading: false,
      refreshing: false,
      error: error?.message || 'Failed to load leaderboard',
    });
  }

  syncLeaderboardUI();
}
