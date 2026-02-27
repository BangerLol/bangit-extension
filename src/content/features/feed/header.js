// Bangit - Feed Header Component
// Horizontal tabs for sort type selection and following checkbox

import { getState, updateState, isAuthenticated } from '../../core/state.js';

/**
 * Sort tab options configuration with emojis
 */
const SORT_TAB_OPTIONS = [
  { key: 'hot', label: 'Hot', emoji: '🔥' },
  { key: 'top', label: 'Top', emoji: '🏆' },
  { key: 'bump', label: 'Bump', emoji: '⬆️' },
  { key: 'new', label: 'New', emoji: '🕐' },
];

/**
 * Period options for Top sort
 */
const PERIOD_OPTIONS = ['8h', '24h', '3d', '7d', '30d'];

// Track active dropdown to close on outside click
let activeDropdown = null;

/**
 * Close any open dropdown
 */
function closeActiveDropdown() {
  if (activeDropdown) {
    activeDropdown.classList.remove('bangit-dropdown-open');
    activeDropdown = null;
  }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (activeDropdown && !activeDropdown.contains(e.target)) {
    closeActiveDropdown();
  }
});

/**
 * Create the feed header element
 * @param {Function} onFilterChange - Callback when any filter changes
 * @returns {HTMLElement}
 */
export function createFeedHeader(onFilterChange) {
  const state = getState();
  const header = document.createElement('div');
  header.className = 'bangit-feed-header';

  const controls = document.createElement('div');
  controls.className = 'bangit-feed-controls';

  // Create sort tabs with sliding indicator
  const sortTabs = createSortTabs(state.feed.sortType, (newSort) => {
    updateState('feed', { sortType: newSort });
    updateHeaderUI(header, onFilterChange);
    onFilterChange();
  });
  controls.appendChild(sortTabs);

  // Period dropdown (slides in/out based on sort type)
  const periodDropdown = createPeriodDropdown(state.feed.topPeriod, (newPeriod) => {
    updateState('feed', { topPeriod: newPeriod });
    onFilterChange();
  });
  // Set initial visibility state
  periodDropdown.classList.add(state.feed.sortType === 'top' ? 'bangit-period-visible' : 'bangit-period-hidden');
  controls.appendChild(periodDropdown);

  // Following checkbox (only if authenticated)
  if (isAuthenticated()) {
    const followingCheckbox = createFollowingCheckbox(state.feed.showFollowingOnly, (newValue) => {
      updateState('feed', { showFollowingOnly: newValue });
      onFilterChange();
    });
    controls.appendChild(followingCheckbox);
  }

  header.appendChild(controls);

  return header;
}

/**
 * Update the header UI when state changes
 * @param {HTMLElement} header - The header element
 * @param {Function} onFilterChange - Filter change callback
 */
function updateHeaderUI(header, onFilterChange) {
  const state = getState();
  const controls = header.querySelector('.bangit-feed-controls');

  // Update tab indicator position
  const sortTabs = controls.querySelector('.bangit-sort-tabs');
  if (sortTabs) {
    const tabIndex = SORT_TAB_OPTIONS.findIndex(opt => opt.key === state.feed.sortType);
    sortTabs.style.setProperty('--tab-index', tabIndex);

    // Update active tab styling
    const buttons = sortTabs.querySelectorAll('.bangit-tab-button');
    buttons.forEach((btn, idx) => {
      btn.classList.toggle('bangit-tab-active', idx === tabIndex);
      btn.setAttribute('aria-checked', idx === tabIndex ? 'true' : 'false');
    });
  }

  // Animate period dropdown visibility
  const periodDropdown = controls.querySelector('.bangit-period-dropdown');
  if (periodDropdown) {
    const isTop = state.feed.sortType === 'top';
    periodDropdown.classList.toggle('bangit-period-visible', isTop);
    periodDropdown.classList.toggle('bangit-period-hidden', !isTop);
  }

  // Update following checkbox visibility
  const existingCheckbox = controls.querySelector('.bangit-following-checkbox');
  if (isAuthenticated() && !existingCheckbox) {
    const followingCheckbox = createFollowingCheckbox(state.feed.showFollowingOnly, (newValue) => {
      updateState('feed', { showFollowingOnly: newValue });
      onFilterChange();
    });
    controls.appendChild(followingCheckbox);
  } else if (!isAuthenticated() && existingCheckbox) {
    existingCheckbox.remove();
  }
}

/**
 * Create horizontal sort tabs with sliding indicator
 * @param {string} selectedSort - Currently selected sort
 * @param {Function} onChange - Callback when selection changes
 * @returns {HTMLElement}
 */
function createSortTabs(selectedSort, onChange) {
  const container = document.createElement('div');
  container.className = 'bangit-sort-tabs';
  container.setAttribute('role', 'radiogroup');
  container.setAttribute('aria-label', 'Sort options');

  // Calculate initial tab index
  const initialIndex = SORT_TAB_OPTIONS.findIndex(opt => opt.key === selectedSort);
  container.style.setProperty('--tab-index', initialIndex >= 0 ? initialIndex : 0);

  // Sliding indicator background
  const indicator = document.createElement('div');
  indicator.className = 'bangit-tab-indicator';
  container.appendChild(indicator);

  // Create tab buttons
  SORT_TAB_OPTIONS.forEach((option, index) => {
    const button = document.createElement('button');
    button.className = 'bangit-tab-button';
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', option.key === selectedSort ? 'true' : 'false');
    button.dataset.sort = option.key;

    if (option.key === selectedSort) {
      button.classList.add('bangit-tab-active');
    }

    // Emoji span
    const emoji = document.createElement('span');
    emoji.className = 'bangit-tab-emoji';
    emoji.textContent = option.emoji;
    button.appendChild(emoji);

    // Label span
    const label = document.createElement('span');
    label.className = 'bangit-tab-label';
    label.textContent = option.label;
    button.appendChild(label);

    button.addEventListener('click', () => {
      const currentSort = getState().feed.sortType;
      if (option.key !== currentSort) {
        // Update indicator position
        container.style.setProperty('--tab-index', index);

        // Update active state
        container.querySelectorAll('.bangit-tab-button').forEach((btn, idx) => {
          btn.classList.toggle('bangit-tab-active', idx === index);
          btn.setAttribute('aria-checked', idx === index ? 'true' : 'false');
        });

        onChange(option.key);
      }
    });

    container.appendChild(button);
  });

  return container;
}

/**
 * Create period dropdown for Top sort
 * @param {string} selectedPeriod - Currently selected period
 * @param {Function} onChange - Callback when selection changes
 * @returns {HTMLElement}
 */
function createPeriodDropdown(selectedPeriod, onChange) {
  const dropdown = document.createElement('div');
  dropdown.className = 'bangit-dropdown bangit-period-dropdown';

  // Trigger button - shows selected period with chevron
  const trigger = document.createElement('button');
  trigger.className = 'bangit-dropdown-trigger';
  trigger.type = 'button';

  const label = document.createElement('span');
  label.className = 'bangit-dropdown-label';
  label.textContent = selectedPeriod;

  // Chevron down icon (shown when collapsed)
  const chevronDown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronDown.setAttribute('class', 'bangit-dropdown-chevron bangit-chevron-down');
  chevronDown.setAttribute('width', '16');
  chevronDown.setAttribute('height', '16');
  chevronDown.setAttribute('viewBox', '0 0 24 24');
  chevronDown.setAttribute('fill', 'none');
  chevronDown.setAttribute('stroke', 'currentColor');
  chevronDown.setAttribute('stroke-width', '2');
  chevronDown.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

  // Chevron up icon (shown when expanded)
  const chevronUp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronUp.setAttribute('class', 'bangit-dropdown-chevron bangit-chevron-up');
  chevronUp.setAttribute('width', '16');
  chevronUp.setAttribute('height', '16');
  chevronUp.setAttribute('viewBox', '0 0 24 24');
  chevronUp.setAttribute('fill', 'none');
  chevronUp.setAttribute('stroke', 'currentColor');
  chevronUp.setAttribute('stroke-width', '2');
  chevronUp.innerHTML = '<polyline points="6 15 12 9 18 15"></polyline>';

  trigger.appendChild(label);
  trigger.appendChild(chevronDown);
  trigger.appendChild(chevronUp);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('bangit-dropdown-open');
    closeActiveDropdown();
    if (!isOpen) {
      dropdown.classList.add('bangit-dropdown-open');
      activeDropdown = dropdown;
    }
  });

  // Content/menu - expands downward
  const content = document.createElement('div');
  content.className = 'bangit-dropdown-content';

  PERIOD_OPTIONS.forEach(period => {
    const item = document.createElement('button');
    item.className = 'bangit-dropdown-option';
    if (period === selectedPeriod) {
      item.classList.add('bangit-dropdown-option-selected');
    }
    item.type = 'button';

    const itemLabel = document.createElement('span');
    itemLabel.className = 'bangit-option-label';
    itemLabel.textContent = period;
    item.appendChild(itemLabel);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      const currentPeriod = getState().feed.topPeriod;
      if (period !== currentPeriod) {
        // Update the trigger label
        label.textContent = period;
        // Update selected state
        content.querySelectorAll('.bangit-dropdown-option').forEach(opt => {
          opt.classList.remove('bangit-dropdown-option-selected');
        });
        item.classList.add('bangit-dropdown-option-selected');
        onChange(period);
      }
    });

    content.appendChild(item);
  });

  dropdown.appendChild(trigger);
  dropdown.appendChild(content);

  return dropdown;
}

/**
 * Create following checkbox with checkmark
 * @param {boolean} isChecked - Current checkbox state
 * @param {Function} onChange - Callback when checkbox changes
 * @returns {HTMLElement}
 */
function createFollowingCheckbox(isChecked, onChange) {
  const label = document.createElement('label');
  label.className = 'bangit-following-checkbox';
  if (isChecked) {
    label.classList.add('bangit-checkbox-checked');
  }

  // Label text
  const labelText = document.createElement('span');
  labelText.className = 'bangit-checkbox-label';
  labelText.textContent = 'Following';
  label.appendChild(labelText);

  // Checkbox visual box
  const box = document.createElement('div');
  box.className = 'bangit-checkbox-box';

  // Checkmark SVG
  const checkmark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkmark.setAttribute('class', 'bangit-checkbox-check');
  checkmark.setAttribute('width', '14');
  checkmark.setAttribute('height', '14');
  checkmark.setAttribute('viewBox', '0 0 24 24');
  checkmark.setAttribute('fill', 'none');
  checkmark.setAttribute('stroke', 'currentColor');
  checkmark.setAttribute('stroke-width', '3');
  checkmark.setAttribute('stroke-linecap', 'round');
  checkmark.setAttribute('stroke-linejoin', 'round');
  checkmark.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
  box.appendChild(checkmark);
  label.appendChild(box);

  // Hidden actual checkbox
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = isChecked;
  input.hidden = true;
  label.appendChild(input);

  // Click handler
  label.addEventListener('click', (e) => {
    e.preventDefault();
    const newValue = !input.checked;
    input.checked = newValue;
    label.classList.toggle('bangit-checkbox-checked', newValue);
    onChange(newValue);
  });

  return label;
}

/**
 * Load feed preferences from chrome.storage.local
 * @returns {Promise<{sortType?: string, topPeriod?: string, showFollowingOnly?: boolean}>}
 */
export async function loadFeedPreferences() {
  try {
    const result = await chrome.storage.local.get('feedPreferences');
    if (result.feedPreferences) {
      updateState('feed', result.feedPreferences);
      return result.feedPreferences;
    }
  } catch (error) {
    console.error('[Bangit] Error loading feed preferences:', error);
  }
  return {};
}

/**
 * Save feed preferences to chrome.storage.local
 */
export async function saveFeedPreferences() {
  try {
    const { sortType, topPeriod, showFollowingOnly } = getState().feed;
    await chrome.storage.local.set({
      feedPreferences: { sortType, topPeriod, showFollowingOnly }
    });
  } catch (error) {
    console.error('[Bangit] Error saving feed preferences:', error);
  }
}
