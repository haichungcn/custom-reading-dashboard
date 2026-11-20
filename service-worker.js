/**
 * Calm Morning Gateway — Chrome MV3 Background Service Worker (`service-worker.js`)
 *
 * Ephemeral, stateless background worker:
 * - Configures Action click -> Side Panel (`openPanelOnActionClick: true`)
 * - Registers Context Menus with badge confirmation
 * - Handles keyboard command `bookmark-active-tab`
 * - Runs periodic 15-minute Gist sync & RSS refresh via `chrome.alarms`
 * - Bridges runtime messages (`SYNC_NOW`, `REFRESH_RSS`, `OPEN_SIDE_PANEL`)
 */

import {
  addBookmark,
  addTodo,
  extractDomain,
  loadState,
  sanitizeHttpUrl,
  syncFromLocalBundle
} from './js/store.js';
import { syncWithGist } from './js/gist-sync.js';
import { refreshRssFeeds } from './js/rss-engine.js';

const PERIODIC_SYNC_ALARM = 'calm-gateway-periodic-sync';
const CLEAR_BADGE_ALARM = 'calm-gateway-clear-badge';
const MENU_SAVE_READING = 'save-to-reading-queue';
const MENU_ADD_TODO = 'add-to-tactical-todos';
const BADGE_CONFIRM_COLOR = '#4A6B5D';

/**
 * Enable opening the Side Panel directly when clicking the toolbar action icon.
 */
async function configureSidePanelBehavior() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.error('Failed to configure side panel behavior:', err);
  }
}

/**
 * Ensure the 15-minute periodic sync alarm is registered without resetting an active schedule.
 */
async function ensurePeriodicSyncAlarm() {
  try {
    const existing = await chrome.alarms.get(PERIODIC_SYNC_ALARM);
    if (!existing) {
      await chrome.alarms.create(PERIODIC_SYNC_ALARM, { periodInMinutes: 15 });
    }
  } catch (err) {
    console.error('Failed to register periodic sync alarm:', err);
  }
}

/**
 * Show a brief confirmation badge on the extension action icon and clear it via chrome.alarms.
 * @param {string} [text='✓']
 */
async function flashConfirmationBadge(text = '✓') {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_CONFIRM_COLOR });
    await chrome.action.setBadgeText({ text });
    await chrome.alarms.create(CLEAR_BADGE_ALARM, { delayInMinutes: 0.05 });
  } catch (err) {
    console.error('Failed to flash confirmation badge:', err);
  }
}

/**
 * Rebuild context menu entries idempotently on install/update.
 */
async function registerContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: MENU_SAVE_READING,
      title: 'Save to Calm Gateway Reading Queue',
      contexts: ['page', 'link']
    });
    chrome.contextMenus.create({
      id: MENU_ADD_TODO,
      title: "Add to Today's Calm Gateway TODOs",
      contexts: ['page', 'link', 'selection']
    });
  } catch (err) {
    console.error('Failed to register context menus:', err);
  }
}

/**
 * Bookmark a tab object safely and confirm via action badge.
 * @param {chrome.tabs.Tab | undefined} tab
 * @returns {Promise<boolean>}
 */
async function bookmarkTabAndConfirm(tab) {
  const safeUrl = sanitizeHttpUrl(tab?.url || '', true);
  if (!safeUrl) return false;

  const title = (typeof tab?.title === 'string' && tab.title.trim())
    ? tab.title.trim()
    : (extractDomain(safeUrl) || safeUrl);

  const saved = await addBookmark({ url: safeUrl, title });
  if (!saved) return false;

  await flashConfirmationBadge('✓');
  return true;
}

// Top-level safe async side-panel & alarm initialization on SW startup
configureSidePanelBehavior();
ensurePeriodicSyncAlarm();

chrome.runtime.onInstalled.addListener(async () => {
  await configureSidePanelBehavior();
  await ensurePeriodicSyncAlarm();
  await registerContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSidePanelBehavior();
  await ensurePeriodicSyncAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name) return;

  if (alarm.name === CLEAR_BADGE_ALARM) {
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (err) {
      console.error('Failed to clear badge text:', err);
    }
    return;
  }

  if (alarm.name === PERIODIC_SYNC_ALARM) {
    try {
      await syncFromLocalBundle();
      const state = await loadState();
      if (state.sync?.githubPat) {
        await syncWithGist();
      }
      await refreshRssFeeds({ force: false });
    } catch (err) {
      console.error('Periodic sync alarm failed:', err);
    }
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU_SAVE_READING) {
      const targetUrl = sanitizeHttpUrl(info.linkUrl || info.pageUrl || tab?.url || '', true);
      if (!targetUrl) return;

      const selection = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
      const tabTitle = typeof tab?.title === 'string' ? tab.title.trim() : '';
      const title = info.linkUrl
        ? (selection || (info.linkUrl === tab?.url ? tabTitle : '') || extractDomain(targetUrl) || targetUrl)
        : (tabTitle || extractDomain(targetUrl) || targetUrl);

      const saved = await addBookmark({ url: targetUrl, title });
      if (saved) {
        await flashConfirmationBadge('✓');
      }
      return;
    }

    if (info.menuItemId === MENU_ADD_TODO) {
      const targetUrl = sanitizeHttpUrl(info.linkUrl || info.pageUrl || tab?.url || '', true);
      const selection = typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
      const tabTitle = typeof tab?.title === 'string' ? tab.title.trim() : '';
      const domainLabel = targetUrl ? (extractDomain(targetUrl) || null) : null;

      let text = selection;
      if (!text) {
        if (info.linkUrl && targetUrl) {
          text = `Review ${domainLabel || targetUrl}`;
        } else {
          text = tabTitle || domainLabel || targetUrl || '';
        }
      }
      if (!text) return;

      await addTodo({
        text,
        sourceUrl: targetUrl,
        sourceLabel: domainLabel
      });
      await flashConfirmationBadge('✓');
    }
  } catch (err) {
    console.error('Context menu action failed:', err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'bookmark-active-tab') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await bookmarkTabAndConfirm(tab);
  } catch (err) {
    console.error('Keyboard command bookmark-active-tab failed:', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (!message || typeof message.type !== 'string') {
        sendResponse({ ok: false, error: 'Invalid message payload' });
        return;
      }

      if (message.type === 'SYNC_NOW') {
        await syncFromLocalBundle();
        const result = await syncWithGist();
        sendResponse({
          ok: result.status !== 'error',
          status: result.status,
          state: result.state,
          error: result.error || null
        });
        return;
      }

      if (message.type === 'REFRESH_RSS') {
        const result = await refreshRssFeeds({ force: Boolean(message.force) });
        sendResponse({
          ok: true,
          count: result.items.length,
          fromCache: result.fromCache,
          usedFallback: result.usedFallback
        });
        return;
      }

      if (message.type === 'OPEN_SIDE_PANEL') {
        let targetWindowId = Number.isInteger(message.windowId) ? message.windowId : null;
        if (targetWindowId === null) {
          const lastWindow = await chrome.windows.getLastFocused();
          targetWindowId = lastWindow?.id ?? null;
        }
        if (targetWindowId === null) {
          sendResponse({ ok: false, error: 'No target window available' });
          return;
        }
        await chrome.sidePanel.open({ windowId: targetWindowId });
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});
