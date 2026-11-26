/**
 * Custom Reading Dashboard — Chrome Side Panel Companion (`js/sidepanel.js`)
 *
 * Compact 360px live-reactive companion view:
 * - Active Tab Hero Capture (`chrome.tabs.query`, `onActivated`, `onUpdated`)
 * - Quick Tag Chips + 1-click Bookmark / TODO creation
 * - Circadian Wellness Mini Strip (`getActiveWellnessPrompt`, `recordBreakTaken`)
 * - Live Objectives, Tactical TODOs, and Reading Queue synced via `store.js`
 */

import {
  addBookmark,
  addObjective,
  addTodo,
  extractDomain,
  loadState,
  removeBookmark,
  removeObjective,
  removeTodo,
  sanitizeHttpUrl,
  subscribe,
  toggleObjective,
  toggleTodo,
  updateBookmarkStatus
} from './store.js';

import {
  computeCircadianMood,
  getActiveWellnessPrompt,
  recordBreakTaken
} from './wellness.js';

const selectedTags = new Set();
let activeTabInfo = {
  url: null,
  title: 'No active web tab',
  domain: 'unavailable',
  actionable: false
};

/**
 * Shortcut DOM lookup by ID.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Display a polite confirmation toast message.
 * @param {string} message
 */
function showToast(message) {
  const region = byId('sp-toast-region');
  if (!region || !message) return;

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  region.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2600);
}

/**
 * Build a validated external link opening safely in a new tab.
 * @param {string | null | undefined} rawUrl
 * @param {string} label
 * @param {string} [className]
 * @param {string} [ariaLabel]
 * @returns {HTMLAnchorElement | null}
 */
function createSafeExternalLink(rawUrl, label, className = '', ariaLabel = '') {
  const safeUrl = sanitizeHttpUrl(rawUrl, true);
  if (!safeUrl) return null;

  const anchor = document.createElement('a');
  anchor.href = safeUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (className) anchor.className = className;
  if (ariaLabel) anchor.setAttribute('aria-label', ariaLabel);
  anchor.textContent = label;
  return anchor;
}

/**
 * Query and render the currently active browser tab in the hero card.
 */
async function refreshActiveTab() {
  const titleEl = byId('sp-active-tab-title');
  const domainEl = byId('sp-active-tab-domain');
  const bookmarkBtn = byId('sp-bookmark-tab-btn');
  const todoBtn = byId('sp-todo-tab-btn');

  try {
    if (!globalThis.chrome?.tabs?.query) {
      activeTabInfo = {
        url: sanitizeHttpUrl(window.location.href, true),
        title: document.title || 'Calm Gateway Companion',
        domain: extractDomain(window.location.href) || 'local',
        actionable: Boolean(sanitizeHttpUrl(window.location.href, true))
      };
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const safeUrl = sanitizeHttpUrl(tab?.url || '', true);
      if (safeUrl) {
        const domain = extractDomain(safeUrl) || safeUrl;
        const title = (typeof tab?.title === 'string' && tab.title.trim()) ? tab.title.trim() : domain;
        activeTabInfo = { url: safeUrl, title, domain, actionable: true };
      } else {
        const fallbackTitle = (typeof tab?.title === 'string' && tab.title.trim())
          ? tab.title.trim()
          : 'Browser internal page';
        activeTabInfo = {
          url: null,
          title: fallbackTitle,
          domain: 'internal page',
          actionable: false
        };
      }
    }
  } catch (err) {
    console.error('Failed to query active tab:', err);
    activeTabInfo = {
      url: null,
      title: 'Unable to read active tab',
      domain: 'unavailable',
      actionable: false
    };
  }

  if (titleEl) titleEl.textContent = activeTabInfo.title;
  if (domainEl) domainEl.textContent = activeTabInfo.domain;
  if (bookmarkBtn) bookmarkBtn.disabled = !activeTabInfo.actionable;
  if (todoBtn) todoBtn.disabled = !activeTabInfo.actionable;
}

/**
 * Sync tag chip button active styles and ARIA state with `selectedTags`.
 */
function renderTagChips() {
  const container = byId('sp-active-tab-tags');
  if (!container) return;
  const buttons = container.querySelectorAll('.filter-pill[data-tag]');
  for (const btn of buttons) {
    const tag = btn.getAttribute('data-tag');
    const isActive = Boolean(tag && selectedTags.has(tag));
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

/**
 * Apply circadian mood, theme, and wellness mini strip state.
 * @param {any} state
 */
function renderMoodAndWellness(state) {
  const now = new Date();
  const mood = computeCircadianMood(now, state.wellness?.moodOverride || 'auto');
  const colorScheme = state.wellness?.colorScheme || 'auto';

  document.documentElement.setAttribute('data-view', 'sidepanel');
  document.documentElement.setAttribute('data-mood', mood);
  document.documentElement.setAttribute('data-theme', colorScheme);
  document.documentElement.setAttribute('data-focus', state.wellness?.focusMode ? 'true' : 'false');

  const prompt = getActiveWellnessPrompt(state.wellness, now);
  const textEl = byId('sp-wellness-text');
  const stripEl = byId('sp-wellness-mini-strip');
  if (textEl) {
    textEl.textContent = `${prompt.icon} ${prompt.title} · ${prompt.instruction}`;
  }
  if (stripEl) {
    stripEl.title = prompt.instruction;
  }
}

/**
 * Render Today's Objectives ("The Big 3").
 * @param {any} state
 */
function renderObjectives(state) {
  const listEl = byId('sp-objective-list');
  const badgeEl = byId('sp-objectives-badge');
  if (!listEl) return;

  const objectives = state.objectives || [];
  const doneCount = objectives.filter((obj) => obj.completed).length;

  if (badgeEl) {
    badgeEl.textContent = `${doneCount}/${objectives.length} · ${objectives.length} of 3`;
  }

  if (objectives.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No objectives set yet.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  objectives.forEach((obj, index) => {
    const li = document.createElement('li');
    li.className = obj.completed
      ? 'objective-item is-completed is-interactive-row'
      : 'objective-item is-interactive-row';
    li.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a, button, input')) return;
      openSidePanelContext('🎯 Objective', obj.title, obj.context, obj.keyPoints, obj.sources);
    });

    const circleBtn = document.createElement('button');
    circleBtn.type = 'button';
    circleBtn.className = 'objective-circle';
    circleBtn.textContent = obj.completed ? '✓' : String(index + 1);
    circleBtn.setAttribute('aria-pressed', String(obj.completed));
    circleBtn.setAttribute('aria-label', obj.completed ? `Mark "${obj.title}" incomplete` : `Complete "${obj.title}"`);
    circleBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleObjective(obj.id);
    });

    const content = document.createElement('div');
    content.className = 'objective-content';

    const titleEl = document.createElement('span');
    titleEl.className = 'objective-title';
    titleEl.textContent = obj.title;
    content.appendChild(titleEl);

    if (obj.context) {
      const snippet = document.createElement('p');
      snippet.className = 'item-context-snippet';
      snippet.textContent = obj.context;
      content.appendChild(snippet);
    }

    const meta = document.createElement('div');
    meta.className = 'objective-meta';
    const primaryUrl = obj.url || obj.sources?.[0]?.url || null;
    if (primaryUrl) {
      const link = createSafeExternalLink(
        primaryUrl,
        `↗ ${obj.urlLabel || extractDomain(primaryUrl) || 'Open'}`,
        'link-pill',
        `Open ${obj.title} in a new tab`
      );
      if (link) meta.appendChild(link);
    }
    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    ctxBtn.textContent = '📖 Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openSidePanelContext('🎯 Objective', obj.title, obj.context, obj.keyPoints, obj.sources);
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
 * Render Tactical TODOs with toggle, new-tab link, and remove action.
 * @param {any} state
 */
function renderTodos(state) {
  const listEl = byId('sp-todo-list');
  const badgeEl = byId('sp-todos-badge');
  const progressLabelEl = byId('sp-todos-progress-label');
  const progressFillEl = byId('sp-todos-progress-fill');
  if (!listEl) return;

  const todos = state.todos || [];
  const total = todos.length;
  const completedCount = todos.filter((item) => item.completed).length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  if (badgeEl) badgeEl.textContent = `${pct}%`;
  if (progressLabelEl) progressLabelEl.textContent = `${completedCount} of ${total} · ${pct}%`;
  if (progressFillEl) progressFillEl.style.width = `${pct}%`;

  if (total === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No tactical TODOs yet.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = todo.completed
      ? 'todo-item is-completed is-interactive-row'
      : 'todo-item is-interactive-row';
    li.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a, button, input')) return;
      openSidePanelContext('✅ Tactical TODO', todo.text, todo.context, todo.keyPoints, todo.sources);
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
      const snippet = document.createElement('p');
      snippet.className = 'item-context-snippet';
      snippet.textContent = todo.context;
      content.appendChild(snippet);
    }

    const primaryUrl = todo.sourceUrl || todo.sources?.[0]?.url || null;
    const link = primaryUrl
      ? createSafeExternalLink(
        primaryUrl,
        `↗ ${todo.sourceLabel || extractDomain(primaryUrl) || 'Open'}`,
        'link-pill',
        `Open reference for ${todo.text} in a new tab`
      )
      : null;

    const meta = document.createElement('div');
    meta.className = 'todo-meta';
    for (const tag of todo.tags || []) {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag-pill';
      tagEl.textContent = `#${tag}`;
      meta.appendChild(tagEl);
    }
    if (link) meta.appendChild(link);
    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    ctxBtn.textContent = '📖 Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openSidePanelContext('✅ Tactical TODO', todo.text, todo.context, todo.keyPoints, todo.sources);
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
 * Render top / recent Inbox Bookmarks in the Reading Queue.
 * @param {any} state
 */
function renderBookmarks(state) {
  const listEl = byId('sp-bookmark-list');
  const badgeEl = byId('sp-bookmarks-badge');
  if (!listEl) return;

  const inboxBookmarks = (state.bookmarks || []).filter((item) => item.status !== 'archived');
  const sorted = [...inboxBookmarks].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  if (badgeEl) {
    badgeEl.textContent = `${inboxBookmarks.length} inbox`;
  }

  if (sorted.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Reading Queue is clear.';
    listEl.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const bm of sorted.slice(0, 12)) {
    const li = document.createElement('li');
    li.className = 'bookmark-item is-interactive-row';
    li.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a, button, input')) return;
      openSidePanelContext('📚 Reading Queue', bm.title, bm.context, bm.keyPoints, bm.sources);
    });

    const main = document.createElement('div');
    main.className = 'bookmark-main';

    const titleLink = createSafeExternalLink(
      bm.url,
      bm.pinned ? `★ ${bm.title}` : bm.title,
      'bookmark-title-link'
    );
    if (titleLink) {
      main.appendChild(titleLink);
    } else {
      const titleSpan = document.createElement('span');
      titleSpan.className = 'bookmark-title-link';
      titleSpan.textContent = bm.title;
      main.appendChild(titleSpan);
    }

    if (bm.context) {
      const snippet = document.createElement('p');
      snippet.className = 'item-context-snippet';
      snippet.textContent = bm.context;
      main.appendChild(snippet);
    }

    const meta = document.createElement('div');
    meta.className = 'bookmark-meta';

    const domainEl = document.createElement('span');
    domainEl.className = 'bookmark-domain';
    domainEl.textContent = bm.domain || extractDomain(bm.url);
    meta.appendChild(domainEl);

    const readEl = document.createElement('span');
    readEl.className = 'bookmark-read-time';
    readEl.textContent = `${bm.estReadMins || 5}m`;
    meta.appendChild(readEl);

    for (const tag of (bm.tags || []).slice(0, 2)) {
      const tagEl = document.createElement('span');
      tagEl.className = 'tag-pill';
      tagEl.textContent = `#${tag}`;
      meta.appendChild(tagEl);
    }

    const ctxBtn = document.createElement('button');
    ctxBtn.type = 'button';
    ctxBtn.className = 'context-pill';
    ctxBtn.textContent = '📖 Context';
    ctxBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openSidePanelContext('📚 Reading Queue', bm.title, bm.context, bm.keyPoints, bm.sources);
    });
    meta.appendChild(ctxBtn);

    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'bookmark-actions';

    const openLink = createSafeExternalLink(
      bm.url,
      '↗',
      'link-pill',
      `Open "${bm.title}" in a new tab`
    );
    if (openLink) {
      actions.appendChild(openLink);
    }

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn btn-ghost btn-sm';
    doneBtn.textContent = '✓';
    doneBtn.title = 'Mark as read';
    doneBtn.setAttribute('aria-label', `Mark "${bm.title}" as read`);
    doneBtn.addEventListener('click', async () => {
      await updateBookmarkStatus(bm.id, 'archived');
      showToast('Marked as read');
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove bookmark "${bm.title}"`);
    removeBtn.addEventListener('click', async () => {
      await removeBookmark(bm.id);
      showToast('Bookmark removed');
    });

    actions.append(doneBtn, removeBtn);
    li.append(main, actions);
    fragment.appendChild(li);
  }

  listEl.replaceChildren(fragment);
}

/**
 * Open the Companion Side Panel Context & Sources modal.
 * @param {string} badgeText
 * @param {string} title
 * @param {string} contextText
 * @param {string[]} keyPoints
 * @param {Array<{ label?: string, url?: string }>} sources
 */
function openSidePanelContext(badgeText, title, contextText, keyPoints = [], sources = []) {
  const modal = byId('sp-context-modal');
  if (!modal) return;

  const badgeEl = byId('sp-ctx-badge');
  const titleEl = byId('sp-ctx-title');
  const proseEl = byId('sp-ctx-prose');
  const kpWrap = byId('sp-ctx-keypoints-wrap');
  const kpList = byId('sp-ctx-keypoints');
  const srcList = byId('sp-ctx-sources');

  if (badgeEl) badgeEl.textContent = badgeText;
  if (titleEl) titleEl.textContent = title;
  if (proseEl) {
    proseEl.textContent = contextText || 'Open the full Gateway view (↗ Full) to edit context notes or attach additional sources.';
  }

  if (kpWrap && kpList) {
    if (Array.isArray(keyPoints) && keyPoints.length > 0) {
      kpWrap.hidden = false;
      const frag = document.createDocumentFragment();
      for (const pt of keyPoints) {
        const li = document.createElement('li');
        li.textContent = pt;
        frag.appendChild(li);
      }
      kpList.replaceChildren(frag);
    } else {
      kpWrap.hidden = true;
      kpList.replaceChildren();
    }
  }

  if (srcList) {
    const srcFrag = document.createDocumentFragment();
    const validSources = Array.isArray(sources) ? sources : [];
    if (validSources.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'No reference URLs attached yet.';
      srcFrag.appendChild(empty);
    } else {
      for (const src of validSources) {
        const li = document.createElement('li');
        li.className = 'source-card';
        const link = createSafeExternalLink(
          src.url,
          `↗ ${src.label || extractDomain(src.url) || 'Open Source'}`,
          'source-card-link'
        );
        if (link) {
          li.appendChild(link);
          srcFrag.appendChild(li);
        }
      }
    }
    srcList.replaceChildren(srcFrag);
  }

  if (!modal.open) {
    modal.showModal();
  }
}

/**
 * Render all side panel sections from GatewayState.
 * @param {any} state
 */
function renderAll(state) {
  renderMoodAndWellness(state);
  renderObjectives(state);
  renderTodos(state);
  renderBookmarks(state);
}

/**
 * Bind UI event listeners and Chrome tab listeners.
 */
function bindEvents() {
  const openFullLink = byId('sp-open-full-link');
  if (openFullLink) {
    openFullLink.addEventListener('click', async (event) => {
      if (globalThis.chrome?.tabs?.create && globalThis.chrome?.runtime?.getURL) {
        event.preventDefault();
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
        } catch (err) {
          console.error('Failed to open full gateway tab:', err);
        }
      }
    });
  }

  const ctxModal = byId('sp-context-modal');
  const ctxCloseBtn = byId('sp-ctx-close-btn');
  if (ctxCloseBtn && ctxModal instanceof HTMLDialogElement) {
    ctxCloseBtn.addEventListener('click', () => {
      if (ctxModal.open) ctxModal.close();
    });
  }
  if (ctxModal instanceof HTMLDialogElement) {
    ctxModal.addEventListener('click', (event) => {
      if (event.target === ctxModal && ctxModal.open) ctxModal.close();
    });
  }

  const tagsContainer = byId('sp-active-tab-tags');
  if (tagsContainer) {
    tagsContainer.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('.filter-pill[data-tag]') : null;
      if (!target) return;
      const tag = target.getAttribute('data-tag');
      if (!tag) return;
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      renderTagChips();
    });
  }

  const bookmarkTabBtn = byId('sp-bookmark-tab-btn');
  if (bookmarkTabBtn) {
    bookmarkTabBtn.addEventListener('click', async () => {
      if (!activeTabInfo.actionable || !activeTabInfo.url) return;
      const saved = await addBookmark({
        url: activeTabInfo.url,
        title: activeTabInfo.title,
        tags: Array.from(selectedTags)
      });
      if (saved) {
        selectedTags.clear();
        renderTagChips();
        showToast('Saved to Reading Queue');
      }
    });
  }

  const todoTabBtn = byId('sp-todo-tab-btn');
  if (todoTabBtn) {
    todoTabBtn.addEventListener('click', async () => {
      if (!activeTabInfo.actionable || !activeTabInfo.url) return;
      await addTodo({
        text: activeTabInfo.title,
        tags: Array.from(selectedTags),
        sourceUrl: activeTabInfo.url,
        sourceLabel: activeTabInfo.domain
      });
      selectedTags.clear();
      renderTagChips();
      showToast('Added to Tactical TODOs');
    });
  }

  const wellnessDoneBtn = byId('sp-wellness-done-btn');
  if (wellnessDoneBtn) {
    wellnessDoneBtn.addEventListener('click', async () => {
      await recordBreakTaken();
      showToast('Break logged — nice reset');
    });
  }

  const objectiveForm = byId('sp-objective-add-form');
  const objectiveInput = byId('sp-objective-input');
  if (objectiveForm && objectiveInput) {
    objectiveForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const raw = objectiveInput.value.trim();
      if (!raw) return;
      try {
        await addObjective(raw);
        objectiveInput.value = '';
        showToast('Objective added');
      } catch (err) {
        showToast(err?.message || 'Unable to add objective');
      }
    });
  }

  const todoForm = byId('sp-todo-add-form');
  const todoInput = byId('sp-todo-input');
  if (todoForm && todoInput) {
    todoForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const raw = todoInput.value.trim();
      if (!raw) return;
      try {
        await addTodo(raw);
        todoInput.value = '';
        showToast('TODO added');
      } catch (err) {
        showToast(err?.message || 'Unable to add TODO');
      }
    });
  }

  if (globalThis.chrome?.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async () => {
      await refreshActiveTab();
    });
  }

  if (globalThis.chrome?.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
      if (!tab?.active) return;
      if (changeInfo.status === 'complete' || typeof changeInfo.title === 'string' || typeof changeInfo.url === 'string') {
        await refreshActiveTab();
      }
    });
  }

  if (globalThis.chrome?.windows?.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        await refreshActiveTab();
      }
    });
  }
}

/**
 * Initialize Side Panel Companion.
 */
async function init() {
  bindEvents();
  renderTagChips();
  const initialState = await loadState();
  renderAll(initialState);
  await refreshActiveTab();

  subscribe((nextState) => {
    renderAll(nextState);
  });
}

init();
