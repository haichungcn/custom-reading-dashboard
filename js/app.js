/**
 * Calm Morning Gateway — Main Gateway Controller (`js/app.js`)
 *
 * Powers both the Chrome MV3 New Tab (`index.html`) and the iOS/iPadOS PWA.
 * Enforces strict MV3 CSP, safe DOM element creation, async/await only,
 * and target="_blank" rel="noopener noreferrer" on all external links.
 */

import {
  DEFAULT_RSS_SOURCES,
  SLACK_COLLAPSED_LIMIT,
  WIDGET_ZONES,
  addBookmark,
  addCustomBackgroundImage,
  addHabitItem,
  addLaunchpadLink,
  addObjective,
  addRssSource,
  addSlackItem,
  addTodo,
  addWidgetToLayout,
  addWorldClock,
  applyRssPresetPack,
  applyStarterPreset,
  clearCompletedTodos,
  dismissRssArticle,
  exportCleanStateJson,
  exportRssSourcesOpml,
  extractDomain,
  getActiveWidgetIds,
  getStateSnapshot,
  getVisibleSlackDigestSlice,
  importFullStateJson,
  importRssSourcesOpml,
  isWidgetActive,
  loadState,
  moveWidgetInLayout,
  nudgeWidgetInLayout,
  parseRssSourcesOpmlOrJson,
  promoteBookmarkToTodo,
  promoteSlackToBookmark,
  promoteSlackToTodo,
  removeBookmark,
  removeCustomBackgroundImage,
  removeHabitItem,
  removeLaunchpadLink,
  removeObjective,
  removeRssSource,
  removeSlackItem,
  removeTodo,
  removeWidgetFromLayout,
  removeWorldClock,
  resetDashboardLayout,
  rolloverDay,
  sanitizeHttpUrl,
  saveSyncCredentials,
  setLayoutEditMode,
  shuffleDailyBackground,
  subscribe,
  syncFromLocalBundle,
  toggleBookmarkPin,
  toggleHabitForDate,
  toggleObjective,
  toggleRssSource,
  toggleTodo,
  updateBackgroundSettings,
  updateBookmark,
  updateBookmarkStatus,
  updateDigestConfig,
  updateObjective,
  updatePomodoroSettings,
  updatePreferences,
  updateScratchpad,
  updateSlackItem,
  updateTodo,
  updateWeatherCache,
  updateWeatherSettings
} from './store.js';

import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_PACK,
  buildSceneSvgMarkup,
  encodeSvgDataUri,
  resolveActiveBackground
} from './backgrounds.js';

import {
  POPULAR_WEATHER_CITIES,
  PRESET_TIMEZONES,
  WIDGET_CATALOG,
  buildFallbackWeatherSnapshot,
  describeWmoWeather,
  fetchWeatherForecast,
  formatTemp,
  formatWorldClockEntry,
  searchWeatherLocations
} from './widgets.js';

import { syncWithGist } from './gist-sync.js';
import { getCuratedFallbackArticles, refreshRssFeeds } from './rss-engine.js';
import {
  computeCircadianMood,
  getActiveWellnessPrompt,
  getBreathingPhaseAtElapsedMs,
  getGreetingData,
  recordBreakTaken
} from './wellness.js';

const MOOD_CYCLE = ['auto', 'morning', 'deep-work', 'evening'];
const SCHEME_CYCLE = ['auto', 'light', 'dark'];
const BREATHING_DURATION_MS = 60000;
const ZONE_LABELS = {
  top: '⤢ Top',
  left: '← Left',
  right: '→ Right',
  bottom: '⤢ Bottom'
};

let currentState = null;
let activeBookmarkFilter = 'all';
let activeRssSourceId = 'all';
let activeWidgetStoreFilter = 'all';
let activeMobileTab = 'focus';
let isEditingFocusTheme = false;
let breathingIntervalId = null;
let breathingStartMs = 0;
let breathingAutoLogged = false;
let cmdResults = [];
let cmdActiveIndex = 0;
let activeContextTarget = null; // { kind: 'objective'|'todo'|'slack'|'bookmark'|'rss', id?: string, article?: any }
let isEditingContextModal = false;

// Pomodoro runtime state
let pomoMode = 'focus'; // 'focus' | 'break'
let pomoDurationSec = 25 * 60;
let pomoRemainingSec = 25 * 60;
let pomoRunning = false;
let pomoIntervalId = null;

// Scratchpad debounce timer
let scratchpadSaveTimer = null;

// Drag-and-Drop & Keyboard Grab state
let dragSession = null;
let keyboardGrabbedWidgetId = null;
let lastAppliedBgUri = '';
let onboardingPendingWeather = null;

/**
 * Map a source name / category to an AI-lab visual accent hook.
 * @param {string} text
 * @returns {string}
 */
function detectLabAccent(text) {
  const lower = (text || '').toLowerCase();
  if (lower.includes('antigravity')) return 'antigravity';
  if (lower.includes('gemini') || lower.includes('deepmind')) return 'gemini';
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
  if (lower.includes('openai') || lower.includes('chatgpt') || lower.includes('codex')) return 'chatgpt';
  return '';
}

/**
 * Check if a click originated inside an interactive child control (link, button, input)
 * so row-level click-to-open-context does not hijack direct controls.
 * @param {Event} event
 * @param {HTMLElement} rowRoot
 * @returns {boolean}
 */
function isNestedInteractiveClick(event, rowRoot) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const interactive = target.closest('a, button, input, textarea, select, label');
  return Boolean(interactive && interactive !== rowRoot);
}

/**
 * Shortcut DOM lookup by ID.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Display a polite toast message inside the ARIA live toast region.
 * @param {string} message
 */
function showToast(message) {
  const region = byId('toast-region');
  if (!region || !message) return;

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  region.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

/**
 * Build a validated external link opening safely in a new tab.
 * Returns null when the URL fails sanitizeHttpUrl().
 * @param {string | null | undefined} rawUrl
 * @param {string} label
 * @param {string} [className]
 * @returns {HTMLAnchorElement | null}
 */
function createSafeLink(rawUrl, label, className = '') {
  const safeUrl = sanitizeHttpUrl(rawUrl, true);
  if (!safeUrl) return null;

  const anchor = document.createElement('a');
  anchor.href = safeUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (className) {
    anchor.className = className;
  }
  anchor.textContent = label;
  return anchor;
}

/**
 * Open a sanitized URL safely in a new browser tab/window.
 * @param {string | null | undefined} rawUrl
 */
function openSafeExternalUrl(rawUrl) {
  const safeUrl = sanitizeHttpUrl(rawUrl, true);
  if (!safeUrl) return;
  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Format a relative sync timestamp label (e.g. "2m ago").
 * @param {string | null} isoTimestamp
 * @returns {string}
 */
function formatRelativeTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  const ts = Date.parse(isoTimestamp);
  if (Number.isNaN(ts)) return '';
  const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

/**
 * Determine whether the app is running inside the Chrome MV3 Extension context.
 * @returns {boolean}
 */
function isExtensionContext() {
  return location.protocol === 'chrome-extension:' && typeof globalThis.chrome?.runtime?.sendMessage === 'function';
}

/**
 * Register the PWA service worker only outside chrome-extension: pages.
 */
async function registerPwaServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'chrome-extension:') {
    try {
      await navigator.serviceWorker.register('./sw-pwa.js');
    } catch {
      // Service worker unavailable or running from file://
    }
  }
}

/**
 * Switch the active mobile PWA bottom tab section.
 * @param {'focus' | 'digest' | 'queue' | 'feed'} tabName
 */
function setActiveMobileTab(tabName) {
  const valid = new Set(['focus', 'digest', 'queue', 'feed']);
  activeMobileTab = valid.has(tabName) ? tabName : 'focus';
  document.documentElement.setAttribute('data-active-tab', activeMobileTab);
  const shell = byId('gateway-shell');
  if (shell) {
    shell.setAttribute('data-active-tab', activeMobileTab);
  }
  const buttons = document.querySelectorAll('.mobile-tab-btn');
  for (const btn of buttons) {
    const isActive = btn.getAttribute('data-tab') === activeMobileTab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

/**
 * Render root document attributes (mood, colorScheme, focusMode) and top header.
 * @param {any} state
 */
function renderHeaderAndMood(state) {
  const now = new Date();
  const activeMood = computeCircadianMood(now, state.wellness?.moodOverride || 'auto');
  const colorScheme = state.wellness?.colorScheme || 'auto';
  const focusMode = Boolean(state.wellness?.focusMode);

  document.documentElement.setAttribute('data-view', 'newtab');
  document.documentElement.setAttribute('data-mood', activeMood);
  document.documentElement.setAttribute('data-theme', colorScheme);
  document.documentElement.setAttribute('data-focus', focusMode ? 'true' : 'false');

  const greetingData = getGreetingData(now, state.userName);
  const greetingEl = byId('header-greeting');
  const dateEl = byId('header-date');
  if (greetingEl) greetingEl.textContent = greetingData.greeting;
  if (dateEl) dateEl.textContent = greetingData.dateLabel;

  const themeDisplay = byId('focus-theme-display');
  const themeForm = byId('focus-theme-form');
  if (themeDisplay && themeForm) {
    themeDisplay.textContent = state.focusTheme || 'Clarity over volume.';
    themeDisplay.hidden = isEditingFocusTheme;
    themeForm.hidden = !isEditingFocusTheme;
  }

  // Wellness Pill
  const prompt = getActiveWellnessPrompt(state.wellness, now);
  const pillText = byId('wellness-pill-text');
  const breaksCount = Number.isFinite(state.wellness?.breaksToday) ? state.wellness.breaksToday : 0;
  if (pillText) {
    const breakSuffix = breaksCount > 0 ? ` (${breaksCount} today)` : '';
    pillText.textContent = `${prompt.icon} ${prompt.title}: ${prompt.instruction}${breakSuffix}`;
  }

  // Controls
  const moodSelect = byId('mood-select');
  if (moodSelect) {
    moodSelect.value = state.wellness?.moodOverride || 'auto';
  }

  const themeBtn = byId('theme-toggle-btn');
  if (themeBtn) {
    if (colorScheme === 'light') {
      themeBtn.textContent = '☀️ Light';
    } else if (colorScheme === 'dark') {
      themeBtn.textContent = '🌙 Dark';
    } else {
      themeBtn.textContent = '🌓 Auto';
    }
  }

  const focusBtn = byId('focus-mode-btn');
  if (focusBtn) {
    focusBtn.textContent = focusMode ? '🧘 Focus: ON' : '🧘 Focus: OFF';
    focusBtn.setAttribute('aria-pressed', String(focusMode));
  }

  const layoutEdit = Boolean(state.layout?.editMode);
  document.documentElement.setAttribute('data-layout-edit', layoutEdit ? 'true' : 'false');
  const layoutBtn = byId('layout-edit-btn');
  if (layoutBtn) {
    layoutBtn.textContent = layoutEdit ? '📐 Layout: ON' : '📐 Layout';
    layoutBtn.setAttribute('aria-pressed', String(layoutEdit));
  }
  const layoutBar = byId('layout-customize-bar');
  if (layoutBar) {
    layoutBar.hidden = !layoutEdit;
  }

  renderBackgroundLayer(state, now);

  const syncBtn = byId('sync-status-btn');
  if (syncBtn) {
    const status = state.sync?.lastSyncStatus || 'local-only';
    if (status === 'syncing') {
      syncBtn.textContent = '⏳ Syncing…';
    } else if (status === 'synced') {
      const ago = formatRelativeTime(state.sync?.lastSyncedAt);
      syncBtn.textContent = ago ? `☁️ Synced · ${ago}` : '☁️ Synced';
    } else if (status === 'error') {
      syncBtn.textContent = '⚠️ Sync Error';
    } else {
      syncBtn.textContent = state.sync?.githubPat ? '☁️ Sync Now' : '☁️ Local Ready';
    }
  }

  // Evening Wind-Down Anti-Overwork Guardian Banner
  const banner = byId('evening-guardian-banner');
  const bannerText = byId('evening-guardian-text');
  const isEvening = activeMood === 'evening';
  if (banner) {
    banner.hidden = !isEvening;
    banner.classList.toggle('is-visible', isEvening);
  }
  if (bannerText && isEvening) {
    const doneObjectives = (state.objectives || []).filter((item) => item.completed).length;
    const doneTodos = (state.todos || []).filter((item) => item.completed).length;
    const remainingTodos = (state.todos || []).filter((item) => !item.completed).length;
    bannerText.textContent =
      `You completed ${doneObjectives} objective${doneObjectives === 1 ? '' : 's'} and ` +
      `${doneTodos} TODO${doneTodos === 1 ? '' : 's'} today (${remainingTodos} remaining). ` +
      'Step away to stretch, hydrate, and recharge with zero guilt.';
  }
}

/**
 * Render Daily Objectives ("The Big 3").
 * @param {any} state
 */
function renderObjectives(state) {
  const listEl = byId('objective-list');
  const badgeEl = byId('objectives-badge');
  const hintEl = byId('objective-guardrail-hint');
  const inputEl = byId('objective-input');
  if (!listEl) return;

  const objectives = state.objectives || [];
  const activeCount = objectives.filter((obj) => !obj.completed).length;
  const doneCount = objectives.length - activeCount;

  if (badgeEl) {
    badgeEl.textContent = `${doneCount}/${objectives.length} · ${objectives.length} of 3`;
  }
  if (hintEl) {
    hintEl.hidden = objectives.length < 3;
  }
  if (inputEl) {
    inputEl.placeholder = objectives.length >= 3
      ? '+ Add Objective (3/3 set — keep focus light)...'
      : '+ Add Objective (Max 3, optional URL)...';
  }

  if (objectives.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Set up to 3 meaningful objectives for today. Clarity over volume.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  objectives.forEach((obj, index) => {
    const li = document.createElement('li');
    li.className = obj.completed
      ? 'objective-item is-completed is-interactive-row'
      : 'objective-item is-interactive-row';
    li.title = 'Click to view context, key takeaways & connected sources';
    li.addEventListener('click', (event) => {
      if (isNestedInteractiveClick(event, li)) return;
      openItemContextModal({ kind: 'objective', id: obj.id });
    });

    const circleBtn = document.createElement('button');
    circleBtn.type = 'button';
    circleBtn.className = 'objective-circle';
    circleBtn.textContent = obj.completed ? '✓' : String(index + 1);
    circleBtn.setAttribute('aria-label', obj.completed ? `Mark "${obj.title}" incomplete` : `Complete "${obj.title}"`);
    circleBtn.setAttribute('aria-pressed', String(obj.completed));
    circleBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleObjective(obj.id);
    });

    const content = document.createElement('div');
    content.className = 'objective-content';

    const titleEl = document.createElement('span');
    titleEl.className = 'objective-title';
    titleEl.tabIndex = 0;
    titleEl.title = 'Click to read context & sources · Double-click to quick-rename';
    titleEl.textContent = obj.title;
    titleEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openItemContextModal({ kind: 'objective', id: obj.id });
      }
    });

    content.appendChild(titleEl);

    if (obj.context) {
      const snippetEl = document.createElement('p');
      snippetEl.className = 'item-context-snippet';
      snippetEl.textContent = obj.context;
      content.appendChild(snippetEl);
    }

    const meta = document.createElement('div');
    meta.className = 'objective-meta';

    const primaryUrl = obj.url || obj.sources?.[0]?.url || null;
    if (primaryUrl) {
      const link = createSafeLink(
        primaryUrl,
        `↗ ${obj.urlLabel || extractDomain(primaryUrl) || 'Open Source'}`,
        'link-pill'
      );
      if (link) {
        meta.appendChild(link);
      }
    }

    const sourcesCount = Array.isArray(obj.sources) ? obj.sources.length : 0;
    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    ctxBtn.textContent = sourcesCount > 1 ? `📖 Context · ${sourcesCount} sources` : '📖 Context & Sources';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemContextModal({ kind: 'objective', id: obj.id });
    });
    meta.appendChild(ctxBtn);
    content.appendChild(meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove objective "${obj.title}"`);
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeObjective(obj.id);
      showToast('Objective removed');
    });

    li.append(circleBtn, content, removeBtn);
    fragment.appendChild(li);
  });

  listEl.replaceChildren(fragment);
}

/**
 * Render Tactical TODOs and completion progress strip.
 * @param {any} state
 */
function renderTodos(state) {
  const listEl = byId('todo-list');
  const badgeEl = byId('todos-badge');
  const progressLabel = byId('todos-progress-label');
  const progressFill = byId('todos-progress-fill');
  const clearBtn = byId('clear-completed-todos-btn');
  if (!listEl) return;

  const todos = state.todos || [];
  const total = todos.length;
  const completedCount = todos.filter((todo) => todo.completed).length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  if (badgeEl) badgeEl.textContent = `${pct}%`;
  if (progressLabel) progressLabel.textContent = `${completedCount} of ${total} completed · ${pct}%`;
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (clearBtn) clearBtn.disabled = completedCount === 0;

  if (todos.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No tactical TODOs yet. Add a task or paste a link + #tag below.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = todo.completed
      ? 'todo-item is-completed is-interactive-row'
      : 'todo-item is-interactive-row';
    li.title = 'Click to view context & sources';
    li.addEventListener('click', (event) => {
      if (isNestedInteractiveClick(event, li)) return;
      openItemContextModal({ kind: 'todo', id: todo.id });
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tactile-checkbox';
    checkbox.checked = Boolean(todo.completed);
    checkbox.setAttribute('aria-label', `Toggle TODO "${todo.text}"`);
    checkbox.addEventListener('change', async () => {
      await toggleTodo(todo.id);
    });

    const content = document.createElement('div');
    content.className = 'todo-content';

    const textEl = document.createElement('span');
    textEl.className = 'todo-text';
    textEl.textContent = todo.text;
    content.appendChild(textEl);

    if (todo.context) {
      const snippetEl = document.createElement('p');
      snippetEl.className = 'item-context-snippet';
      snippetEl.textContent = todo.context;
      content.appendChild(snippetEl);
    }

    const meta = document.createElement('div');
    meta.className = 'todo-meta';

    for (const tag of todo.tags || []) {
      const tagPill = document.createElement('span');
      tagPill.className = 'tag-pill';
      tagPill.textContent = `#${tag}`;
      meta.appendChild(tagPill);
    }

    const primaryUrl = todo.sourceUrl || todo.sources?.[0]?.url || null;
    if (primaryUrl) {
      const safeLink = createSafeLink(
        primaryUrl,
        `↗ ${todo.sourceLabel || extractDomain(primaryUrl) || 'Source'}`,
        'link-pill'
      );
      if (safeLink) {
        meta.appendChild(safeLink);
      }
    }

    const sourcesCount = Array.isArray(todo.sources) ? todo.sources.length : 0;
    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    ctxBtn.textContent = sourcesCount > 1 ? `📖 Context · ${sourcesCount} sources` : '📖 Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemContextModal({ kind: 'todo', id: todo.id });
    });
    meta.appendChild(ctxBtn);
    content.appendChild(meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove TODO "${todo.text}"`);
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeTodo(todo.id);
      showToast('TODO removed');
    });

    li.append(checkbox, content, removeBtn);
    fragment.appendChild(li);
  }

  listEl.replaceChildren(fragment);
}

/**
 * Map a Slack badge label to a pill-badge data-status style hook.
 * @param {string | null} badge
 * @returns {string}
 */
function resolveBadgeStatus(badge) {
  const lower = (badge || '').toLowerCase();
  if (lower.includes('decision') || lower.includes('release')) return 'decision';
  if (lower.includes('action') || lower.includes('review')) return 'action';
  if (lower.includes('incident') || lower.includes('alert')) return 'incident';
  return '';
}

/**
 * Render Daily Digest & Team Pulse card (default collapsed to 5 items + full panel collapse).
 * @param {any} state
 */
function renderSlackDigest(state) {
  const cardEl = byId('widget-slack');
  const headingEl = byId('slack-heading');
  const listEl = byId('slack-digest-list');
  const metaEl = byId('slack-meta-badge');
  const expandFooter = byId('slack-expand-footer');
  const expandBtn = byId('slack-expand-btn');
  const bodyCollapseBtn = byId('slack-body-collapse-btn');
  if (!listEl) return;

  if (headingEl) {
    headingEl.textContent = `💬 ${state.digestConfig?.title || 'Daily Digest'}`;
  }

  const digest = state.slackDigest || { date: '', deliveredAt: '', items: [] };
  const allItems = digest.items || [];
  const slice = getVisibleSlackDigestSlice(allItems, state.wellness, SLACK_COLLAPSED_LIMIT);

  if (cardEl) {
    cardEl.classList.toggle('is-panel-collapsed', slice.isPanelCollapsed);
  }
  if (bodyCollapseBtn) {
    bodyCollapseBtn.textContent = slice.isPanelCollapsed ? `Expand (${slice.totalCount}) ▾` : 'Collapse ▴';
    bodyCollapseBtn.setAttribute('aria-expanded', String(!slice.isPanelCollapsed));
  }

  if (metaEl) {
    const countLabel = slice.hasOverflow && !slice.isExpanded
      ? `${slice.visibleItems.length} of ${slice.totalCount}`
      : `${slice.totalCount} items`;
    const parts = [digest.date, countLabel].filter(Boolean);
    metaEl.textContent = parts.join(' · ') || 'Latest';
  }

  if (expandFooter && expandBtn) {
    if (slice.hasOverflow && !slice.isPanelCollapsed) {
      expandFooter.hidden = false;
      expandBtn.setAttribute('aria-expanded', String(slice.isExpanded));
      expandBtn.textContent = slice.isExpanded
        ? `Collapse digest to ${slice.limit} items ▴`
        : `Show all ${slice.totalCount} digest items (+${slice.hiddenCount} more) ▾`;
    } else {
      expandFooter.hidden = true;
    }
  }

  if (slice.isPanelCollapsed) {
    return;
  }

  if (allItems.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Daily digest is clear. Add a manual item, connect a Custom Digest JSON URL in Settings, or sync via Private Gist.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of slice.visibleItems) {
    const li = document.createElement('li');
    li.className = 'digest-item is-interactive-row';
    li.title = 'Click to read full thread context, decisions & sources';
    li.addEventListener('click', (event) => {
      if (isNestedInteractiveClick(event, li)) return;
      openItemContextModal({ kind: 'slack', id: item.id });
    });

    const topRow = document.createElement('div');
    topRow.className = 'digest-item-top';

    const badges = document.createElement('div');
    badges.className = 'digest-badges';

    const channelBadge = document.createElement('span');
    channelBadge.className = 'channel-badge';
    channelBadge.textContent = item.channel;
    badges.appendChild(channelBadge);

    if (item.badge) {
      const statusBadge = document.createElement('span');
      statusBadge.className = 'pill-badge';
      const statusType = resolveBadgeStatus(item.badge);
      if (statusType) statusBadge.setAttribute('data-status', statusType);
      statusBadge.textContent = item.badge;
      badges.appendChild(statusBadge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove digest item "${item.headline}"`);
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeSlackItem(item.id);
      showToast('Digest item dismissed');
    });

    topRow.append(badges, removeBtn);

    const headlineEl = document.createElement('h3');
    headlineEl.className = 'digest-headline';
    headlineEl.textContent = item.headline;

    li.append(topRow, headlineEl);

    const previewBody = item.summary && item.summary !== item.headline ? item.summary : item.context;
    if (previewBody) {
      const summaryEl = document.createElement('p');
      summaryEl.className = 'digest-summary';
      summaryEl.textContent = previewBody;
      li.appendChild(summaryEl);
    }

    const actions = document.createElement('div');
    actions.className = 'digest-actions';

    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    const srcCount = Array.isArray(item.sources) ? item.sources.length : 0;
    ctxBtn.textContent = srcCount > 0 ? `📖 Context · ${srcCount} sources` : '📖 Read Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemContextModal({ kind: 'slack', id: item.id });
    });
    actions.appendChild(ctxBtn);

    const primaryUrl = item.url || item.sources?.[0]?.url || null;
    if (primaryUrl) {
      const threadLink = createSafeLink(primaryUrl, '↗ Open Source', 'btn btn-ghost btn-sm');
      if (threadLink) {
        actions.appendChild(threadLink);
      }
    }

    const toTodoBtn = document.createElement('button');
    toTodoBtn.type = 'button';
    toTodoBtn.className = 'btn btn-ghost btn-sm';
    toTodoBtn.textContent = '+ To TODO';
    toTodoBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const created = await promoteSlackToTodo(item.id);
      showToast(created ? 'Added to Today\'s TODOs (with context & sources)' : 'Unable to add TODO');
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-ghost btn-sm';
    saveBtn.textContent = '🔖 Save';
    saveBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const created = await promoteSlackToBookmark(item.id);
      showToast(created ? 'Saved to Reading Queue' : 'Attach a URL in Context view to bookmark');
    });

    actions.append(toTodoBtn, saveBtn);
    li.appendChild(actions);
    fragment.appendChild(li);
  }

  listEl.replaceChildren(fragment);
}

/**
 * Render Reading Queue & Bookmarks card with dynamic tag + archive filter pills.
 * @param {any} state
 */
function renderBookmarks(state) {
  const pillsEl = byId('bookmark-filter-pills');
  const listEl = byId('bookmark-list');
  const badgeEl = byId('bookmarks-badge');
  if (!listEl || !pillsEl) return;

  const allBookmarks = state.bookmarks || [];
  const inboxBookmarks = allBookmarks.filter((bm) => bm.status !== 'archived');
  const archivedBookmarks = allBookmarks.filter((bm) => bm.status === 'archived');

  if (badgeEl) {
    badgeEl.textContent = `${inboxBookmarks.length} saved`;
  }

  // Collect dynamic tags from inbox bookmarks
  const tagCounts = new Map();
  for (const bm of inboxBookmarks) {
    for (const tag of bm.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const filterKeys = [
    { key: 'all', label: `All (${inboxBookmarks.length})` },
    ...Array.from(tagCounts.keys()).sort().map((tag) => ({ key: tag, label: `#${tag}` })),
    { key: 'archived', label: `Archived / Read (${archivedBookmarks.length})` }
  ];

  // Reset filter to 'all' if selected tag no longer exists
  if (!filterKeys.some((entry) => entry.key === activeBookmarkFilter)) {
    activeBookmarkFilter = 'all';
  }

  const pillsFrag = document.createDocumentFragment();
  for (const entry of filterKeys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = activeBookmarkFilter === entry.key ? 'filter-pill is-active' : 'filter-pill';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(activeBookmarkFilter === entry.key));
    btn.textContent = entry.label;
    btn.addEventListener('click', () => {
      activeBookmarkFilter = entry.key;
      renderBookmarks(getStateSnapshot());
    });
    pillsFrag.appendChild(btn);
  }
  pillsEl.replaceChildren(pillsFrag);

  let visible = [];
  if (activeBookmarkFilter === 'archived') {
    visible = archivedBookmarks.slice();
  } else if (activeBookmarkFilter === 'all') {
    visible = inboxBookmarks.slice();
  } else {
    visible = inboxBookmarks.filter((bm) => (bm.tags || []).includes(activeBookmarkFilter));
  }

  visible.sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) {
      return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    }
    return Date.parse(b.addedAt || b.updatedAt || '') - Date.parse(a.addedAt || a.updatedAt || '');
  });

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = activeBookmarkFilter === 'archived'
      ? 'No archived reading items yet.'
      : 'Reading queue is clear. Paste a URL below to save an article.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const bm of visible) {
    const li = document.createElement('li');
    li.className = 'bookmark-item is-interactive-row';
    li.title = 'Click row for summary, takeaways & sources · Click title ↗ to open directly';
    li.addEventListener('click', (event) => {
      if (isNestedInteractiveClick(event, li)) return;
      openItemContextModal({ kind: 'bookmark', id: bm.id });
    });

    const main = document.createElement('div');
    main.className = 'bookmark-main';

    const titleLink = createSafeLink(bm.url, `${bm.title} ↗`, 'bookmark-title-link');
    if (titleLink) {
      main.appendChild(titleLink);
    }

    if (bm.context) {
      const snippetEl = document.createElement('p');
      snippetEl.className = 'item-context-snippet';
      snippetEl.textContent = bm.context;
      main.appendChild(snippetEl);
    }

    const meta = document.createElement('div');
    meta.className = 'bookmark-meta';

    const domainSpan = document.createElement('span');
    domainSpan.className = 'bookmark-domain';
    domainSpan.textContent = bm.domain || extractDomain(bm.url);
    meta.appendChild(domainSpan);

    const readTimeSpan = document.createElement('span');
    readTimeSpan.className = 'bookmark-read-time';
    readTimeSpan.textContent = `${bm.estReadMins || 5}m read`;
    meta.appendChild(readTimeSpan);

    for (const tag of bm.tags || []) {
      const tagPill = document.createElement('span');
      tagPill.className = 'tag-pill';
      tagPill.textContent = `#${tag}`;
      meta.appendChild(tagPill);
    }

    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    const bmSrcCount = Array.isArray(bm.sources) ? bm.sources.length : 1;
    ctxBtn.textContent = bmSrcCount > 1 ? `📖 Context · ${bmSrcCount} sources` : '📖 Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemContextModal({ kind: 'bookmark', id: bm.id });
    });
    meta.appendChild(ctxBtn);

    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'bookmark-actions';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = bm.pinned ? 'btn-star is-pinned' : 'btn-star';
    starBtn.textContent = bm.pinned ? '★' : '☆';
    starBtn.setAttribute('aria-label', bm.pinned ? `Unpin "${bm.title}"` : `Pin "${bm.title}"`);
    starBtn.title = bm.pinned ? 'Unpin' : 'Pin to top';
    starBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleBookmarkPin(bm.id);
    });

    const toTodoBtn = document.createElement('button');
    toTodoBtn.type = 'button';
    toTodoBtn.className = 'btn btn-ghost btn-sm';
    toTodoBtn.textContent = '+ TODO';
    toTodoBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const created = await promoteBookmarkToTodo(bm.id);
      showToast(created ? 'Scheduled in Today\'s TODOs' : 'Unable to add TODO');
    });

    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'btn btn-ghost btn-sm';
    const isArchived = bm.status === 'archived';
    statusBtn.textContent = isArchived ? '↩ Inbox' : '✓ Read';
    statusBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await updateBookmarkStatus(bm.id, isArchived ? 'inbox' : 'archived');
      showToast(isArchived ? 'Moved back to Reading Queue' : 'Marked as read');
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove bookmark "${bm.title}"`);
    removeBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeBookmark(bm.id);
      showToast('Bookmark removed');
    });

    actions.append(starBtn, toTodoBtn, statusBtn, removeBtn);
    li.append(main, actions);
    fragment.appendChild(li);
  }

  listEl.replaceChildren(fragment);
}

/**
 * Render the Bottom Collapsible Discovery Stream Drawer & Rich RSS Cards.
 * @param {any} state
 */
function renderDiscoveryStream(state) {
  const drawer = byId('discovery-drawer');
  const tabsEl = byId('rss-source-tabs');
  const gridEl = byId('discovery-cards-grid');
  const collapseBtn = byId('rss-collapse-btn');
  if (!drawer || !tabsEl || !gridEl) return;

  const isCollapsed = Boolean(state.wellness?.rssCollapsed);
  drawer.classList.toggle('is-collapsed', isCollapsed);
  if (collapseBtn) {
    collapseBtn.textContent = isCollapsed ? 'Expand ▴' : 'Collapse ▾';
    collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
  }

  const enabledSources = (state.rssSources || []).filter((src) => src.enabled !== false);
  if (activeRssSourceId !== 'all' && !enabledSources.some((src) => src.id === activeRssSourceId)) {
    activeRssSourceId = 'all';
  }

  const tabs = [
    { id: 'all', name: 'All Sources' },
    ...enabledSources.map((src) => ({ id: src.id, name: src.name }))
  ];

  const tabsFrag = document.createDocumentFragment();
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = activeRssSourceId === tab.id ? 'filter-pill is-active' : 'filter-pill';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(activeRssSourceId === tab.id));
    btn.textContent = tab.name;
    btn.addEventListener('click', () => {
      activeRssSourceId = tab.id;
      renderDiscoveryStream(getStateSnapshot());
    });
    tabsFrag.appendChild(btn);
  }
  tabsEl.replaceChildren(tabsFrag);

  const dismissedSet = new Set(state.rssCache?.dismissedUrls || []);
  const enabledIds = new Set(enabledSources.map((src) => src.id));
  const sourceById = new Map(enabledSources.map((src) => [src.id, src]));

  let articles = (state.rssCache?.items || []).filter(
    (item) => item && !dismissedSet.has(item.url) && (!item.sourceId || enabledIds.has(item.sourceId))
  );
  if (articles.length === 0 && enabledSources.length > 0) {
    articles = getCuratedFallbackArticles(enabledSources).filter((item) => !dismissedSet.has(item.url));
  }

  if (activeRssSourceId !== 'all') {
    articles = articles.filter((item) => item.sourceId === activeRssSourceId);
    if (articles.length === 0) {
      const targetSource = sourceById.get(activeRssSourceId);
      if (targetSource) {
        articles = getCuratedFallbackArticles([targetSource]).filter((item) => !dismissedSet.has(item.url));
      }
    }
  }

  if (articles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = enabledSources.length === 0
      ? 'No RSS sources enabled. Click "Manage RSS" to enable or add feeds.'
      : 'No articles available for this source. Click Refresh or check Manage RSS.';
    gridEl.replaceChildren(empty);
    return;
  }

  const savedBookmarkUrls = new Set((state.bookmarks || []).map((bm) => bm.url));
  const fragment = document.createDocumentFragment();
  const maxVisible = activeRssSourceId === 'all' ? 15 : 12;

  for (const article of articles.slice(0, maxVisible)) {
    const card = document.createElement('article');
    card.className = 'rss-card is-interactive-row';
    card.title = 'Click card to read summary, key takeaways & cited sources';
    card.addEventListener('click', (event) => {
      if (isNestedInteractiveClick(event, card)) return;
      openItemContextModal({ kind: 'rss', article });
    });

    const header = document.createElement('div');
    header.className = 'rss-card-header';

    const metaLeft = document.createElement('div');
    metaLeft.className = 'digest-badges';

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'pill-badge';
    const labAccent = detectLabAccent(`${article.sourceName} ${sourceById.get(article.sourceId)?.category || ''}`);
    if (labAccent) {
      sourceBadge.setAttribute('data-lab', labAccent);
    }
    sourceBadge.textContent = article.sourceName || extractDomain(article.url);

    const readSpan = document.createElement('span');
    readSpan.className = 'bookmark-read-time';
    const relPub = formatRelativeTime(article.publishedAt);
    readSpan.textContent = relPub
      ? `${article.estReadMins || 5}m · ${relPub}`
      : `${article.estReadMins || 5}m read`;

    metaLeft.append(sourceBadge, readSpan);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn-remove';
    dismissBtn.textContent = '×';
    dismissBtn.setAttribute('aria-label', `Dismiss "${article.title}"`);
    dismissBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await dismissRssArticle(article.url);
      showToast('Article dismissed');
    });

    header.append(metaLeft, dismissBtn);

    const bodyGroup = document.createElement('div');
    bodyGroup.className = 'objective-content';

    const titleHeading = document.createElement('h3');
    titleHeading.className = 'rss-card-title';
    const titleLink = createSafeLink(article.url, `${article.title} ↗`);
    if (titleLink) {
      titleHeading.appendChild(titleLink);
    }
    bodyGroup.appendChild(titleHeading);

    const summaryText = article.summary
      || `Published by ${article.sourceName || extractDomain(article.url)}. Click to read takeaways & connected sources.`;
    const summaryEl = document.createElement('p');
    summaryEl.className = 'rss-card-summary';
    summaryEl.textContent = summaryText;
    bodyGroup.appendChild(summaryEl);

    const actions = document.createElement('div');
    actions.className = 'rss-card-actions';

    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    const srcCount = Array.isArray(article.sources) ? article.sources.length : 1;
    ctxBtn.textContent = srcCount > 1 ? `📖 Context · ${srcCount} sources` : '📖 Read Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemContextModal({ kind: 'rss', article });
    });

    const rightActions = document.createElement('div');
    rightActions.className = 'digest-badges';

    const queueBtn = document.createElement('button');
    queueBtn.type = 'button';
    queueBtn.className = 'btn btn-ghost btn-sm';
    const alreadySaved = savedBookmarkUrls.has(article.url);
    queueBtn.textContent = alreadySaved ? '✓ Saved' : '🔖 Queue';
    queueBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const sourceCategory = sourceById.get(article.sourceId)?.category || 'reading';
      const tags = Array.from(new Set([sourceCategory, ...(article.categories || [])])).slice(0, 4);
      const saved = await addBookmark({
        url: article.url,
        title: article.title,
        tags,
        estReadMins: article.estReadMins,
        context: article.summary || '',
        keyPoints: article.keyPoints || [],
        sources: article.sources || []
      });
      if (saved) {
        queueBtn.textContent = '✓ Saved';
        showToast('Saved to Reading Queue with context & sources');
      }
    });

    const toTodoBtn = document.createElement('button');
    toTodoBtn.type = 'button';
    toTodoBtn.className = 'btn btn-ghost btn-sm';
    toTodoBtn.textContent = '+ TODO';
    toTodoBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const sourceCategory = sourceById.get(article.sourceId)?.category || '';
      await addTodo({
        text: `Read: ${article.title}`,
        tags: sourceCategory ? [sourceCategory] : [],
        sourceUrl: article.url,
        sourceLabel: article.sourceName || extractDomain(article.url),
        context: article.summary || '',
        keyPoints: article.keyPoints || [],
        sources: article.sources || []
      });
      showToast('Added to Today\'s TODOs with context & sources');
    });

    rightActions.append(queueBtn, toTodoBtn);
    actions.append(ctxBtn, rightActions);
    card.append(header, bodyGroup, actions);
    fragment.appendChild(card);
  }

  gridEl.replaceChildren(fragment);
}

/**
 * Render RSS sources & 1-click AI/Engineering preset chips inside #rss-manager-modal.
 * @param {any} state
 */
function renderRssManagerModal(state) {
  const listEl = byId('rss-sources-list');
  const presetsEl = byId('rss-preset-chips');
  if (!listEl) return;

  const sources = state.rssSources || [];
  const existingUrls = new Set(sources.map((s) => s.xmlUrl));

  if (presetsEl) {
    const presetFrag = document.createDocumentFragment();
    for (const preset of DEFAULT_RSS_SOURCES) {
      const isAdded = existingUrls.has(preset.xmlUrl);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = isAdded ? 'btn btn-calm btn-sm' : 'btn btn-ghost btn-sm';
      chip.textContent = isAdded ? `✓ ${preset.name}` : `+ ${preset.name}`;
      chip.disabled = isAdded;
      chip.addEventListener('click', async () => {
        await addRssSource({
          name: preset.name,
          xmlUrl: preset.xmlUrl,
          siteUrl: preset.siteUrl,
          category: preset.category
        });
        showToast(`Added ${preset.name}`);
        await refreshRssFeeds({ force: true });
      });
      presetFrag.appendChild(chip);
    }
    presetsEl.replaceChildren(presetFrag);
  }

  if (sources.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No RSS sources configured yet. Click any preset above or add a custom URL below.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const src of sources) {
    const li = document.createElement('li');
    li.className = 'bookmark-item';

    const main = document.createElement('div');
    main.className = 'bookmark-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'digest-badges';

    const nameSpan = document.createElement('strong');
    nameSpan.textContent = src.name;
    titleRow.appendChild(nameSpan);

    if (src.siteUrl) {
      const visitLink = createSafeLink(src.siteUrl, '↗ Blog', 'link-pill');
      if (visitLink) titleRow.appendChild(visitLink);
    }

    const meta = document.createElement('div');
    meta.className = 'bookmark-meta';

    const catPill = document.createElement('span');
    catPill.className = 'tag-pill';
    catPill.textContent = `#${src.category || 'general'}`;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'bookmark-domain';
    urlSpan.textContent = src.xmlUrl;

    meta.append(catPill, urlSpan);
    main.append(titleRow, meta);

    const actions = document.createElement('div');
    actions.className = 'bookmark-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = src.enabled ? 'btn btn-calm btn-sm' : 'btn btn-ghost btn-sm';
    toggleBtn.textContent = src.enabled ? 'Enabled' : 'Paused';
    toggleBtn.addEventListener('click', async () => {
      await toggleRssSource(src.id);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove RSS source "${src.name}"`);
    removeBtn.addEventListener('click', async () => {
      await removeRssSource(src.id);
      showToast(`Removed ${src.name}`);
    });

    actions.append(toggleBtn, removeBtn);
    li.append(main, actions);
    fragment.appendChild(li);
  }

  listEl.replaceChildren(fragment);
}

/**
 * Populate Sync & Gateway Settings modal inputs and status.
 * @param {any} state
 */
function populateSyncSettingsModal(state) {
  const userNameInput = byId('settings-user-name');
  const patInput = byId('sync-github-pat');
  const gistIdInput = byId('sync-gist-id');
  const statusEl = byId('sync-modal-status');
  const pwaInput = byId('pwa-url-hint-input');
  const digestTitleInput = byId('digest-title-input');
  const digestFeedUrlInput = byId('digest-feed-url-input');

  if (userNameInput) userNameInput.value = state.userName || '';
  if (patInput) patInput.value = state.sync?.githubPat || '';
  if (gistIdInput) gistIdInput.value = state.sync?.gistId || '';
  if (digestTitleInput) digestTitleInput.value = state.digestConfig?.title || 'Daily Digest';
  if (digestFeedUrlInput) digestFeedUrlInput.value = state.digestConfig?.feedUrl || '';

  if (statusEl) {
    const status = state.sync?.lastSyncStatus || 'local-only';
    const ago = formatRelativeTime(state.sync?.lastSyncedAt);
    const err = state.sync?.lastSyncError ? ` — ${state.sync.lastSyncError}` : '';
    statusEl.textContent = `Status: ${status}${ago ? ` (${ago})` : ''}${err}`;
  }

  if (pwaInput) {
    pwaInput.value = location.protocol === 'chrome-extension:'
      ? 'https://<your-pwa-host>/index.html?source=pwa'
      : location.href;
  }
}

/**
 * Populate First-Run Welcome / Onboarding setup modal fields.
 * @param {any} state
 */
function populateOnboardingModal(state) {
  const nameInput = byId('onboarding-user-name');
  const weatherSelect = byId('onboarding-weather-select');
  const geoStatusEl = byId('onboarding-geo-status');
  const digestToggle = byId('onboarding-digest-toggle');

  if (nameInput) nameInput.value = state.userName || '';
  onboardingPendingWeather = null;

  if (geoStatusEl) {
    geoStatusEl.hidden = true;
    geoStatusEl.textContent = '';
  }

  if (weatherSelect) {
    const frag = document.createDocumentFragment();
    POPULAR_WEATHER_CITIES.forEach((city, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = `${city.locationName}, ${city.country}`;
      frag.appendChild(opt);
    });
    const currentLoc = state.widgets?.weather?.locationName || '';
    const matchIdx = POPULAR_WEATHER_CITIES.findIndex(
      (c) => c.locationName.toLowerCase() === currentLoc.toLowerCase()
    );
    if (matchIdx < 0 && currentLoc) {
      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = `${currentLoc}${state.widgets?.weather?.country ? `, ${state.widgets.weather.country}` : ''}`;
      frag.insertBefore(customOpt, frag.firstChild);
      weatherSelect.replaceChildren(frag);
      weatherSelect.value = 'custom';
    } else {
      weatherSelect.replaceChildren(frag);
      weatherSelect.value = String(matchIdx >= 0 ? matchIdx : 0);
    }
  }

  if (digestToggle) {
    digestToggle.checked = isWidgetActive(state, 'slack');
  }
}

function openOnboardingModal(state = currentState || getStateSnapshot()) {
  const modal = byId('onboarding-modal');
  if (!modal) return;
  populateOnboardingModal(state);
  if (!modal.open) {
    modal.showModal();
  }
}

/**
 * Resolve the live entity & normalized view-model for #item-context-modal.
 * @param {any} state
 * @returns {any | null}
 */
function resolveContextModalData(state) {
  if (!activeContextTarget || !state) return null;
  const { kind, id, article } = activeContextTarget;

  if (kind === 'objective') {
    const obj = (state.objectives || []).find((o) => o.id === id);
    if (!obj) return null;
    return {
      kind,
      id: obj.id,
      editable: true,
      typeBadge: '🎯 Daily Objective',
      sourceBadge: obj.completed ? '✓ Completed' : 'Active Objective',
      title: obj.title,
      submeta: [obj.urlLabel || (obj.url ? extractDomain(obj.url) : ''), `Updated ${formatRelativeTime(obj.updatedAt)}`].filter(Boolean),
      primaryUrl: obj.url || obj.sources?.[0]?.url || null,
      prose: obj.context || 'No background context added yet. Click "Edit Context & Notes" below to document your architectural rationale or success criteria, or attach reference links.',
      keyPoints: obj.keyPoints || [],
      sources: obj.sources || [],
      rawEntity: obj
    };
  }

  if (kind === 'todo') {
    const todo = (state.todos || []).find((t) => t.id === id);
    if (!todo) return null;
    return {
      kind,
      id: todo.id,
      editable: true,
      typeBadge: '✅ Tactical TODO',
      sourceBadge: todo.completed ? '✓ Done' : 'Open Task',
      title: todo.text,
      submeta: [
        ...(todo.tags || []).map((t) => `#${t}`),
        todo.sourceLabel || ''
      ].filter(Boolean),
      primaryUrl: todo.sourceUrl || todo.sources?.[0]?.url || null,
      prose: todo.context || 'No additional task notes yet. Click "Edit Context & Notes" to add acceptance notes or attach reference links below.',
      keyPoints: todo.keyPoints || [],
      sources: todo.sources || [],
      rawEntity: todo
    };
  }

  if (kind === 'slack') {
    const item = (state.slackDigest?.items || []).find((s) => s.id === id);
    if (!item) return null;
    const combinedProse = [item.summary, item.context]
      .filter((part, idx, arr) => part && arr.indexOf(part) === idx)
      .join('\n\n');
    return {
      kind,
      id: item.id,
      editable: true,
      typeBadge: `💬 ${state.digestConfig?.title || 'Daily Digest'}`,
      sourceBadge: item.channel,
      extraBadge: item.badge || '',
      title: item.headline,
      submeta: [state.slackDigest?.date, state.slackDigest?.deliveredAt].filter(Boolean),
      primaryUrl: item.url || item.sources?.[0]?.url || null,
      prose: combinedProse || 'No thread details recorded yet. Use "Edit Context & Notes" or attach a reference URL below.',
      keyPoints: item.keyPoints || [],
      sources: item.sources || [],
      rawEntity: item
    };
  }

  if (kind === 'bookmark') {
    const bm = (state.bookmarks || []).find((b) => b.id === id);
    if (!bm) return null;
    return {
      kind,
      id: bm.id,
      editable: true,
      typeBadge: '📚 Reading Queue',
      sourceBadge: bm.domain || extractDomain(bm.url),
      title: bm.title,
      submeta: [
        `${bm.estReadMins || 5}m read`,
        ...(bm.tags || []).map((t) => `#${t}`),
        bm.pinned ? '★ Pinned' : ''
      ].filter(Boolean),
      primaryUrl: bm.url,
      prose: bm.context || `Saved from ${bm.domain || extractDomain(bm.url)}. Click "Open Primary Source" to read the full article in a new tab, or jot down your takeaways & related links here.`,
      keyPoints: bm.keyPoints || [],
      sources: bm.sources || [],
      rawEntity: bm
    };
  }

  if (kind === 'rss' && article) {
    const liveMatch = (state.rssCache?.items || []).find((it) => it.url === article.url) || article;
    return {
      kind: 'rss',
      id: liveMatch.id,
      editable: false,
      typeBadge: '⚡ Discovery Stream',
      sourceBadge: liveMatch.sourceName || extractDomain(liveMatch.url),
      title: liveMatch.title,
      submeta: [
        liveMatch.author ? `By ${liveMatch.author}` : '',
        `${liveMatch.estReadMins || 5}m read`,
        formatRelativeTime(liveMatch.publishedAt),
        ...(liveMatch.categories || []).map((c) => `#${c}`)
      ].filter(Boolean),
      primaryUrl: liveMatch.url,
      prose: liveMatch.summary || `Published on ${liveMatch.sourceName || extractDomain(liveMatch.url)}.`,
      keyPoints: liveMatch.keyPoints || [],
      sources: liveMatch.sources && liveMatch.sources.length > 0
        ? liveMatch.sources
        : [{ label: `${liveMatch.sourceName || 'Article'} — Primary Post`, url: liveMatch.url, kind: 'primary' }],
      rawEntity: liveMatch
    };
  }

  return null;
}

/**
 * Render the #item-context-modal contents cleanly using safe DOM creation.
 * @param {any} state
 */
function renderItemContextModal(state) {
  const modal = byId('item-context-modal');
  if (!modal) return;

  const data = resolveContextModalData(state);
  if (!data) {
    if (modal.open) modal.close();
    return;
  }

  const badgesEl = byId('ctx-modal-badges');
  const titleEl = byId('ctx-modal-title');
  const submetaEl = byId('ctx-modal-submeta');
  const actionsEl = byId('ctx-modal-actions');
  const proseEl = byId('ctx-modal-prose');
  const keypointsSec = byId('ctx-keypoints-section');
  const keypointsList = byId('ctx-modal-keypoints');
  const sourcesList = byId('ctx-modal-sources');
  const addSourceForm = byId('ctx-add-source-form');
  const editForm = byId('ctx-edit-form');

  if (badgesEl) {
    const frag = document.createDocumentFragment();
    const typePill = document.createElement('span');
    typePill.className = 'pill-badge';
    typePill.textContent = data.typeBadge;
    frag.appendChild(typePill);

    if (data.sourceBadge) {
      const srcPill = document.createElement('span');
      srcPill.className = 'pill-badge';
      const lab = detectLabAccent(data.sourceBadge);
      if (lab) srcPill.setAttribute('data-lab', lab);
      srcPill.textContent = data.sourceBadge;
      frag.appendChild(srcPill);
    }

    if (data.extraBadge) {
      const extraPill = document.createElement('span');
      extraPill.className = 'pill-badge';
      const st = resolveBadgeStatus(data.extraBadge);
      if (st) extraPill.setAttribute('data-status', st);
      extraPill.textContent = data.extraBadge;
      frag.appendChild(extraPill);
    }
    badgesEl.replaceChildren(frag);
  }

  if (titleEl) titleEl.textContent = data.title;

  if (submetaEl) {
    const subFrag = document.createDocumentFragment();
    for (const part of data.submeta) {
      const span = document.createElement('span');
      span.className = part.startsWith('#') ? 'tag-pill' : 'bookmark-domain';
      span.textContent = part;
      subFrag.appendChild(span);
    }
    submetaEl.replaceChildren(subFrag);
  }

  if (actionsEl) {
    const actFrag = document.createDocumentFragment();
    if (data.primaryUrl) {
      const openLink = createSafeLink(data.primaryUrl, '↗ Open Primary Source in New Tab', 'btn btn-primary btn-sm');
      if (openLink) actFrag.appendChild(openLink);
    }

    if (data.kind === 'rss') {
      const article = data.rawEntity;
      const alreadySaved = (state.bookmarks || []).some((b) => b.url === article.url);
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-calm btn-sm';
      saveBtn.textContent = alreadySaved ? '✓ In Reading Queue' : '🔖 Save to Reading Queue';
      saveBtn.addEventListener('click', async () => {
        const saved = await addBookmark({
          url: article.url,
          title: article.title,
          tags: article.categories || ['ai'],
          estReadMins: article.estReadMins,
          context: article.summary || '',
          keyPoints: article.keyPoints || [],
          sources: article.sources || []
        });
        if (saved) {
          showToast('Saved to Reading Queue with full context & sources');
          openItemContextModal({ kind: 'bookmark', id: saved.id });
        }
      });
      actFrag.appendChild(saveBtn);

      const todoBtn = document.createElement('button');
      todoBtn.type = 'button';
      todoBtn.className = 'btn btn-ghost btn-sm';
      todoBtn.textContent = '+ Add to Today\'s TODOs';
      todoBtn.addEventListener('click', async () => {
        const created = await addTodo({
          text: `Read: ${article.title}`,
          tags: article.categories || [],
          sourceUrl: article.url,
          sourceLabel: article.sourceName || extractDomain(article.url),
          context: article.summary || '',
          keyPoints: article.keyPoints || [],
          sources: article.sources || []
        });
        if (created) showToast('Added to Today\'s TODOs');
      });
      actFrag.appendChild(todoBtn);
    }

    if (data.kind === 'slack') {
      const todoBtn = document.createElement('button');
      todoBtn.type = 'button';
      todoBtn.className = 'btn btn-calm btn-sm';
      todoBtn.textContent = '+ Promote to TODO';
      todoBtn.addEventListener('click', async () => {
        const created = await promoteSlackToTodo(data.id);
        if (created) showToast('Added to Today\'s TODOs');
      });
      actFrag.appendChild(todoBtn);
    }

    if (data.kind === 'bookmark') {
      const todoBtn = document.createElement('button');
      todoBtn.type = 'button';
      todoBtn.className = 'btn btn-ghost btn-sm';
      todoBtn.textContent = '+ Schedule in TODOs';
      todoBtn.addEventListener('click', async () => {
        const created = await promoteBookmarkToTodo(data.id);
        if (created) showToast('Scheduled in Today\'s TODOs');
      });
      actFrag.appendChild(todoBtn);
    }

    if (data.editable) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-ghost btn-sm';
      editBtn.textContent = isEditingContextModal ? 'Close Editor' : '✏️ Edit Context & Notes';
      editBtn.addEventListener('click', () => {
        isEditingContextModal = !isEditingContextModal;
        renderItemContextModal(currentState || getStateSnapshot());
        if (isEditingContextModal) {
          byId('ctx-edit-context')?.focus();
        }
      });
      actFrag.appendChild(editBtn);
    }

    actionsEl.replaceChildren(actFrag);
  }

  if (proseEl) {
    proseEl.textContent = data.prose;
  }

  if (keypointsSec && keypointsList) {
    if (data.keyPoints.length > 0) {
      keypointsSec.hidden = false;
      const kpFrag = document.createDocumentFragment();
      for (const pt of data.keyPoints) {
        const li = document.createElement('li');
        li.textContent = pt;
        kpFrag.appendChild(li);
      }
      keypointsList.replaceChildren(kpFrag);
    } else {
      keypointsSec.hidden = true;
      keypointsList.replaceChildren();
    }
  }

  if (sourcesList) {
    const srcFrag = document.createDocumentFragment();
    if (data.sources.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'empty-state';
      emptyLi.textContent = 'No external sources attached yet. Add a reference URL below.';
      srcFrag.appendChild(emptyLi);
    } else {
      for (const src of data.sources) {
        const cardLi = document.createElement('li');
        cardLi.className = 'source-card';

        const link = createSafeLink(src.url, '', 'source-card-link');
        if (link) {
          link.textContent = '';
          const titleSpan = document.createElement('span');
          titleSpan.className = 'source-card-title';
          titleSpan.textContent = `↗ ${src.label || extractDomain(src.url) || 'Open Source'}`;

          const urlSpan = document.createElement('span');
          urlSpan.className = 'source-card-url';
          urlSpan.textContent = src.url;

          link.append(titleSpan, urlSpan);
          cardLi.appendChild(link);
        }

        if (data.editable) {
          const removeSrcBtn = document.createElement('button');
          removeSrcBtn.type = 'button';
          removeSrcBtn.className = 'btn-remove';
          removeSrcBtn.textContent = '×';
          removeSrcBtn.title = 'Detach source link';
          removeSrcBtn.setAttribute('aria-label', `Remove source ${src.label}`);
          removeSrcBtn.addEventListener('click', async () => {
            const remaining = data.sources.filter((s) => s.url !== src.url);
            const nextPrimary = remaining[0]?.url || null;
            if (data.kind === 'objective') {
              await updateObjective(data.id, { url: nextPrimary, sources: remaining });
            } else if (data.kind === 'todo') {
              await updateTodo(data.id, { sourceUrl: nextPrimary, sources: remaining });
            } else if (data.kind === 'slack') {
              await updateSlackItem(data.id, { url: nextPrimary, sources: remaining });
            } else if (data.kind === 'bookmark') {
              await updateBookmark(data.id, { sources: remaining });
            }
            showToast('Source detached');
          });
          cardLi.appendChild(removeSrcBtn);
        }

        srcFrag.appendChild(cardLi);
      }
    }
    sourcesList.replaceChildren(srcFrag);
  }

  if (addSourceForm) {
    addSourceForm.hidden = !data.editable;
  }

  if (editForm) {
    editForm.hidden = !(data.editable && isEditingContextModal);
    if (data.editable && isEditingContextModal) {
      const titleInput = byId('ctx-edit-title');
      const contextInput = byId('ctx-edit-context');
      const kpInput = byId('ctx-edit-keypoints');
      if (titleInput) titleInput.value = data.title;
      if (contextInput) {
        contextInput.value = data.kind === 'slack'
          ? (data.rawEntity.context || data.rawEntity.summary || '')
          : (data.rawEntity.context || '');
      }
      if (kpInput) kpInput.value = (data.keyPoints || []).join('\n');
    }
  }
}

/**
 * Open the rich Item Context & Sources modal for any dashboard item.
 * @param {{ kind: 'objective'|'todo'|'slack'|'bookmark'|'rss', id?: string, article?: any }} target
 */
function openItemContextModal(target) {
  const modal = byId('item-context-modal');
  if (!modal) return;
  activeContextTarget = target;
  isEditingContextModal = false;
  renderItemContextModal(currentState || getStateSnapshot());
  if (!modal.open) {
    modal.showModal();
  }
}

/* --------------------------------------------------------------------------
   Circadian Nerdy Wallpaper Layer & Studio Modal
   -------------------------------------------------------------------------- */

/**
 * Apply the active daily-switching & time-of-day wallpaper to #gateway-bg-layer.
 * @param {any} state
 * @param {Date} [now]
 */
function renderBackgroundLayer(state, now = new Date()) {
  const layer = byId('gateway-bg-layer');
  const img = byId('gateway-bg-img');
  const tint = byId('gateway-bg-tint');
  const floatBar = byId('bg-floating-bar');
  const floatLabel = byId('bg-floating-label');

  const bg = resolveActiveBackground(state.background, now, state.wellness?.moodOverride || 'auto');
  document.documentElement.setAttribute('data-bg-active', bg.enabled ? 'true' : 'false');
  document.documentElement.setAttribute('data-bg-glass', bg.enabled && bg.glassCards ? 'true' : 'false');

  if (!bg.enabled || !bg.imageUri) {
    if (layer) layer.hidden = true;
    lastAppliedBgUri = '';
    if (floatLabel) floatLabel.textContent = '🖼️ Wallpaper: Off';
    return;
  }

  if (layer) layer.hidden = false;
  if (img) {
    if (lastAppliedBgUri !== bg.imageUri) {
      img.src = bg.imageUri;
      lastAppliedBgUri = bg.imageUri;
    }
    img.classList.toggle('is-pixel-art', Boolean(bg.isPixelArt));
    img.style.opacity = String(bg.opacity);
    const blurPart = bg.blurPx > 0 ? `blur(${bg.blurPx}px)` : '';
    const moodFilter = bg.isCustomUrl ? bg.palette.customFilter : '';
    img.style.filter = [blurPart, moodFilter].filter(Boolean).join(' ') || 'none';
  }
  if (tint) {
    tint.style.background = bg.palette.tintCss;
  }
  if (floatBar && floatLabel) {
    const icon = bg.isPixelArt ? '👾' : '🎨';
    floatLabel.textContent = `${icon} ${bg.item?.name || 'Wallpaper'} · ${bg.timeMoodLabel}`;
  }
}

/**
 * Render the #bg-settings-modal controls, preview, 12-scene gallery, and custom URLs.
 * @param {any} state
 */
function renderBgSettingsModal(state) {
  const now = new Date();
  const bgCfg = state.background || {};
  const resolved = resolveActiveBackground(bgCfg, now, state.wellness?.moodOverride || 'auto');

  const previewImg = byId('bg-preview-img');
  const previewName = byId('bg-preview-name');
  const previewMood = byId('bg-preview-mood');
  const modeSelect = byId('bg-mode-select');
  const moodSelect = byId('bg-mood-sync-select');
  const opacityRange = byId('bg-opacity-range');
  const opacityLabel = byId('bg-opacity-label');
  const blurRange = byId('bg-blur-range');
  const blurLabel = byId('bg-blur-label');
  const glassCheckbox = byId('bg-glass-checkbox');
  const catChips = byId('bg-category-chips');
  const galleryGrid = byId('bg-gallery-grid');
  const customList = byId('bg-custom-list');

  if (previewImg) {
    if (resolved.enabled && resolved.imageUri) {
      previewImg.hidden = false;
      previewImg.src = resolved.imageUri;
      previewImg.classList.toggle('is-pixel-art', Boolean(resolved.isPixelArt));
    } else {
      previewImg.hidden = true;
    }
  }
  if (previewName) {
    previewName.textContent = resolved.enabled
      ? `${resolved.item?.name || 'Wallpaper'} (${resolved.mode === 'daily-random' ? 'Daily Random' : resolved.mode})`
      : 'Wallpaper Off (Solid Studio Canvas)';
  }
  if (previewMood) {
    previewMood.textContent = resolved.timeMoodLabel;
  }

  if (modeSelect instanceof HTMLSelectElement) modeSelect.value = bgCfg.mode || 'daily-random';
  if (moodSelect instanceof HTMLSelectElement) moodSelect.value = bgCfg.moodSync || 'auto';

  const pct = Math.round((Number.isFinite(bgCfg.opacity) ? bgCfg.opacity : 0.42) * 100);
  if (opacityRange instanceof HTMLInputElement) opacityRange.value = String(pct);
  if (opacityLabel) opacityLabel.textContent = `Wallpaper Intensity: ${pct}%`;

  const blurVal = Number.isFinite(bgCfg.blurPx) ? bgCfg.blurPx : 0;
  if (blurRange instanceof HTMLInputElement) blurRange.value = String(blurVal);
  if (blurLabel) {
    blurLabel.textContent = blurVal === 0 ? 'Backdrop Blur: 0px (Crisp Pixel)' : `Backdrop Blur: ${blurVal}px`;
  }
  if (glassCheckbox instanceof HTMLInputElement) {
    glassCheckbox.checked = bgCfg.glassCards !== false;
  }

  if (catChips) {
    const enabledSet = new Set(bgCfg.categories || BACKGROUND_CATEGORIES.map((c) => c.id));
    const frag = document.createDocumentFragment();
    for (const cat of BACKGROUND_CATEGORIES) {
      const isOn = enabledSet.has(cat.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = isOn ? 'filter-pill is-active' : 'filter-pill';
      btn.setAttribute('aria-pressed', String(isOn));
      btn.textContent = `${isOn ? '✓ ' : ''}${cat.label}`;
      btn.addEventListener('click', async () => {
        const nextSet = new Set(currentState?.background?.categories || BACKGROUND_CATEGORIES.map((c) => c.id));
        if (nextSet.has(cat.id) && nextSet.size > 1) {
          nextSet.delete(cat.id);
        } else {
          nextSet.add(cat.id);
        }
        await updateBackgroundSettings({ categories: Array.from(nextSet) });
      });
      frag.appendChild(btn);
    }
    catChips.replaceChildren(frag);
  }

  if (galleryGrid) {
    const frag = document.createDocumentFragment();
    for (const scene of BACKGROUND_PACK) {
      const card = document.createElement('button');
      card.type = 'button';
      const isActive = resolved.enabled && resolved.item?.id === scene.id;
      card.className = isActive ? 'bg-scene-card is-selected' : 'bg-scene-card';
      card.title = scene.description;

      const thumb = document.createElement('img');
      thumb.className = scene.isPixelArt ? 'bg-scene-thumb is-pixel-art' : 'bg-scene-thumb';
      thumb.alt = scene.name;
      thumb.src = encodeSvgDataUri(buildSceneSvgMarkup(scene.id, resolved.palette));

      const labelRow = document.createElement('div');
      labelRow.className = 'digest-badges';

      const nameEl = document.createElement('strong');
      nameEl.style.fontSize = '0.78rem';
      nameEl.textContent = scene.name;

      const catTag = document.createElement('span');
      catTag.className = 'tag-pill';
      catTag.textContent = scene.category;

      labelRow.append(nameEl, catTag);
      card.append(thumb, labelRow);
      card.addEventListener('click', async () => {
        await updateBackgroundSettings({ mode: 'pinned', pinnedId: scene.id });
        showToast(`Pinned wallpaper: ${scene.name}`);
      });
      frag.appendChild(card);
    }
    galleryGrid.replaceChildren(frag);
  }

  if (customList) {
    const customs = bgCfg.customImages || [];
    if (customs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No custom wallpaper URLs added yet. Add any HTTPS pixel-art or tech image URL above.';
      customList.replaceChildren(empty);
    } else {
      const frag = document.createDocumentFragment();
      for (const custom of customs) {
        const li = document.createElement('li');
        li.className = 'source-card';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'btn btn-ghost btn-sm';
        selectBtn.textContent = `${custom.isPixelArt ? '👾' : '🖼️'} ${custom.name} (Pin)`;
        selectBtn.addEventListener('click', async () => {
          await updateBackgroundSettings({ mode: 'pinned', pinnedId: custom.id });
          showToast(`Pinned custom wallpaper: ${custom.name}`);
        });

        const urlSpan = document.createElement('span');
        urlSpan.className = 'source-card-url';
        urlSpan.textContent = custom.url;

        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'btn-remove';
        rmBtn.textContent = '×';
        rmBtn.setAttribute('aria-label', `Remove custom wallpaper ${custom.name}`);
        rmBtn.addEventListener('click', async () => {
          await removeCustomBackgroundImage(custom.id);
          showToast('Custom wallpaper removed');
        });

        li.append(selectBtn, urlSpan, rmBtn);
        frag.appendChild(li);
      }
      customList.replaceChildren(frag);
    }
  }
}

function openBgSettingsModal() {
  const modal = byId('bg-settings-modal');
  if (!modal) return;
  renderBgSettingsModal(currentState || getStateSnapshot());
  if (!modal.open) modal.showModal();
}

/* --------------------------------------------------------------------------
   4-Zone Component Layout Engine & Widget Store Modal
   -------------------------------------------------------------------------- */

/**
 * Move an existing DOM element into `parent` before `referenceNode` atomically,
 * using Element.prototype.moveBefore when available to preserve focus/state.
 * @param {HTMLElement} parent
 * @param {HTMLElement} node
 * @param {Node | null} referenceNode
 */
function placeElementAt(parent, node, referenceNode) {
  if (node.parentElement === parent && node.nextSibling === referenceNode) {
    return;
  }
  if (typeof parent.moveBefore === 'function' && node.isConnected && parent.isConnected) {
    try {
      parent.moveBefore(node, referenceNode);
      return;
    } catch {
      // Fallback if browser rejects cross-subtree moveBefore
    }
  }
  parent.insertBefore(node, referenceNode);
}

/**
 * Sync the physical DOM order of all `[data-widget-id]` components into
 * `#zone-top`, `#zone-left`, `#zone-right`, `#zone-bottom`, and `#widget-parking-pool`.
 * @param {any} state
 */
function applyLayoutZones(state) {
  const parking = byId('widget-parking-pool');
  const zoneMap = {
    top: byId('zone-top'),
    left: byId('zone-left'),
    right: byId('zone-right'),
    bottom: byId('zone-bottom')
  };

  const zones = state.layout?.zones || { top: [], left: ['objectives', 'todos'], right: ['weather', 'slack', 'bookmarks'], bottom: ['discovery'] };
  const placedSet = new Set();

  for (const zoneName of WIDGET_ZONES) {
    const container = zoneMap[zoneName];
    if (!container) continue;
    const orderedIds = zones[zoneName] || [];
    for (let idx = 0; idx < orderedIds.length; idx += 1) {
      const widgetId = orderedIds[idx];
      const widgetEl = document.querySelector(`[data-widget-id="${widgetId}"]`);
      if (!(widgetEl instanceof HTMLElement)) continue;
      placedSet.add(widgetId);
      const refNode = container.children[idx] || null;
      if (refNode !== widgetEl) {
        placeElementAt(container, widgetEl, refNode);
      }
    }
  }

  // Park any unplaced widgets cleanly off-stage without losing their listeners
  if (parking) {
    for (const entry of WIDGET_CATALOG) {
      if (placedSet.has(entry.id)) continue;
      const widgetEl = document.querySelector(`[data-widget-id="${entry.id}"]`);
      if (widgetEl instanceof HTMLElement && widgetEl.parentElement !== parking) {
        placeElementAt(parking, widgetEl, null);
      }
    }
  }

  renderWidgetLayoutBars(state);
}

/**
 * Render explicit reorder & zone-move controls inside each widget's `.widget-layout-bar`.
 * @param {any} state
 */
function renderWidgetLayoutBars(state) {
  const zones = state.layout?.zones || {};
  const widgetZoneLookup = new Map();
  for (const z of WIDGET_ZONES) {
    for (const id of zones[z] || []) {
      widgetZoneLookup.set(id, z);
    }
  }

  for (const entry of WIDGET_CATALOG) {
    const bar = document.querySelector(`[data-layout-bar="${entry.id}"]`);
    if (!(bar instanceof HTMLElement)) continue;
    const activeZone = widgetZoneLookup.get(entry.id);
    if (!activeZone) {
      bar.replaceChildren();
      continue;
    }

    const leftControls = document.createElement('div');
    leftControls.className = 'widget-zone-pills';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-ghost btn-sm';
    upBtn.textContent = '↑ Up';
    upBtn.title = `Move ${entry.title} up`;
    upBtn.addEventListener('click', async () => {
      await nudgeWidgetInLayout(entry.id, 'up');
      showToast(`Moved ${entry.title} up`);
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn btn-ghost btn-sm';
    downBtn.textContent = '↓ Down';
    downBtn.title = `Move ${entry.title} down`;
    downBtn.addEventListener('click', async () => {
      await nudgeWidgetInLayout(entry.id, 'down');
      showToast(`Moved ${entry.title} down`);
    });

    leftControls.append(upBtn, downBtn);

    for (const targetZone of WIDGET_ZONES) {
      const zBtn = document.createElement('button');
      zBtn.type = 'button';
      zBtn.className = activeZone === targetZone ? 'filter-pill is-active' : 'filter-pill';
      zBtn.textContent = ZONE_LABELS[targetZone];
      zBtn.disabled = activeZone === targetZone;
      zBtn.addEventListener('click', async () => {
        await moveWidgetInLayout(entry.id, targetZone);
        showToast(`Moved ${entry.title} to ${ZONE_LABELS[targetZone]}`);
      });
      leftControls.appendChild(zBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-ghost btn-sm';
    removeBtn.textContent = '× Remove';
    removeBtn.title = `Remove ${entry.title} from page (can re-add from Widget Store)`;
    removeBtn.addEventListener('click', async () => {
      await removeWidgetFromLayout(entry.id);
      showToast(`Removed ${entry.title} — re-add anytime in 🧩 Widgets`);
    });

    bar.replaceChildren(leftControls, removeBtn);
  }
}

/**
 * Render the #widget-store-modal allowing users to add, remove, or relocate any widget.
 * @param {any} state
 */
function renderWidgetStoreModal(state) {
  const filtersEl = byId('widget-store-filters');
  const gridEl = byId('widget-store-grid');
  if (!filtersEl || !gridEl) return;

  const activeIds = new Set(getActiveWidgetIds(state));
  const zones = state.layout?.zones || {};
  const zoneOf = (id) => WIDGET_ZONES.find((z) => (zones[z] || []).includes(id)) || null;

  const filterTabs = [
    { id: 'all', label: `All (${WIDGET_CATALOG.length})` },
    { id: 'active', label: `On Page (${activeIds.size})` },
    { id: 'available', label: `Available (${WIDGET_CATALOG.length - activeIds.size})` },
    { id: 'core', label: 'Core Panels' },
    { id: 'utility', label: 'Engineering & Weather' },
    { id: 'wellness', label: 'Mindful Focus' }
  ];

  const tabsFrag = document.createDocumentFragment();
  for (const tab of filterTabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = activeWidgetStoreFilter === tab.id ? 'filter-pill is-active' : 'filter-pill';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(activeWidgetStoreFilter === tab.id));
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      activeWidgetStoreFilter = tab.id;
      renderWidgetStoreModal(currentState || getStateSnapshot());
    });
    tabsFrag.appendChild(btn);
  }
  filtersEl.replaceChildren(tabsFrag);

  const filtered = WIDGET_CATALOG.filter((w) => {
    if (activeWidgetStoreFilter === 'active') return activeIds.has(w.id);
    if (activeWidgetStoreFilter === 'available') return !activeIds.has(w.id);
    if (activeWidgetStoreFilter === 'core' || activeWidgetStoreFilter === 'utility' || activeWidgetStoreFilter === 'wellness') {
      return w.category === activeWidgetStoreFilter;
    }
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No widgets match this filter.';
    gridEl.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const w of filtered) {
    const isAdded = activeIds.has(w.id);
    const currentZone = zoneOf(w.id);
    const card = document.createElement('article');
    card.className = isAdded ? 'widget-store-card is-active-widget' : 'widget-store-card';

    const topGroup = document.createElement('div');
    topGroup.className = 'objective-content';

    const titleRow = document.createElement('div');
    titleRow.className = 'card-header';

    const nameEl = document.createElement('strong');
    nameEl.textContent = `${w.icon} ${w.title}`;

    const statusBadge = document.createElement('span');
    statusBadge.className = isAdded ? 'pill-badge is-calm' : 'pill-badge';
    statusBadge.textContent = isAdded ? `✓ ${ZONE_LABELS[currentZone] || 'Active'}` : w.category;

    titleRow.append(nameEl, statusBadge);

    const descEl = document.createElement('p');
    descEl.className = 'digest-summary';
    descEl.textContent = w.description;

    topGroup.append(titleRow, descEl);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'card-header';

    const zoneSelect = document.createElement('select');
    zoneSelect.className = 'btn btn-sm';
    zoneSelect.setAttribute('aria-label', `Placement zone for ${w.title}`);
    for (const z of WIDGET_ZONES) {
      const opt = document.createElement('option');
      opt.value = z;
      opt.textContent = ZONE_LABELS[z];
      opt.selected = (currentZone || w.defaultZone) === z;
      zoneSelect.appendChild(opt);
    }
    zoneSelect.addEventListener('change', async () => {
      if (isWidgetActive(currentState || getStateSnapshot(), w.id)) {
        await moveWidgetInLayout(w.id, zoneSelect.value);
        showToast(`Moved ${w.title} to ${ZONE_LABELS[zoneSelect.value]}`);
      }
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = isAdded ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';
    toggleBtn.textContent = isAdded ? '× Remove' : '+ Add to Page';
    toggleBtn.addEventListener('click', async () => {
      if (isAdded) {
        await removeWidgetFromLayout(w.id);
        showToast(`Removed ${w.title}`);
      } else {
        await addWidgetToLayout(w.id, zoneSelect.value);
        showToast(`Added ${w.title} (${ZONE_LABELS[zoneSelect.value]})`);
        if (w.id === 'weather') {
          await refreshWeather(false);
        }
      }
    });

    bottomRow.append(zoneSelect, toggleBtn);
    card.append(topGroup, bottomRow);
    frag.appendChild(card);
  }
  gridEl.replaceChildren(frag);
}

function openWidgetStoreModal() {
  const modal = byId('widget-store-modal');
  if (!modal) return;
  renderWidgetStoreModal(currentState || getStateSnapshot());
  if (!modal.open) modal.showModal();
}

/* --------------------------------------------------------------------------
   Weather Forecast & Utility Widgets Renderers
   -------------------------------------------------------------------------- */

/**
 * Render the Weather Forecast widget from cached or fallback Open-Meteo snapshot.
 * @param {any} state
 */
function renderWeatherWidget(state) {
  const w = state.widgets?.weather || {};
  const unit = w.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const snapshot = w.cache || buildFallbackWeatherSnapshot(w, new Date());

  const cityBtn = byId('weather-city-toggle-btn');
  const unitBtn = byId('weather-unit-btn');
  const iconEl = byId('weather-current-icon');
  const tempEl = byId('weather-current-temp');
  const descEl = byId('weather-current-desc');
  const statsEl = byId('weather-stats-grid');
  const hourlyEl = byId('weather-hourly-strip');
  const dailyEl = byId('weather-daily-list');
  const presetsEl = byId('weather-preset-cities');

  if (cityBtn) {
    cityBtn.textContent = `📍 ${w.locationName || 'Select City'}`;
  }
  if (unitBtn) {
    unitBtn.textContent = unit === 'fahrenheit' ? '°F' : '°C';
  }

  if (presetsEl && presetsEl.childElementCount === 0) {
    const pFrag = document.createDocumentFragment();
    for (const preset of POPULAR_WEATHER_CITIES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-pill';
      chip.textContent = preset.locationName;
      chip.addEventListener('click', async () => {
        await updateWeatherSettings(preset);
        const panel = byId('weather-city-panel');
        if (panel) panel.hidden = true;
        await refreshWeather(true);
        showToast(`Weather set to ${preset.locationName}`);
      });
      pFrag.appendChild(chip);
    }
    presetsEl.replaceChildren(pFrag);
  }

  const cur = snapshot.current || { tempC: 28, feelsLikeC: 30, humidity: 70, windKmh: 10, weatherCode: 1, isDay: true };
  const cond = describeWmoWeather(cur.weatherCode, cur.isDay);

  if (iconEl) iconEl.textContent = cond.icon;
  if (tempEl) tempEl.textContent = formatTemp(cur.tempC, unit);
  if (descEl) {
    const statusSuffix = snapshot.isFallback ? ' · Seasonal estimate' : '';
    descEl.textContent = `${cond.label} · Feels ${formatTemp(cur.feelsLikeC, unit)}${statusSuffix}`;
  }

  if (statsEl) {
    const sFrag = document.createDocumentFragment();
    const badges = [
      `💧 ${cur.humidity ?? 65}%`,
      `💨 ${cur.windKmh ?? 10} km/h`
    ];
    if (snapshot.daily?.[0]?.uvMax !== undefined) {
      badges.push(`☀️ UV ${Math.round(snapshot.daily[0].uvMax)}`);
    }
    for (const label of badges) {
      const pill = document.createElement('span');
      pill.className = 'pill-badge';
      pill.textContent = label;
      sFrag.appendChild(pill);
    }
    statsEl.replaceChildren(sFrag);
  }

  if (hourlyEl) {
    const hFrag = document.createDocumentFragment();
    for (const slot of (snapshot.hourly || []).slice(0, 6)) {
      const cell = document.createElement('div');
      cell.className = 'weather-hour-slot';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'weather-hour-time';
      timeSpan.textContent = slot.timeLabel;

      const slotIcon = document.createElement('span');
      slotIcon.textContent = describeWmoWeather(slot.weatherCode, slot.isDay).icon;

      const slotTemp = document.createElement('span');
      slotTemp.className = 'weather-hour-temp';
      slotTemp.textContent = formatTemp(slot.tempC, unit);

      cell.append(timeSpan, slotIcon, slotTemp);
      hFrag.appendChild(cell);
    }
    hourlyEl.replaceChildren(hFrag);
  }

  if (dailyEl) {
    const dFrag = document.createDocumentFragment();
    for (const day of (snapshot.daily || []).slice(0, 5)) {
      const li = document.createElement('li');
      li.className = 'weather-day-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'weather-day-name';
      nameSpan.textContent = day.dayLabel;

      const dayIcon = document.createElement('span');
      dayIcon.textContent = describeWmoWeather(day.weatherCode, true).icon;

      const precipSpan = document.createElement('span');
      precipSpan.className = 'weather-day-precip';
      precipSpan.textContent = day.precipProb > 0 ? `☔ ${Math.round(day.precipProb)}%` : 'Dry';

      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'weather-day-temps';
      rangeSpan.textContent = `${formatTemp(day.maxTempC, unit)} / ${formatTemp(day.minTempC, unit)}`;

      li.append(nameSpan, dayIcon, precipSpan, rangeSpan);
      dFrag.appendChild(li);
    }
    dailyEl.replaceChildren(dFrag);
  }
}

/**
 * Fetch live Open-Meteo forecast and cache it in `store.js`.
 * @param {boolean} [force=false]
 */
async function refreshWeather(force = false) {
  const state = currentState || getStateSnapshot();
  if (!isWidgetActive(state, 'weather')) return;
  const btn = byId('weather-refresh-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetchWeatherForecast(state.widgets?.weather, { force });
    if (res.snapshot && !res.fromCache) {
      await updateWeatherCache(res.snapshot);
    }
  } catch {
    // Graceful fallback already rendered
  } finally {
    if (btn) btn.disabled = false;
  }
}

function formatPomoClock(totalSec) {
  const mins = Math.floor(Math.max(0, totalSec) / 60);
  const secs = Math.max(0, totalSec) % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderPomodoroWidget(state) {
  const badge = byId('pomo-sessions-badge');
  const readout = byId('pomo-clock-readout');
  const phaseLabel = byId('pomo-phase-label');
  const startBtn = byId('pomo-start-btn');

  const sessions = state.widgets?.pomodoro?.completedSessions || 0;
  if (badge) badge.textContent = `${sessions} sprint${sessions === 1 ? '' : 's'}`;
  if (readout) readout.textContent = formatPomoClock(pomoRemainingSec);
  if (phaseLabel) {
    if (pomoRunning) {
      phaseLabel.textContent = pomoMode === 'break' ? '🌿 Recharging — step back from screen' : '🧘 Deep focus in progress';
    } else {
      phaseLabel.textContent = pomoMode === 'break' ? 'Ready for 5m recharge break' : 'Ready for calm focus';
    }
  }
  if (startBtn) {
    startBtn.textContent = pomoRunning ? '⏸ Pause' : '▶ Start';
  }
}

function renderWorldClockWidget(state) {
  const listEl = byId('world-clock-list');
  const selectEl = byId('wc-timezone-select');
  if (!listEl) return;

  if (selectEl && selectEl.childElementCount === 0) {
    const optFrag = document.createDocumentFragment();
    for (const tz of PRESET_TIMEZONES) {
      const opt = document.createElement('option');
      opt.value = tz.timeZone;
      opt.textContent = `${tz.label} — ${tz.timeZone}`;
      optFrag.appendChild(opt);
    }
    selectEl.replaceChildren(optFrag);
  }

  const now = new Date();
  const clocks = state.widgets?.worldClock?.clocks || [];
  if (clocks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No world clocks added. Click "+ Add TZ" above.';
    listEl.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const clk of clocks) {
    const formatted = formatWorldClockEntry(clk.timeZone, now);
    const li = document.createElement('li');
    li.className = 'world-clock-row';

    const left = document.createElement('div');
    left.className = 'objective-content';

    const cityStrong = document.createElement('strong');
    cityStrong.style.fontSize = '0.875rem';
    cityStrong.textContent = clk.label;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'bookmark-domain';
    metaSpan.textContent = formatted.dayMeta;

    left.append(cityStrong, metaSpan);

    const right = document.createElement('div');
    right.className = 'bookmark-actions';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'world-clock-time';
    timeSpan.textContent = formatted.time;

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn-remove';
    rmBtn.textContent = '×';
    rmBtn.setAttribute('aria-label', `Remove clock ${clk.label}`);
    rmBtn.addEventListener('click', async () => {
      await removeWorldClock(clk.id);
      showToast(`Removed ${clk.label} clock`);
    });

    right.append(timeSpan, rmBtn);
    li.append(left, right);
    frag.appendChild(li);
  }
  listEl.replaceChildren(frag);
}

function renderScratchpadWidget(state) {
  const textarea = byId('scratchpad-textarea');
  const badge = byId('scratchpad-status-badge');
  const text = state.widgets?.scratchpad?.text || '';

  if (textarea instanceof HTMLTextAreaElement && document.activeElement !== textarea) {
    textarea.value = text;
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (badge) {
    badge.textContent = `${words} word${words === 1 ? '' : 's'}`;
  }
}

function renderLaunchpadWidget(state) {
  const grid = byId('launchpad-grid');
  if (!grid) return;

  const links = state.widgets?.launchpad?.links || [];
  if (links.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No shortcuts yet. Click "+ Shortcut" above.';
    grid.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const lnk of links) {
    const tile = document.createElement('div');
    tile.className = 'launchpad-tile';

    const anchor = createSafeLink(lnk.url, `${lnk.icon || '🔗'} ${lnk.label}`, 'launchpad-tile-link');
    if (anchor) {
      tile.appendChild(anchor);
    }

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn-remove';
    rmBtn.textContent = '×';
    rmBtn.setAttribute('aria-label', `Remove shortcut ${lnk.label}`);
    rmBtn.addEventListener('click', async () => {
      await removeLaunchpadLink(lnk.id);
      showToast('Shortcut removed');
    });

    tile.appendChild(rmBtn);
    frag.appendChild(tile);
  }
  grid.replaceChildren(frag);
}

function renderHabitsWidget(state) {
  const listEl = byId('habit-list');
  const badge = byId('habits-badge');
  if (!listEl) return;

  const today = state.activeDate || new Date().toISOString().slice(0, 10);
  const items = state.widgets?.habits?.items || [];
  const doneToday = items.filter((h) => (h.completedDates || []).includes(today)).length;

  if (badge) badge.textContent = `${doneToday}/${items.length} today`;

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Add a daily micro-habit below.';
    listEl.replaceChildren(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const hb of items) {
    const isDone = (hb.completedDates || []).includes(today);
    const li = document.createElement('li');
    li.className = isDone ? 'todo-item is-completed' : 'todo-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tactile-checkbox';
    checkbox.checked = isDone;
    checkbox.setAttribute('aria-label', `Toggle habit ${hb.label}`);
    checkbox.addEventListener('change', async () => {
      await toggleHabitForDate(hb.id, today);
    });

    const content = document.createElement('div');
    content.className = 'todo-content';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'todo-text';
    labelSpan.textContent = hb.label;

    const streakSpan = document.createElement('span');
    streakSpan.className = 'bookmark-read-time';
    const totalDays = (hb.completedDates || []).length;
    streakSpan.textContent = `${totalDays} day${totalDays === 1 ? '' : 's'} logged`;

    content.append(labelSpan, streakSpan);

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn-remove';
    rmBtn.textContent = '×';
    rmBtn.setAttribute('aria-label', `Remove habit ${hb.label}`);
    rmBtn.addEventListener('click', async () => {
      await removeHabitItem(hb.id);
      showToast('Habit removed');
    });

    li.append(checkbox, content, rmBtn);
    frag.appendChild(li);
  }
  listEl.replaceChildren(frag);
}

function renderTelemetryWidget(state) {
  const grid = byId('telemetry-grid');
  const modeBadge = byId('telemetry-mode-badge');
  if (!grid) return;

  if (modeBadge) {
    modeBadge.textContent = isExtensionContext() ? 'MV3 Extension' : 'Standalone PWA';
  }

  const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : 'Standard CPU';
  const conn = navigator.connection;
  const netLabel = conn
    ? `${conn.effectiveType || 'online'}${conn.downlink ? ` · ${conn.downlink} Mbps` : ''}`
    : (navigator.onLine ? 'Online' : 'Offline');
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  const viewportLabel = `${window.innerWidth}×${window.innerHeight} @${dpr}x`;
  const activeWidgetsCount = getActiveWidgetIds(state).length;
  const slackTotal = (state.slackDigest?.items || []).length;
  const rssCached = (state.rssCache?.items || []).length;

  const stats = [
    { label: 'CPU Threads', value: cores },
    { label: 'Network Link', value: netLabel },
    { label: 'Viewport / DPR', value: viewportLabel },
    { label: 'Active Widgets', value: `${activeWidgetsCount} / ${WIDGET_CATALOG.length}` },
    { label: 'Daily Digest Pool', value: `${slackTotal} items` },
    { label: 'Cached RSS Feed', value: `${rssCached} articles` }
  ];

  const frag = document.createDocumentFragment();
  for (const s of stats) {
    const box = document.createElement('div');
    box.className = 'telemetry-stat';

    const lbl = document.createElement('span');
    lbl.className = 'telemetry-label';
    lbl.textContent = s.label;

    const val = document.createElement('span');
    val.className = 'telemetry-value';
    val.textContent = s.value;

    box.append(lbl, val);
    frag.appendChild(box);
  }
  grid.replaceChildren(frag);
}

/**
 * Master UI render pass from canonical GatewayState.
 * @param {any} state
 */
function renderApp(state) {
  currentState = state;
  applyLayoutZones(state);
  renderHeaderAndMood(state);
  renderObjectives(state);
  renderTodos(state);
  renderWeatherWidget(state);
  renderSlackDigest(state);
  renderBookmarks(state);
  renderDiscoveryStream(state);
  renderPomodoroWidget(state);
  renderWorldClockWidget(state);
  renderScratchpadWidget(state);
  renderLaunchpadWidget(state);
  renderHabitsWidget(state);
  renderTelemetryWidget(state);

  const widgetStoreModal = byId('widget-store-modal');
  if (widgetStoreModal?.open) {
    renderWidgetStoreModal(state);
  }
  const bgModal = byId('bg-settings-modal');
  if (bgModal?.open) {
    renderBgSettingsModal(state);
  }
  const rssModal = byId('rss-manager-modal');
  if (rssModal?.open) {
    renderRssManagerModal(state);
  }
  const syncModal = byId('sync-settings-modal');
  if (syncModal?.open) {
    populateSyncSettingsModal(state);
  }
  const ctxModal = byId('item-context-modal');
  if (ctxModal?.open) {
    renderItemContextModal(state);
  }
}

/* --------------------------------------------------------------------------
   Command Palette (⌘K / Ctrl+K)
   -------------------------------------------------------------------------- */

/**
 * Build searchable items for the Command Palette.
 * @param {string} query
 * @param {any} state
 */
function buildCommandPaletteItems(query, state) {
  const q = query.trim().toLowerCase();

  const quickCommands = [
    {
      badge: 'Widget',
      label: 'Open Widget Store (Add / Remove Weather, Pomodoro, Clocks, Launchpad...)',
      shortcut: 'u',
      action: () => {
        openWidgetStoreModal();
      }
    },
    {
      badge: 'Layout',
      label: state.layout?.editMode ? 'Finish Rearranging Page Layout' : 'Rearrange All Components on Page',
      shortcut: 'l',
      action: async () => {
        const next = !state.layout?.editMode;
        await setLayoutEditMode(next);
        showToast(next ? 'Layout Edit Mode ON — drag ⠿ or use zone buttons' : 'Layout saved');
      }
    },
    {
      badge: 'Wallpaper',
      label: 'Configure Nerdy Daily Wallpaper & Time-of-Day Mood',
      shortcut: 'g',
      action: () => {
        openBgSettingsModal();
      }
    },
    {
      badge: 'Wallpaper',
      label: 'Shuffle Random Nerdy Wallpaper Now',
      shortcut: '🎲',
      action: async () => {
        await shuffleDailyBackground();
        showToast('Rolled a new nerdy wallpaper');
      }
    },
    {
      badge: 'Digest',
      label: state.wellness?.slackExpanded
        ? `Collapse Digest Feed to ${SLACK_COLLAPSED_LIMIT} Items`
        : 'Expand Full Daily Digest Feed',
      shortcut: '💬',
      action: async () => {
        await updatePreferences({ slackExpanded: !state.wellness?.slackExpanded });
      }
    },
    {
      badge: 'Cmd',
      label: state.wellness?.focusMode ? 'Turn OFF Deep-Work Focus Mode' : 'Turn ON Deep-Work Focus Mode',
      shortcut: 'f',
      action: async () => {
        await updatePreferences({ focusMode: !state.wellness?.focusMode });
      }
    },
    {
      badge: 'Cmd',
      label: 'Cycle Circadian Mood (Auto / Morning / Deep Work / Evening)',
      shortcut: 'm',
      action: async () => {
        await cycleCircadianMood();
      }
    },
    {
      badge: 'Cmd',
      label: 'Start 60s Mindful Breathing (4-4-6)',
      shortcut: 'w',
      action: () => {
        openBreathingModal();
      }
    },
    {
      badge: 'Cmd',
      label: 'Manage RSS Sources',
      shortcut: 'r',
      action: () => {
        openRssManagerModal();
      }
    },
    {
      badge: 'Cmd',
      label: 'Open Sync & Gateway Settings',
      shortcut: '⚙️',
      action: () => {
        openSyncSettingsModal();
      }
    },
    {
      badge: 'Cmd',
      label: 'Open Welcome / Profile Setup Wizard',
      shortcut: '👋',
      action: () => {
        openOnboardingModal();
      }
    },
    {
      badge: 'Cmd',
      label: 'Refresh Discovery RSS Feeds Now',
      shortcut: '🔄',
      action: async () => {
        await handleRefreshRss();
      }
    },
    {
      badge: 'Cmd',
      label: 'Wrap Up Day & Rollover Remaining Tasks',
      shortcut: '🍵',
      action: async () => {
        await handleRolloverDay();
      }
    }
  ];

  const items = [];
  for (const cmd of quickCommands) {
    items.push(cmd);
  }

  for (const obj of state.objectives || []) {
    items.push({
      badge: 'Objective',
      label: obj.title,
      url: obj.url,
      shortcut: obj.url ? '↗' : (obj.completed ? '✓' : '○'),
      action: obj.url
        ? () => openSafeExternalUrl(obj.url)
        : async () => {
          await toggleObjective(obj.id);
        }
    });
  }

  for (const todo of state.todos || []) {
    items.push({
      badge: 'TODO',
      label: todo.text,
      url: todo.sourceUrl,
      shortcut: todo.sourceUrl ? '↗' : (todo.completed ? '✓' : '□'),
      action: todo.sourceUrl
        ? () => openSafeExternalUrl(todo.sourceUrl)
        : async () => {
          await toggleTodo(todo.id);
        }
    });
  }

  for (const slack of state.slackDigest?.items || []) {
    items.push({
      badge: slack.channel || 'Slack',
      label: slack.headline,
      url: slack.url,
      shortcut: slack.url ? '↗' : '+TODO',
      action: slack.url
        ? () => openSafeExternalUrl(slack.url)
        : async () => {
          await promoteSlackToTodo(slack.id);
          showToast('Added to Today\'s TODOs');
        }
    });
  }

  for (const bm of state.bookmarks || []) {
    items.push({
      badge: 'Bookmark',
      label: `${bm.title} (${bm.domain || 'link'})`,
      url: bm.url,
      shortcut: '↗',
      action: () => openSafeExternalUrl(bm.url)
    });
  }

  const fallbackArticles = (state.rssCache?.items || []).length > 0
    ? state.rssCache.items
    : getCuratedFallbackArticles(state.rssSources);

  for (const article of fallbackArticles) {
    items.push({
      badge: article.sourceName || 'RSS',
      label: article.title,
      url: article.url,
      shortcut: '↗',
      action: () => openSafeExternalUrl(article.url)
    });
  }

  if (!q) {
    return items.slice(0, 14);
  }

  return items
    .filter((item) => item.label.toLowerCase().includes(q) || item.badge.toLowerCase().includes(q))
    .slice(0, 16);
}

/**
 * Render filtered Command Palette results list.
 */
function renderCommandPaletteList() {
  const listEl = byId('cmd-palette-list');
  const inputEl = byId('cmd-palette-input');
  if (!listEl || !inputEl) return;

  cmdResults = buildCommandPaletteItems(inputEl.value, currentState || getStateSnapshot());
  if (cmdActiveIndex >= cmdResults.length) {
    cmdActiveIndex = Math.max(0, cmdResults.length - 1);
  }

  if (cmdResults.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No matching bookmarks, tasks, digest items, RSS articles, or commands.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  cmdResults.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = index === cmdActiveIndex ? 'cmd-palette-item is-active' : 'cmd-palette-item';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(index === cmdActiveIndex));

    const left = document.createElement('span');
    left.className = 'wellness-pill-text';

    const badge = document.createElement('span');
    badge.className = 'pill-badge';
    badge.textContent = item.badge;

    const label = document.createElement('span');
    label.textContent = item.label;

    left.append(badge, label);

    const shortcut = document.createElement('span');
    shortcut.className = 'cmd-shortcut';
    shortcut.textContent = item.shortcut;

    btn.append(left, shortcut);
    btn.addEventListener('click', async () => {
      await executeCommandPaletteItem(index);
    });

    fragment.appendChild(btn);
  });

  listEl.replaceChildren(fragment);
}

/**
 * Execute a selected Command Palette result and close the dialog.
 * @param {number} index
 */
async function executeCommandPaletteItem(index) {
  const item = cmdResults[index];
  const modal = byId('cmd-palette-modal');
  if (!item) return;

  if (modal?.open) {
    modal.close();
  }
  if (item.url) {
    openSafeExternalUrl(item.url);
    return;
  }
  if (typeof item.action === 'function') {
    await item.action();
  }
}

function openCommandPaletteModal() {
  const modal = byId('cmd-palette-modal');
  const input = byId('cmd-palette-input');
  if (!modal) return;
  cmdActiveIndex = 0;
  if (input) input.value = '';
  renderCommandPaletteList();
  if (!modal.open) {
    modal.showModal();
  }
  input?.focus();
}

function openRssManagerModal() {
  const modal = byId('rss-manager-modal');
  if (!modal) return;
  renderRssManagerModal(currentState || getStateSnapshot());
  if (!modal.open) {
    modal.showModal();
  }
}

function openSyncSettingsModal() {
  const modal = byId('sync-settings-modal');
  if (!modal) return;
  populateSyncSettingsModal(currentState || getStateSnapshot());
  if (!modal.open) {
    modal.showModal();
  }
}

/* --------------------------------------------------------------------------
   60s Guided Breathing Modal (4-4-6)
   -------------------------------------------------------------------------- */

function stopBreathingTimer() {
  if (breathingIntervalId !== null) {
    window.clearInterval(breathingIntervalId);
    breathingIntervalId = null;
  }
}

function updateBreathingVisual() {
  const orb = byId('breathing-orb');
  const countdown = byId('breathing-countdown');
  const phaseLabel = byId('breathing-phase-label');
  const totalLabel = byId('breathing-total-label');
  const progressFill = byId('breathing-progress-fill');

  const elapsed = Math.max(0, Date.now() - breathingStartMs);
  const status = getBreathingPhaseAtElapsedMs(elapsed, BREATHING_DURATION_MS);

  if (orb) {
    orb.classList.remove('phase-inhale', 'phase-hold', 'phase-exhale', 'phase-complete');
    orb.classList.add(`phase-${status.phase}`);
  }
  if (countdown) {
    countdown.textContent = status.done ? '✓' : `${status.secondsRemainingInPhase}s`;
  }
  if (phaseLabel) {
    phaseLabel.textContent = status.label;
  }
  if (totalLabel) {
    const remainingTotalSec = Math.max(0, Math.ceil((BREATHING_DURATION_MS - elapsed) / 1000));
    totalLabel.textContent = status.done
      ? '60s breathing session complete'
      : `${remainingTotalSec}s remaining · 4s inhale · 4s hold · 6s exhale`;
  }
  if (progressFill) {
    progressFill.style.width = `${Math.round(status.progressRatio * 100)}%`;
  }

  if (status.done) {
    stopBreathingTimer();
    if (!breathingAutoLogged) {
      breathingAutoLogged = true;
      (async () => {
        await recordBreakTaken();
        showToast('60s breathing complete — break logged');
      })();
    }
  }
}

function openBreathingModal() {
  const modal = byId('breathing-modal');
  if (!modal) return;
  stopBreathingTimer();
  breathingStartMs = Date.now();
  breathingAutoLogged = false;
  updateBreathingVisual();
  if (!modal.open) {
    modal.showModal();
  }
  breathingIntervalId = window.setInterval(updateBreathingVisual, 200);
}

/* --------------------------------------------------------------------------
   Shared Action Handlers
   -------------------------------------------------------------------------- */

async function cycleCircadianMood() {
  const state = currentState || getStateSnapshot();
  const current = state.wellness?.moodOverride || 'auto';
  const next = MOOD_CYCLE[(MOOD_CYCLE.indexOf(current) + 1) % MOOD_CYCLE.length];
  await updatePreferences({ moodOverride: next });
  showToast(`Mood set to ${next}`);
}

async function handleSyncTrigger() {
  const state = currentState || getStateSnapshot();
  if (!state.sync?.githubPat) {
    openSyncSettingsModal();
    return;
  }

  let result = null;
  if (isExtensionContext()) {
    try {
      result = await globalThis.chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
    } catch {
      result = null;
    }
  }

  if (!result || !result.status) {
    result = await syncWithGist();
  }

  if (result.status === 'synced') {
    showToast('Synced with Private GitHub Gist');
  } else if (result.status === 'local-only') {
    openSyncSettingsModal();
  } else {
    showToast(result.error || 'Sync error — check Gist settings');
  }
}

async function handleRefreshRss() {
  const btn = byId('rss-refresh-btn');
  if (btn) btn.disabled = true;
  try {
    const result = await refreshRssFeeds({ force: true });
    showToast(result.usedFallback ? 'Loaded curated fallback articles' : 'Discovery stream refreshed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleRolloverDay() {
  const summary = await rolloverDay();
  showToast(
    `Day rolled over: ${summary.completedObjectives} objectives & ` +
    `${summary.completedTodos} TODOs archived · ${summary.carriedOverTodos} carried forward`
  );
}

/* --------------------------------------------------------------------------
   Event Wiring & Initialization
   -------------------------------------------------------------------------- */

function bindEvents() {
  // Focus Theme Inline Edit
  const themeDisplay = byId('focus-theme-display');
  const themeForm = byId('focus-theme-form');
  const themeInput = byId('focus-theme-input');
  const themeCancel = byId('focus-theme-cancel-btn');

  const enterThemeEdit = () => {
    isEditingFocusTheme = true;
    if (themeInput) {
      themeInput.value = currentState?.focusTheme || 'Clarity over volume.';
    }
    renderHeaderAndMood(currentState || getStateSnapshot());
    themeInput?.focus();
    themeInput?.select();
  };

  themeDisplay?.addEventListener('click', enterThemeEdit);
  themeDisplay?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      enterThemeEdit();
    }
  });

  themeCancel?.addEventListener('click', () => {
    isEditingFocusTheme = false;
    renderHeaderAndMood(currentState || getStateSnapshot());
  });

  themeForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nextTheme = themeInput?.value.trim() || '';
    isEditingFocusTheme = false;
    if (nextTheme) {
      await updatePreferences({ focusTheme: nextTheme });
      showToast('Focus motto updated');
    } else {
      renderHeaderAndMood(currentState || getStateSnapshot());
    }
  });

  // Wellness Pill Actions
  byId('wellness-done-btn')?.addEventListener('click', async () => {
    const nextState = await recordBreakTaken();
    const pill = byId('wellness-pill');
    if (pill) {
      pill.classList.add('is-celebrating');
      window.setTimeout(() => {
        pill.classList.remove('is-celebrating');
      }, 650);
    }
    showToast(`Mindful break logged (${nextState.wellness?.breaksToday || 1} today)`);
  });

  byId('wellness-breathe-btn')?.addEventListener('click', openBreathingModal);
  byId('evening-breathe-btn')?.addEventListener('click', openBreathingModal);
  byId('evening-rollover-btn')?.addEventListener('click', async () => {
    await handleRolloverDay();
  });

  // Header Controls
  byId('cmd-palette-btn')?.addEventListener('click', openCommandPaletteModal);

  byId('mood-select')?.addEventListener('change', async (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement) {
      await updatePreferences({ moodOverride: target.value });
    }
  });

  byId('theme-toggle-btn')?.addEventListener('click', async () => {
    const current = currentState?.wellness?.colorScheme || 'auto';
    const next = SCHEME_CYCLE[(SCHEME_CYCLE.indexOf(current) + 1) % SCHEME_CYCLE.length];
    await updatePreferences({ colorScheme: next });
    showToast(`Color scheme: ${next}`);
  });

  byId('focus-mode-btn')?.addEventListener('click', async () => {
    const nextFocus = !currentState?.wellness?.focusMode;
    await updatePreferences({ focusMode: nextFocus });
    showToast(nextFocus ? 'Deep-Work Focus Mode ON' : 'Focus Mode OFF');
  });

  byId('sync-status-btn')?.addEventListener('click', async () => {
    await handleSyncTrigger();
  });

  byId('settings-btn')?.addEventListener('click', openSyncSettingsModal);

  // Objectives Form
  byId('objective-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('objective-input');
    const raw = input?.value.trim() || '';
    if (!raw) return;
    try {
      await addObjective(raw);
      if (input) input.value = '';
      showToast('Objective added');
    } catch (err) {
      showToast(err?.message || 'Unable to add objective');
    }
  });

  // Tactical TODOs Form & Footer Actions
  byId('todo-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('todo-input');
    const raw = input?.value.trim() || '';
    if (!raw) return;
    try {
      await addTodo(raw);
      if (input) input.value = '';
    } catch (err) {
      showToast(err?.message || 'Unable to add TODO');
    }
  });

  byId('clear-completed-todos-btn')?.addEventListener('click', async () => {
    await clearCompletedTodos();
    showToast('Completed TODOs archived');
  });

  byId('rollover-day-btn')?.addEventListener('click', async () => {
    await handleRolloverDay();
  });

  // Slack Digest Inline Add Form
  const slackToggleBtn = byId('slack-toggle-add-btn');
  const slackForm = byId('slack-add-form');
  const slackCancelBtn = byId('slack-cancel-add-btn');

  slackToggleBtn?.addEventListener('click', () => {
    if (!slackForm) return;
    const willShow = slackForm.hidden;
    slackForm.hidden = !willShow;
    slackToggleBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      byId('slack-channel-input')?.focus();
    }
  });

  slackCancelBtn?.addEventListener('click', () => {
    if (!slackForm) return;
    slackForm.hidden = true;
    slackToggleBtn?.setAttribute('aria-expanded', 'false');
  });

  slackForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const channel = byId('slack-channel-input')?.value.trim() || '#general';
    const badge = byId('slack-badge-input')?.value.trim() || '';
    const headline = byId('slack-headline-input')?.value.trim() || '';
    const summary = byId('slack-summary-input')?.value.trim() || '';
    const url = byId('slack-url-input')?.value.trim() || '';

    if (!headline && !summary) {
      showToast('Enter a headline or summary');
      return;
    }

    try {
      await addSlackItem({ channel, badge, headline, summary, url });
      slackForm.reset();
      slackForm.hidden = true;
      slackToggleBtn?.setAttribute('aria-expanded', 'false');
      showToast('Digest item added');
    } catch (err) {
      showToast(err?.message || 'Unable to add digest item');
    }
  });

  // Reading Queue Quick Bookmark Form
  byId('bookmark-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('bookmark-input');
    const raw = input?.value.trim() || '';
    if (!raw) return;

    const added = await addBookmark(raw);
    if (!added) {
      showToast('Please enter a valid http(s):// URL');
      return;
    }
    if (input) input.value = '';
    showToast('Saved to Reading Queue');
  });

  // Discovery Stream Actions
  byId('rss-refresh-btn')?.addEventListener('click', async () => {
    await handleRefreshRss();
  });

  byId('rss-manage-btn')?.addEventListener('click', openRssManagerModal);

  byId('rss-collapse-btn')?.addEventListener('click', async () => {
    const nextCollapsed = !currentState?.wellness?.rssCollapsed;
    await updatePreferences({ rssCollapsed: nextCollapsed });
  });

  // Mobile Bottom Tab Bar
  const mobileTabButtons = document.querySelectorAll('.mobile-tab-btn');
  for (const btn of mobileTabButtons) {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab') || 'focus';
      setActiveMobileTab(targetTab);
    });
  }

  // Modal Close Buttons & Light-Dismiss Backdrop Fallback (modern-web-guidance)
  const closeButtons = document.querySelectorAll('[data-close-modal]');
  for (const btn of closeButtons) {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      const modal = modalId ? byId(modalId) : null;
      if (modal instanceof HTMLDialogElement && modal.open) {
        modal.close();
      }
    });
  }

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const dialogs = document.querySelectorAll('dialog.gateway-modal');
    for (const dialog of dialogs) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog || !dialog.open) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY
          && event.clientY <= rect.top + rect.height
          && rect.left <= event.clientX
          && event.clientX <= rect.left + rect.width
        );
        if (!isDialogContent) {
          dialog.close();
        }
      });
    }
  }

  // Slack Feed Expand / Collapse (Default 10 Items + Full Card Body Collapse)
  byId('slack-expand-btn')?.addEventListener('click', async () => {
    const nextExpanded = !currentState?.wellness?.slackExpanded;
    await updatePreferences({ slackExpanded: nextExpanded });
  });

  byId('slack-body-collapse-btn')?.addEventListener('click', async () => {
    const nextCollapsed = !currentState?.wellness?.slackPanelCollapsed;
    await updatePreferences({ slackPanelCollapsed: nextCollapsed });
  });

  // Widget Store, Layout Customization & Wallpaper Studio Header/Banner Controls
  byId('widget-store-btn')?.addEventListener('click', openWidgetStoreModal);
  byId('layout-open-store-btn')?.addEventListener('click', openWidgetStoreModal);

  byId('layout-edit-btn')?.addEventListener('click', async () => {
    const next = !currentState?.layout?.editMode;
    await setLayoutEditMode(next);
    showToast(next ? 'Layout Edit Mode ON — drag ⠿ or click zone pills' : 'Layout saved');
  });

  byId('layout-done-btn')?.addEventListener('click', async () => {
    await setLayoutEditMode(false);
    showToast('Layout locked');
  });

  const handleResetLayout = async () => {
    await resetDashboardLayout();
    showToast('Restored default component layout');
  };
  byId('layout-reset-btn')?.addEventListener('click', handleResetLayout);
  byId('widget-store-reset-btn')?.addEventListener('click', handleResetLayout);

  byId('widget-store-customize-btn')?.addEventListener('click', async () => {
    const modal = byId('widget-store-modal');
    if (modal instanceof HTMLDialogElement && modal.open) modal.close();
    await setLayoutEditMode(true);
    showToast('Layout Edit Mode ON');
  });

  byId('bg-settings-btn')?.addEventListener('click', openBgSettingsModal);
  byId('bg-quick-config-btn')?.addEventListener('click', openBgSettingsModal);

  const handleShuffleBg = async () => {
    await shuffleDailyBackground();
    const resolved = resolveActiveBackground(
      (currentState || getStateSnapshot()).background,
      new Date(),
      currentState?.wellness?.moodOverride || 'auto'
    );
    showToast(`Wallpaper: ${resolved.item?.name || 'Updated'}`);
  };
  byId('bg-quick-shuffle-btn')?.addEventListener('click', handleShuffleBg);
  byId('bg-modal-shuffle-btn')?.addEventListener('click', handleShuffleBg);

  byId('bg-mode-select')?.addEventListener('change', async (event) => {
    const sel = event.target;
    if (sel instanceof HTMLSelectElement) {
      await updateBackgroundSettings({ mode: sel.value });
    }
  });

  byId('bg-mood-sync-select')?.addEventListener('change', async (event) => {
    const sel = event.target;
    if (sel instanceof HTMLSelectElement) {
      await updateBackgroundSettings({ moodSync: sel.value });
    }
  });

  byId('bg-opacity-range')?.addEventListener('input', async (event) => {
    const inp = event.target;
    if (inp instanceof HTMLInputElement) {
      const ratio = Math.min(0.9, Math.max(0.1, Number(inp.value) / 100));
      await updateBackgroundSettings({ opacity: ratio });
    }
  });

  byId('bg-blur-range')?.addEventListener('input', async (event) => {
    const inp = event.target;
    if (inp instanceof HTMLInputElement) {
      await updateBackgroundSettings({ blurPx: Number(inp.value) });
    }
  });

  byId('bg-glass-checkbox')?.addEventListener('change', async (event) => {
    const inp = event.target;
    if (inp instanceof HTMLInputElement) {
      await updateBackgroundSettings({ glassCards: inp.checked });
    }
  });

  byId('bg-custom-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nameInp = byId('bg-custom-name-input');
    const urlInp = byId('bg-custom-url-input');
    const pxCheck = byId('bg-custom-pixel-checkbox');
    const name = nameInp?.value.trim() || '';
    const url = urlInp?.value.trim() || '';
    const isPixelArt = Boolean(pxCheck instanceof HTMLInputElement && pxCheck.checked);

    try {
      const added = await addCustomBackgroundImage({ name, url, isPixelArt });
      await updateBackgroundSettings({ mode: 'pinned', pinnedId: added.id });
      byId('bg-custom-add-form')?.reset();
      showToast(`Added & pinned wallpaper: ${added.name}`);
    } catch (err) {
      showToast(err?.message || 'Enter a valid https:// image URL');
    }
  });

  // Weather Forecast Widget Controls
  byId('weather-city-toggle-btn')?.addEventListener('click', () => {
    const panel = byId('weather-city-panel');
    const btn = byId('weather-city-toggle-btn');
    if (!panel) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    btn?.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      byId('weather-city-input')?.focus();
    }
  });

  byId('weather-unit-btn')?.addEventListener('click', async () => {
    const curUnit = currentState?.widgets?.weather?.unit || 'celsius';
    const nextUnit = curUnit === 'celsius' ? 'fahrenheit' : 'celsius';
    await updateWeatherSettings({ unit: nextUnit });
  });

  byId('weather-refresh-btn')?.addEventListener('click', async () => {
    await refreshWeather(true);
    showToast('Weather forecast updated');
  });

  byId('weather-search-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('weather-city-input');
    const resultsEl = byId('weather-search-results');
    const q = input?.value.trim() || '';
    if (!q || !resultsEl) return;

    const matches = await searchWeatherLocations(q);
    if (matches.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No matching cities found. Try another city name.';
      resultsEl.replaceChildren(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const loc of matches) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmd-palette-item';
      const sub = [loc.admin1, loc.country].filter(Boolean).join(', ');
      btn.textContent = `📍 ${loc.locationName}${sub ? ` — ${sub}` : ''}`;
      btn.addEventListener('click', async () => {
        await updateWeatherSettings({
          locationName: loc.locationName,
          country: loc.country,
          latitude: loc.latitude,
          longitude: loc.longitude,
          timezone: loc.timezone
        });
        resultsEl.replaceChildren();
        const panel = byId('weather-city-panel');
        if (panel) panel.hidden = true;
        await refreshWeather(true);
        showToast(`Weather set to ${loc.locationName}`);
      });
      li.appendChild(btn);
      frag.appendChild(li);
    }
    resultsEl.replaceChildren(frag);
  });

  byId('weather-geo-btn')?.addEventListener('click', async () => {
    if (!navigator.geolocation) {
      showToast('Browser geolocation unavailable');
      return;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000 });
      });
      await updateWeatherSettings({
        locationName: 'Current Location',
        country: '',
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      });
      const panel = byId('weather-city-panel');
      if (panel) panel.hidden = true;
      await refreshWeather(true);
      showToast('Weather updated to your current coordinates');
    } catch {
      showToast('Location permission declined — select a city above');
    }
  });

  // Pomodoro Timer Widget Controls
  const pomoPresetEl = byId('pomo-preset-pills');
  pomoPresetEl?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('[data-pomo-mins]');
    if (!(btn instanceof HTMLElement)) return;
    const mins = Number(btn.getAttribute('data-pomo-mins')) || 25;
    pomoMode = btn.getAttribute('data-pomo-mode') === 'break' ? 'break' : 'focus';
    pomoDurationSec = mins * 60;
    pomoRemainingSec = pomoDurationSec;
    if (pomoIntervalId !== null) {
      window.clearInterval(pomoIntervalId);
      pomoIntervalId = null;
    }
    pomoRunning = false;
    for (const pill of pomoPresetEl.querySelectorAll('.filter-pill')) {
      pill.classList.toggle('is-active', pill === btn);
    }
    renderPomodoroWidget(currentState || getStateSnapshot());
  });

  byId('pomo-start-btn')?.addEventListener('click', () => {
    if (pomoRunning) {
      pomoRunning = false;
      if (pomoIntervalId !== null) {
        window.clearInterval(pomoIntervalId);
        pomoIntervalId = null;
      }
      renderPomodoroWidget(currentState || getStateSnapshot());
      return;
    }

    pomoRunning = true;
    renderPomodoroWidget(currentState || getStateSnapshot());
    pomoIntervalId = window.setInterval(async () => {
      pomoRemainingSec = Math.max(0, pomoRemainingSec - 1);
      renderPomodoroWidget(currentState || getStateSnapshot());
      if (pomoRemainingSec <= 0) {
        pomoRunning = false;
        if (pomoIntervalId !== null) {
          window.clearInterval(pomoIntervalId);
          pomoIntervalId = null;
        }
        if (pomoMode === 'focus') {
          const prev = currentState?.widgets?.pomodoro?.completedSessions || 0;
          await updatePomodoroSettings({ completedSessions: prev + 1 });
          showToast('Sprint complete! Take a 5m mindful stretch break');
        } else {
          await recordBreakTaken();
          showToast('Recharge break complete — logged to today\'s breaks');
        }
        pomoRemainingSec = pomoDurationSec;
        renderPomodoroWidget(currentState || getStateSnapshot());
      }
    }, 1000);
  });

  byId('pomo-reset-btn')?.addEventListener('click', () => {
    pomoRunning = false;
    if (pomoIntervalId !== null) {
      window.clearInterval(pomoIntervalId);
      pomoIntervalId = null;
    }
    pomoRemainingSec = pomoDurationSec;
    renderPomodoroWidget(currentState || getStateSnapshot());
  });

  // World Clocks Widget Controls
  byId('wc-toggle-add-btn')?.addEventListener('click', () => {
    const form = byId('wc-add-form');
    const btn = byId('wc-toggle-add-btn');
    if (!form) return;
    form.hidden = !form.hidden;
    btn?.setAttribute('aria-expanded', String(!form.hidden));
  });

  byId('wc-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sel = byId('wc-timezone-select');
    if (!(sel instanceof HTMLSelectElement)) return;
    const tz = sel.value;
    const preset = PRESET_TIMEZONES.find((p) => p.timeZone === tz);
    try {
      await addWorldClock({ label: preset ? preset.label : tz, timeZone: tz });
      const form = byId('wc-add-form');
      if (form) form.hidden = true;
      showToast('World clock added');
    } catch (err) {
      showToast(err?.message || 'Unable to add clock');
    }
  });

  // Quick Scratchpad Auto-Save & Clear
  byId('scratchpad-textarea')?.addEventListener('input', (event) => {
    const inp = event.target;
    if (!(inp instanceof HTMLTextAreaElement)) return;
    const text = inp.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const badge = byId('scratchpad-status-badge');
    if (badge) badge.textContent = `${words} word${words === 1 ? '' : 's'}`;
    if (scratchpadSaveTimer !== null) {
      window.clearTimeout(scratchpadSaveTimer);
    }
    scratchpadSaveTimer = window.setTimeout(async () => {
      await updateScratchpad(text);
    }, 320);
  });

  byId('scratchpad-clear-btn')?.addEventListener('click', async () => {
    const inp = byId('scratchpad-textarea');
    if (inp instanceof HTMLTextAreaElement) inp.value = '';
    await updateScratchpad('');
    showToast('Scratchpad cleared');
  });

  // Quick Dev Launchpad Controls
  byId('lp-toggle-add-btn')?.addEventListener('click', () => {
    const form = byId('lp-add-form');
    const btn = byId('lp-toggle-add-btn');
    if (!form) return;
    form.hidden = !form.hidden;
    btn?.setAttribute('aria-expanded', String(!form.hidden));
  });

  byId('lp-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const icon = byId('lp-icon-input')?.value.trim() || '🔗';
    const label = byId('lp-label-input')?.value.trim() || '';
    const url = byId('lp-url-input')?.value.trim() || '';
    try {
      await addLaunchpadLink({ label, url, icon });
      byId('lp-add-form')?.reset();
      const form = byId('lp-add-form');
      if (form) form.hidden = true;
      showToast('Launchpad shortcut added');
    } catch (err) {
      showToast(err?.message || 'Enter a valid http(s):// or obsidian:// URL');
    }
  });

  // Daily Micro-Habits Form
  byId('habit-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const inp = byId('habit-input');
    const val = inp?.value.trim() || '';
    if (!val) return;
    try {
      await addHabitItem(val);
      if (inp) inp.value = '';
      showToast('Micro-habit added');
    } catch (err) {
      showToast(err?.message || 'Unable to add habit');
    }
  });

  // Pointer Drag-and-Drop & Keyboard Grab-Move-Drop Across All 4 Zones
  bindWidgetDragAndDrop();

  // Command Palette Input & Keyboard Navigation
  const cmdInput = byId('cmd-palette-input');
  cmdInput?.addEventListener('input', () => {
    cmdActiveIndex = 0;
    renderCommandPaletteList();
  });

  cmdInput?.addEventListener('keydown', async (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (cmdResults.length > 0) {
        cmdActiveIndex = (cmdActiveIndex + 1) % cmdResults.length;
        renderCommandPaletteList();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (cmdResults.length > 0) {
        cmdActiveIndex = (cmdActiveIndex - 1 + cmdResults.length) % cmdResults.length;
        renderCommandPaletteList();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      await executeCommandPaletteItem(cmdActiveIndex);
    }
  });

  // Manage RSS Sources: Starter Packs, OPML/JSON Import & Export, and Add Form
  byId('rss-restore-pack-btn')?.addEventListener('click', async () => {
    await applyRssPresetPack('ai-web');
    showToast('Restored AI & Web Engineering starter pack');
    await refreshRssFeeds({ force: true });
  });

  byId('rss-clear-pack-btn')?.addEventListener('click', async () => {
    await applyRssPresetPack('minimal');
    showToast('Cleared all RSS sources');
  });

  byId('rss-export-opml-btn')?.addEventListener('click', () => {
    const state = currentState || getStateSnapshot();
    const opml = exportRssSourcesOpml(state.rssSources || []);
    const blob = new Blob([opml], { type: 'text/x-opml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `calm-gateway-feeds-${state.activeDate || 'opml'}.opml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Exported RSS sources as OPML');
  });

  const opmlPasteForm = byId('rss-opml-paste-form');
  const opmlPasteToggleBtn = byId('rss-toggle-opml-paste-btn');
  opmlPasteToggleBtn?.addEventListener('click', () => {
    if (!opmlPasteForm) return;
    const willShow = opmlPasteForm.hidden;
    opmlPasteForm.hidden = !willShow;
    opmlPasteToggleBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      byId('rss-opml-paste-textarea')?.focus();
    }
  });

  byId('rss-opml-paste-cancel-btn')?.addEventListener('click', () => {
    if (!opmlPasteForm) return;
    opmlPasteForm.hidden = true;
    opmlPasteToggleBtn?.setAttribute('aria-expanded', 'false');
  });

  opmlPasteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = byId('rss-opml-paste-textarea');
    const modeSelect = byId('rss-opml-mode-select');
    const raw = textarea?.value.trim() || '';
    const mode = modeSelect?.value === 'replace' ? 'replace' : 'merge';
    if (!raw) {
      showToast('Paste OPML XML or JSON feed list first');
      return;
    }

    const parsed = parseRssSourcesOpmlOrJson(raw);
    let permissionPromise = null;
    if (parsed.length > 0 && typeof globalThis.chrome?.permissions?.request === 'function') {
      try {
        const origins = [...new Set(parsed.map((f) => `${new URL(f.xmlUrl).origin}/*`))];
        if (origins.length > 0) {
          permissionPromise = globalThis.chrome.permissions.request({ origins });
        }
      } catch {
        permissionPromise = null;
      }
    }

    if (permissionPromise) {
      try {
        await permissionPromise;
      } catch {
        // Optional permission dismissed or covered; continue safely
      }
    }

    try {
      const res = await importRssSourcesOpml(raw, { mode });
      if (textarea) textarea.value = '';
      opmlPasteForm.hidden = true;
      opmlPasteToggleBtn?.setAttribute('aria-expanded', 'false');
      showToast(`Imported ${res.importedCount} feed${res.importedCount === 1 ? '' : 's'} (${res.skippedCount} skipped)`);
      await refreshRssFeeds({ force: true });
    } catch (err) {
      showToast(err?.message || 'Unable to import OPML/JSON feeds');
    }
  });

  byId('rss-import-opml-file-btn')?.addEventListener('click', () => {
    byId('rss-import-opml-input')?.click();
  });

  byId('rss-import-opml-input')?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const rawText = await file.text();
      const res = await importRssSourcesOpml(rawText, { mode: 'merge' });
      showToast(`Imported ${res.importedCount} feed${res.importedCount === 1 ? '' : 's'} (${res.skippedCount} skipped)`);
      await refreshRssFeeds({ force: true });
    } catch (err) {
      showToast(err?.message || 'Invalid OPML or JSON feed file');
    } finally {
      input.value = '';
    }
  });

  // Manage RSS Sources Add Form (synchronously request optional host permission before awaiting)
  byId('rss-add-source-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nameInput = byId('rss-source-name');
    const xmlInput = byId('rss-source-xml-url');
    const siteInput = byId('rss-source-site-url');
    const categoryInput = byId('rss-source-category');

    const name = nameInput?.value.trim() || '';
    const cleanXmlUrl = sanitizeHttpUrl(xmlInput?.value.trim() || '', false);
    const siteUrl = siteInput?.value.trim() || '';
    const category = categoryInput?.value.trim() || 'general';

    if (!cleanXmlUrl) {
      showToast('Enter a valid http(s):// RSS/Atom XML URL');
      return;
    }

    // Request Chrome optional origin permission synchronously inside click/submit user gesture
    let permissionPromise = null;
    if (typeof globalThis.chrome?.permissions?.request === 'function') {
      try {
        const originPattern = `${new URL(cleanXmlUrl).origin}/*`;
        permissionPromise = globalThis.chrome.permissions.request({ origins: [originPattern] });
      } catch {
        permissionPromise = null;
      }
    }

    if (permissionPromise) {
      try {
        await permissionPromise;
      } catch {
        // Permission prompt dismissed or already covered; continue safely
      }
    }

    try {
      const added = await addRssSource({ name, xmlUrl: cleanXmlUrl, siteUrl, category });
      byId('rss-add-source-form')?.reset();
      showToast(`Added RSS source: ${added.name}`);
      await refreshRssFeeds({ force: true });
    } catch (err) {
      showToast(err?.message || 'Unable to add RSS source');
    }
  });

  // Sync Settings Modal Form, Digest Config, Workspace Presets, Copy PWA URL, Export & Import JSON
  byId('sync-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userName = byId('settings-user-name')?.value.trim() || '';
    const githubPat = byId('sync-github-pat')?.value.trim() || '';
    const gistId = byId('sync-gist-id')?.value.trim() || '';

    await updatePreferences({ userName });
    await saveSyncCredentials({ gistId, githubPat });

    if (!githubPat) {
      showToast('Settings saved locally (add a GitHub PAT to enable Gist sync)');
      return;
    }

    const syncBtn = byId('sync-now-modal-btn');
    if (syncBtn) syncBtn.disabled = true;
    try {
      const result = await syncWithGist();
      populateSyncSettingsModal(result.state);
      if (result.status === 'synced') {
        showToast('Private Gist synced successfully');
      } else {
        showToast(result.error || 'GitHub Gist sync failed');
      }
    } finally {
      if (syncBtn) syncBtn.disabled = false;
    }
  });

  byId('save-sync-only-btn')?.addEventListener('click', async () => {
    const userName = byId('settings-user-name')?.value.trim() || '';
    const githubPat = byId('sync-github-pat')?.value.trim() || '';
    const gistId = byId('sync-gist-id')?.value.trim() || '';

    await updatePreferences({ userName });
    const nextState = await saveSyncCredentials({ gistId, githubPat });
    populateSyncSettingsModal(nextState);
    showToast('Settings & credentials saved locally');
  });

  byId('digest-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = byId('digest-title-input')?.value.trim() || 'Daily Digest';
    const rawFeedUrl = byId('digest-feed-url-input')?.value.trim() || '';
    let cleanUrl = '';
    if (rawFeedUrl) {
      cleanUrl = sanitizeHttpUrl(rawFeedUrl, false) || '';
      if (!cleanUrl) {
        showToast('Enter a valid http(s):// Digest JSON URL');
        return;
      }
    }

    // Request Chrome optional origin permission synchronously inside click/submit user gesture
    let permissionPromise = null;
    if (cleanUrl && typeof globalThis.chrome?.permissions?.request === 'function') {
      try {
        const originPattern = `${new URL(cleanUrl).origin}/*`;
        permissionPromise = globalThis.chrome.permissions.request({ origins: [originPattern] });
      } catch {
        permissionPromise = null;
      }
    }

    if (permissionPromise) {
      try {
        await permissionPromise;
      } catch {
        // Permission prompt dismissed or already covered; continue safely
      }
    }

    try {
      await updateDigestConfig({ title, feedUrl: cleanUrl });
      if (cleanUrl) {
        const res = await syncFromLocalBundle();
        showToast(res.synced ? 'Digest settings saved & synced' : 'Digest settings saved (feed fetched)');
      } else {
        showToast('Digest settings saved');
      }
    } catch (err) {
      showToast(err?.message || 'Unable to save digest settings');
    }
  });

  byId('clear-digest-url-btn')?.addEventListener('click', async () => {
    const urlInput = byId('digest-feed-url-input');
    if (urlInput) urlInput.value = '';
    await updateDigestConfig({ feedUrl: '' });
    showToast('Custom digest URL cleared');
  });

  byId('open-onboarding-btn')?.addEventListener('click', () => {
    const settingsModal = byId('sync-settings-modal');
    if (settingsModal instanceof HTMLDialogElement && settingsModal.open) {
      settingsModal.close();
    }
    openOnboardingModal();
  });

  byId('restore-starter-pack-btn')?.addEventListener('click', async () => {
    await applyStarterPreset('ai-web', { markOnboardingComplete: true });
    showToast('Restored AI & Web Engineering starter pack');
    try {
      await refreshRssFeeds({ force: false });
    } catch {
      // Offline fallback remains intact
    }
  });

  byId('reset-minimal-slate-btn')?.addEventListener('click', async () => {
    await applyStarterPreset('minimal', { markOnboardingComplete: true });
    showToast('Switched to clean minimal slate');
  });

  // First-Run Onboarding Modal Controls
  byId('onboarding-geo-btn')?.addEventListener('click', async () => {
    const statusEl = byId('onboarding-geo-status');
    if (!navigator.geolocation) {
      showToast('Browser geolocation unavailable');
      return;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000 });
      });
      onboardingPendingWeather = {
        locationName: 'Current Location',
        country: '',
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto'
      };
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = `📍 Using coordinates (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`;
      }
    } catch {
      showToast('Location permission declined — pick a city from the list');
    }
  });

  byId('onboarding-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userName = byId('onboarding-user-name')?.value.trim() || '';
    const weatherSelect = byId('onboarding-weather-select');
    const selectedCityVal = weatherSelect ? weatherSelect.value : '0';
    let weatherPatch = onboardingPendingWeather;
    if (!weatherPatch && selectedCityVal !== 'custom') {
      const idx = Number.parseInt(selectedCityVal, 10);
      if (Number.isFinite(idx) && POPULAR_WEATHER_CITIES[idx]) {
        weatherPatch = POPULAR_WEATHER_CITIES[idx];
      }
    }
    const presetEl = document.querySelector('input[name="onboarding-preset"]:checked');
    const presetId = presetEl instanceof HTMLInputElement && presetEl.value === 'minimal' ? 'minimal' : 'ai-web';
    const includeDigestWidget = Boolean(byId('onboarding-digest-toggle')?.checked);

    const nextState = await applyStarterPreset(presetId, {
      userName,
      weather: weatherPatch || undefined,
      includeDigestWidget,
      markOnboardingComplete: true
    });
    onboardingPendingWeather = null;

    const modal = byId('onboarding-modal');
    if (modal instanceof HTMLDialogElement && modal.open) {
      modal.close();
    }
    showToast(presetId === 'minimal' ? 'Minimal workspace ready' : 'Welcome to Calm Morning Gateway');

    try {
      await refreshWeather(true);
    } catch {
      // Fallback weather renders cleanly if offline
    }
    if ((nextState.rssSources || []).length > 0) {
      try {
        await refreshRssFeeds({ force: true });
      } catch {
        // Fallback RSS renders cleanly if offline
      }
    }
  });

  byId('onboarding-skip-btn')?.addEventListener('click', async () => {
    await updatePreferences({ onboardingCompleted: true });
    const modal = byId('onboarding-modal');
    if (modal instanceof HTMLDialogElement && modal.open) {
      modal.close();
    }
  });

  byId('onboarding-modal')?.addEventListener('close', async () => {
    onboardingPendingWeather = null;
    if (currentState && !currentState.onboardingCompleted) {
      await updatePreferences({ onboardingCompleted: true });
    }
  });

  byId('copy-pwa-url-btn')?.addEventListener('click', async () => {
    const pwaInput = byId('pwa-url-hint-input');
    const urlText = pwaInput?.value || '';
    if (!urlText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(urlText);
        showToast('PWA URL copied to clipboard');
      } else {
        pwaInput.select();
        showToast('Select and copy the PWA URL');
      }
    } catch {
      showToast('Copy failed — please copy manually');
    }
  });

  byId('export-json-btn')?.addEventListener('click', () => {
    const state = currentState || getStateSnapshot();
    const cleanJson = exportCleanStateJson(state);
    const blob = new Blob([cleanJson], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = `calm-gateway-backup-${state.activeDate || 'state'}.json`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast('Clean JSON backup exported (PAT stripped)');
  });

  byId('import-json-btn')?.addEventListener('click', () => {
    byId('import-json-input')?.click();
  });

  byId('import-json-input')?.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const rawText = await file.text();
      await importFullStateJson(rawText);
      showToast('Gateway state imported');
    } catch (err) {
      showToast(err?.message || 'Invalid backup JSON file');
    } finally {
      input.value = '';
    }
  });

  // Item Context & Sources Modal Forms
  byId('ctx-add-source-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = currentState || getStateSnapshot();
    const data = resolveContextModalData(state);
    if (!data || !data.editable) return;

    const labelInput = byId('ctx-source-label-input');
    const urlInput = byId('ctx-source-url-input');
    const rawLabel = labelInput?.value.trim() || '';
    const cleanUrl = sanitizeHttpUrl(urlInput?.value.trim() || '', true);
    if (!cleanUrl) {
      showToast('Enter a valid https:// or obsidian:// URL');
      return;
    }

    const nextSources = [
      ...(data.sources || []),
      { label: rawLabel || extractDomain(cleanUrl) || 'Reference', url: cleanUrl, kind: 'reference' }
    ];

    if (data.kind === 'objective') {
      await updateObjective(data.id, { url: data.rawEntity.url || cleanUrl, sources: nextSources });
    } else if (data.kind === 'todo') {
      await updateTodo(data.id, { sourceUrl: data.rawEntity.sourceUrl || cleanUrl, sources: nextSources });
    } else if (data.kind === 'slack') {
      await updateSlackItem(data.id, { url: data.rawEntity.url || cleanUrl, sources: nextSources });
    } else if (data.kind === 'bookmark') {
      await updateBookmark(data.id, { sources: nextSources });
    }

    byId('ctx-add-source-form')?.reset();
    showToast('Source attached');
  });

  byId('ctx-edit-cancel-btn')?.addEventListener('click', () => {
    isEditingContextModal = false;
    renderItemContextModal(currentState || getStateSnapshot());
  });

  byId('ctx-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = currentState || getStateSnapshot();
    const data = resolveContextModalData(state);
    if (!data || !data.editable) return;

    const nextTitle = byId('ctx-edit-title')?.value.trim() || data.title;
    const nextContext = byId('ctx-edit-context')?.value.trim() || '';
    const nextKeyPoints = (byId('ctx-edit-keypoints')?.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (data.kind === 'objective') {
      await updateObjective(data.id, { title: nextTitle, context: nextContext, keyPoints: nextKeyPoints });
    } else if (data.kind === 'todo') {
      await updateTodo(data.id, { text: nextTitle, context: nextContext, keyPoints: nextKeyPoints });
    } else if (data.kind === 'slack') {
      await updateSlackItem(data.id, { headline: nextTitle, context: nextContext, keyPoints: nextKeyPoints });
    } else if (data.kind === 'bookmark') {
      await updateBookmark(data.id, { title: nextTitle, context: nextContext, keyPoints: nextKeyPoints });
    }

    isEditingContextModal = false;
    showToast('Context & takeaways saved');
  });

  // Breathing Modal Lifecycle & Complete Button
  byId('breathing-modal')?.addEventListener('close', () => {
    stopBreathingTimer();
  });

  byId('breathing-complete-btn')?.addEventListener('click', async () => {
    stopBreathingTimer();
    if (!breathingAutoLogged) {
      breathingAutoLogged = true;
      await recordBreakTaken();
    }
    const modal = byId('breathing-modal');
    if (modal instanceof HTMLDialogElement && modal.open) {
      modal.close();
    }
    showToast('Mindful break logged');
  });

  // Keyboard-First Navigation Shortcuts
  document.addEventListener('keydown', async (event) => {
    const keyLower = event.key.toLowerCase();

    if ((event.metaKey || event.ctrlKey) && keyLower === 'k') {
      event.preventDefault();
      const cmdModal = byId('cmd-palette-modal');
      if (cmdModal instanceof HTMLDialogElement && cmdModal.open) {
        cmdModal.close();
      } else {
        openCommandPaletteModal();
      }
      return;
    }

    if (event.key === 'Escape') {
      const openModal = document.querySelector('dialog[open]');
      if (openModal instanceof HTMLDialogElement) {
        openModal.close();
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        active.blur();
      }
      return;
    }

    const activeEl = document.activeElement;
    const isTyping = activeEl instanceof HTMLElement && (
      activeEl.tagName === 'INPUT'
      || activeEl.tagName === 'TEXTAREA'
      || activeEl.tagName === 'SELECT'
      || activeEl.isContentEditable
    );

    if (isTyping || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (document.querySelector('dialog[open]')) {
      return;
    }

    if (keyLower === 'o') {
      event.preventDefault();
      setActiveMobileTab('focus');
      byId('objective-input')?.focus();
    } else if (keyLower === 't') {
      event.preventDefault();
      setActiveMobileTab('focus');
      byId('todo-input')?.focus();
    } else if (keyLower === 'b') {
      event.preventDefault();
      setActiveMobileTab('queue');
      byId('bookmark-input')?.focus();
    } else if (keyLower === 'f') {
      event.preventDefault();
      const nextFocus = !currentState?.wellness?.focusMode;
      await updatePreferences({ focusMode: nextFocus });
      showToast(nextFocus ? 'Deep-Work Focus Mode ON' : 'Focus Mode OFF');
    } else if (keyLower === 'm') {
      event.preventDefault();
      await cycleCircadianMood();
    } else if (keyLower === 'r') {
      event.preventDefault();
      openRssManagerModal();
    } else if (keyLower === 'w') {
      event.preventDefault();
      openBreathingModal();
    } else if (keyLower === 'u') {
      event.preventDefault();
      openWidgetStoreModal();
    } else if (keyLower === 'l') {
      event.preventDefault();
      const next = !currentState?.layout?.editMode;
      await setLayoutEditMode(next);
      showToast(next ? 'Layout Edit Mode ON — drag ⠿ or click zone pills' : 'Layout saved');
    } else if (keyLower === 'g') {
      event.preventDefault();
      openBgSettingsModal();
    }
  });
}

/**
 * Bind accessible Pointer Drag-and-Drop & Keyboard Grab-Move-Drop to all `.widget-drag-handle` controls.
 * Follows modern-web-guidance: dedicated handle, pointer capture, layout midpoints, CSS drop marker,
 * Escape cancellation, and Space + Arrow keys keyboard reordering.
 */
function bindWidgetDragAndDrop() {
  const getZoneContainers = () => [
    { zone: 'top', el: byId('zone-top') },
    { zone: 'left', el: byId('zone-left') },
    { zone: 'right', el: byId('zone-right') },
    { zone: 'bottom', el: byId('zone-bottom') }
  ].filter((entry) => entry.el instanceof HTMLElement);

  const clearDropMarkers = () => {
    for (const { el } of getZoneContainers()) {
      el.removeAttribute('data-drop');
      el.classList.remove('is-drop-zone-hover');
      el.style.removeProperty('--drop-x');
      el.style.removeProperty('--drop-y');
      el.style.removeProperty('--drop-w');
    }
  };

  const cleanupPointerDrag = () => {
    if (!dragSession) return;
    const { section } = dragSession;
    section.classList.remove('is-grabbed-widget');
    section.style.removeProperty('translate');
    section.style.removeProperty('pointer-events');
    document.documentElement.classList.remove('is-dragging-widget');
    clearDropMarkers();
    dragSession = null;
  };

  const computeDropTarget = (clientX, clientY, draggedId) => {
    const zones = getZoneContainers();
    if (zones.length === 0) return null;

    let bestZone = zones[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const entry of zones) {
      const rect = entry.el.getBoundingClientRect();
      const dx = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
      const dy = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestZone = entry;
      }
    }

    const siblings = Array.from(bestZone.el.children).filter(
      (child) => child instanceof HTMLElement && child.getAttribute('data-widget-id') !== draggedId
    );

    let insertIndex = siblings.length;
    for (let i = 0; i < siblings.length; i += 1) {
      const sRect = siblings[i].getBoundingClientRect();
      const midY = sRect.top + sRect.height / 2;
      if (clientY < midY) {
        insertIndex = i;
        break;
      }
    }

    const zRect = bestZone.el.getBoundingClientRect();
    let markerY = zRect.top + 8;
    if (siblings.length === 0) {
      markerY = zRect.top + zRect.height / 2;
    } else if (insertIndex === 0) {
      markerY = siblings[0].getBoundingClientRect().top - 6;
    } else if (insertIndex >= siblings.length) {
      markerY = siblings[siblings.length - 1].getBoundingClientRect().bottom + 6;
    } else {
      const prevBottom = siblings[insertIndex - 1].getBoundingClientRect().bottom;
      const nextTop = siblings[insertIndex].getBoundingClientRect().top;
      markerY = (prevBottom + nextTop) / 2;
    }

    return {
      zone: bestZone.zone,
      zoneEl: bestZone.el,
      insertIndex,
      markerX: zRect.left,
      markerY,
      markerW: Math.max(120, zRect.width)
    };
  };

  const handles = document.querySelectorAll('.widget-drag-handle');
  for (const handle of handles) {
    if (!(handle instanceof HTMLElement)) continue;
    const widgetId = handle.getAttribute('data-drag-widget');
    if (!widgetId) continue;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || dragSession) return;
      const section = handle.closest('[data-widget-id]');
      if (!(section instanceof HTMLElement)) return;

      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      document.documentElement.classList.add('is-dragging-widget');
      section.classList.add('is-grabbed-widget');
      section.style.pointerEvents = 'none';

      dragSession = {
        pointerId: event.pointerId,
        widgetId,
        handle,
        section,
        startX: event.clientX,
        startY: event.clientY,
        lastDrop: null
      };
    });

    // Accessible Keyboard Grab-Move-Drop (Space / Enter + Arrow keys + Escape)
    handle.addEventListener('keydown', async (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (keyboardGrabbedWidgetId === widgetId) {
          keyboardGrabbedWidgetId = null;
          handle.setAttribute('aria-pressed', 'false');
          handle.closest('[data-widget-id]')?.classList.remove('is-grabbed-widget');
          showToast('Widget dropped');
        } else {
          keyboardGrabbedWidgetId = widgetId;
          handle.setAttribute('aria-pressed', 'true');
          handle.closest('[data-widget-id]')?.classList.add('is-grabbed-widget');
          showToast('Grabbed — use Arrow keys to move across zones, Space to drop, Esc to cancel');
        }
        return;
      }

      if (keyboardGrabbedWidgetId !== widgetId) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        keyboardGrabbedWidgetId = null;
        handle.setAttribute('aria-pressed', 'false');
        handle.closest('[data-widget-id]')?.classList.remove('is-grabbed-widget');
        showToast('Reorder cancelled');
        return;
      }

      const keyToDir = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right'
      };
      const dir = keyToDir[event.key];
      if (!dir) return;

      event.preventDefault();
      await nudgeWidgetInLayout(widgetId, dir);
      const section = handle.closest('[data-widget-id]');
      section?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      handle.focus({ preventScroll: true });
    });
  }

  document.addEventListener('pointermove', (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;
    dragSession.section.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;

    const drop = computeDropTarget(event.clientX, event.clientY, dragSession.widgetId);
    dragSession.lastDrop = drop;
    clearDropMarkers();
    if (drop) {
      drop.zoneEl.classList.add('is-drop-zone-hover');
      drop.zoneEl.setAttribute('data-drop', 'true');
      drop.zoneEl.style.setProperty('--drop-x', `${Math.round(drop.markerX)}px`);
      drop.zoneEl.style.setProperty('--drop-y', `${Math.round(drop.markerY)}px`);
      drop.zoneEl.style.setProperty('--drop-w', `${Math.round(drop.markerW)}px`);
    }
  });

  document.addEventListener('pointerup', async (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const { widgetId, handle, lastDrop } = dragSession;
    cleanupPointerDrag();
    if (lastDrop) {
      await moveWidgetInLayout(widgetId, lastDrop.zone, lastDrop.insertIndex);
      const entry = WIDGET_CATALOG.find((w) => w.id === widgetId);
      showToast(`Placed ${entry?.title || widgetId} in ${ZONE_LABELS[lastDrop.zone]}`);
      handle.focus({ preventScroll: true });
    }
  });

  document.addEventListener('pointercancel', (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    cleanupPointerDrag();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dragSession) {
      event.preventDefault();
      cleanupPointerDrag();
      showToast('Drag cancelled');
    }
  });
}

/**
 * Initialize the Main Calm Morning Gateway application.
 */
async function init() {
  setActiveMobileTab('focus');
  bindEvents();

  subscribe((nextState) => {
    renderApp(nextState);
  });

  const initialState = await loadState();
  renderApp(initialState);

  // Hydrate latest Daily Digest bundle (custom Digest URL or optional local bundle)
  try {
    await syncFromLocalBundle();
  } catch {
    // Optional local bundle not present
  }

  const stateAfterBundle = getStateSnapshot();
  if (!stateAfterBundle.onboardingCompleted) {
    openOnboardingModal(stateAfterBundle);
  }

  await registerPwaServiceWorker();

  // Refresh live Weather Forecast silently if active
  try {
    await refreshWeather(false);
  } catch {
    // Fallback weather renders cleanly if offline
  }

  // Refresh RSS feeds silently in the background if cache is empty or stale
  if (!initialState.rssCache?.fetchedAt || (initialState.rssCache?.items || []).length === 0) {
    try {
      await refreshRssFeeds({ force: false });
    } catch {
      // Curated fallback renders cleanly if offline
    }
  }

  // Keep greeting, circadian mood, wallpaper time-of-day feel, and world clocks aligned with local clock
  window.setInterval(() => {
    if (currentState) {
      renderHeaderAndMood(currentState);
      if (isWidgetActive(currentState, 'world-clock')) {
        renderWorldClockWidget(currentState);
      }
    }
  }, 60000);
}

init();
