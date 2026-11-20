# Calm Morning Gateway — Shared Interface & Architecture Contracts (`v1.3`)

Every module, stylesheet, HTML view, service worker, and Python bridge script MUST adhere strictly to the schemas, function signatures, DOM hooks, and security invariants locked in this file.

---

## 1. Security, MV3 & Code Quality Invariants (Mandatory Across All Files)

1. **Manifest V3 Strict CSP**:
   - **Zero inline `<script>` blocks** and **zero inline `on*` event attributes** (`onclick`, `onsubmit`, etc.) in `index.html` or `sidepanel.html`.
   - **Zero `eval()` or `new Function()`**.
   - Load JS modules via `<script type="module" src="js/app.js"></script>` and `<script type="module" src="js/sidepanel.js"></script>`.
2. **XSS & URL Sanitization (Snyk Cleanliness)**:
   - **NEVER** assign untrusted/user/RSS/Slack strings to `innerHTML`, `outerHTML`, or `insertAdjacentHTML`. Build dynamic list items using `document.createElement()`, `el.textContent = ...`, and `el.setAttribute(...)`.
   - **URL Validation (`sanitizeHttpUrl`)**: Every external link `href` MUST be validated via `new URL(raw)` to permit **only** `http:`, `https:`, or `obsidian:` protocols before setting `a.href`. Reject `javascript:`, `data:`, `vbscript:`, or malformed URLs (fallback to `'#'` or omit link pill).
   - **New Tab Rule**: Every external link `<a>` across Objectives, TODOs, Slack Digest, Reading Queue/Bookmarks, and Discovery Stream MUST set `target="_blank"` and `rel="noopener noreferrer"`.
3. **Chrome Extensions Best Practices**:
   - **Always `async`/`await`** — NEVER use `.then()` or `.catch()` promise chains in any `.js` file! Use `try { await ... } catch (err) { ... }`.
   - **Ephemeral Service Worker**: `service-worker.js` MUST NOT hold mutable application state in module-level variables; always read/write through `store.js` / `chrome.storage.local` and schedule periodic work with `chrome.alarms`.
   - **Side Panel Trigger**: `service-worker.js` MUST call `await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` (exact property name `openPanelOnActionClick`).
   - **Message Passing**: Any `chrome.runtime.onMessage.addListener` performing async work MUST invoke an async IIFE `(async () => { ... sendResponse(...); })()` and synchronously `return true;`.

---

## 2. Canonical State Schema (`GatewayState v1`)

Stored under storage key `"calm_gateway_state_v1"` in `chrome.storage.local` (Extension) and `localStorage` (Standalone PWA), synced as `gateway-state.json` inside a Private GitHub Gist, and bridged with Obsidian by `bridge/sync_gateway_obsidian.py`.

```ts
export interface GatewayState {
  schemaVersion: 1;
  updatedAt: string;           // ISO-8601 UTC timestamp of latest mutation
  activeDate: string;          // Local YYYY-MM-DD (e.g. "2026-11-19")
  userName: string;            // Default: "" (renders neutral greeting until set)
  onboardingCompleted: boolean;// Default: false (triggers first-run setup wizard once)
  focusTheme: string;          // Editable calm motto, default: "Clarity over volume."
  digestConfig: {
    title: string;             // Default: "Daily Digest"
    subtitle: string;          // Default: "Team & Project Pulse"
    feedUrl: string;           // Optional HTTPS Digest JSON endpoint
  };

  objectives: ObjectiveItem[]; // "The Big 3" daily strategic outcomes (soft cap warning at 3)
  todos: TodoItem[];           // Tactical start-to-end-of-day tasks
  archivedLog: ArchivedEntry[];// Completed items archived on Clear Completed / Day Rollover

  slackDigest: {
    date: string;              // YYYY-MM-DD of digest (e.g. "2026-11-18")
    deliveredAt: string;       // Display label e.g. "09:00 UTC"
    items: SlackDigestItem[];
  };

  bookmarks: BookmarkItem[];   // Reading Queue & saved links
  rssSources: RssSource[];     // Pre-seeded + user-managed custom RSS/Atom feeds
  rssCache: {
    fetchedAt: string | null;  // ISO-8601 timestamp
    items: RssArticleItem[];   // Normalized cached feed items
    dismissedUrls: string[];   // URLs hidden via [x] Dismiss
  };

  wellness: {
    moodOverride: "auto" | "morning" | "deep-work" | "evening";
    colorScheme: "auto" | "light" | "dark";
    focusMode: boolean;        // Collapses Discovery Stream & secondary noise when true
    rssCollapsed: boolean;     // Collapses bottom Discovery drawer independently
    breaksToday: number;
    lastBreakAt: string | null;// ISO-8601 timestamp
    promptIndex: number;       // Current index into wellness prompts rotation
    activeMinutesStart: string;// ISO-8601 session start for gentle stretch cue
  };

  sync: {
    gistId: string;            // GitHub Gist ID (empty string if unconfigured)
    githubPat: string;         // Fine-grained PAT (stored locally; excluded when exporting public backups; NOTE: never uploaded inside gateway-state.json payload!)
    lastSyncedAt: string | null;
    lastSyncStatus: "local-only" | "synced" | "syncing" | "error";
    lastSyncError: string | null;
  };

  // Conflict-safe tombstones: maps deleted entity ID -> ISO-8601 deletion timestamp
  // Prevents deleted items from resurrecting during two-way Gist or Python bridge merges.
  tombstones: Record<string, string>;
}

export interface ObjectiveItem {
  id: string;                  // e.g. "obj_..."
  title: string;
  url: string | null;          // Optional extracted reference URL
  urlLabel: string | null;     // e.g. "gitlab.com" or "Spec Doc"
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TodoItem {
  id: string;                  // e.g. "todo_..."
  text: string;
  completed: boolean;
  tags: string[];              // Normalized lowercase without '#', e.g. ["engineering", "perf"]
  sourceUrl: string | null;
  sourceLabel: string | null;  // e.g. "#engineering" or hostname
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface ArchivedEntry {
  id: string;
  kind: "objective" | "todo";
  text: string;
  date: string;                // YYYY-MM-DD archived
  completedAt: string;
}

export interface SlackDigestItem {
  id: string;                  // Deterministic hash or "slack_..."
  channel: string;             // e.g. "#engineering", "#platform", "#release"
  badge: string | null;        // e.g. "Decision", "Action Needed", "Incident", "Release"
  headline: string;
  summary: string;
  url: string | null;          // Thread permalink, PR, or obsidian:// URI
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkItem {
  id: string;                  // e.g. "bm_..."
  url: string;
  title: string;
  domain: string;              // Extracted hostname without www., e.g. "web.dev"
  tags: string[];              // e.g. ["css", "perf"]
  status: "inbox" | "archived";
  pinned: boolean;             // ★ Favorite / pinned to top
  estReadMins: number;         // Auto-estimated (default 5)
  addedAt: string;
  updatedAt: string;
}

export interface RssSource {
  id: string;                  // e.g. "rss_dailydev"
  name: string;                // e.g. "Daily.dev"
  xmlUrl: string;              // Feed URL
  siteUrl: string;             // Homepage URL
  category: string;            // e.g. "engineering", "web", "frontend"
  enabled: boolean;
  updatedAt: string;
}

export interface RssArticleItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string;         // ISO-8601
  estReadMins: number;
}
```

### Important Security Rule for Gist Payload (`gateway-state.json`):
When `gist-sync.js` serializes `GatewayState` to upload to GitHub Gist, it MUST strip `sync.githubPat` (set `githubPat: ""` in the remote JSON) so the Personal Access Token is NEVER written into the Gist content itself! Local storage keeps `sync` credentials in a separate local-only storage key `"calm_gateway_credentials_v1"` (`{ gistId, githubPat }`) merged into runtime state on read.

---

## 3. ES Module Export Contracts (`js/*.js`)

### 3.1 `js/store.js`
Universal reactive store working in Chrome Extension (`chrome.storage.local`), Service Worker, Side Panel, iOS Safari PWA (`localStorage`), and Node.js unit tests (in-memory fallback when neither `chrome.storage` nor `localStorage` exists).

```js
export const STORAGE_KEY = 'calm_gateway_state_v1';
export const CREDENTIALS_KEY = 'calm_gateway_credentials_v1';

// URL & parsing helpers (shared across UI & store)
export function sanitizeHttpUrl(rawUrl, allowObsidian = true) -> string | null;
export function parseQuickInput(rawText) -> { cleanText: string, url: string | null, urlLabel: string | null, tags: string[] };
export function extractDomain(url) -> string;
export function estimateReadMinutes(titleOrText, url) -> number;
export function createDefaultState(now = new Date()) -> GatewayState;

// Core lifecycle & subscriptions
export async function loadState() -> Promise<GatewayState>;
export async function saveState(nextState, options = { bumpUpdatedAt: true }) -> Promise<GatewayState>;
export function getStateSnapshot() -> GatewayState; // Synchronous latest cached state after loadState()
export function subscribe(listener /* (state: GatewayState) => void */) -> () => void; // Unsubscribe fn

// Two-way conflict-safe state merger (used by gist-sync.js and testable in Node)
export function mergeStates(localState, remoteState) -> GatewayState;

// Objectives CRUD ("The Big 3")
export async function addObjective(rawInput /* string or { title, url, urlLabel } */) -> Promise<ObjectiveItem>;
export async function toggleObjective(id) -> Promise<GatewayState>;
export async function updateObjective(id, patch /* { title?, url?, urlLabel? } */) -> Promise<GatewayState>;
export async function removeObjective(id) -> Promise<GatewayState>;

// Tactical TODOs CRUD & Day Rollover
export async function addTodo(rawInput /* string or { text, tags?, sourceUrl?, sourceLabel? } */) -> Promise<TodoItem>;
export async function toggleTodo(id) -> Promise<GatewayState>;
export async function updateTodo(id, patch /* { text?, tags?, sourceUrl?, sourceLabel? } */) -> Promise<GatewayState>;
export async function removeTodo(id) -> Promise<GatewayState>;
export async function clearCompletedTodos() -> Promise<GatewayState>;
export async function rolloverDay(newDateStr /* optional YYYY-MM-DD */) -> Promise<{ completedObjectives: number, completedTodos: number, carriedOverTodos: number, state: GatewayState }>;

// Slack Digest CRUD & Cross-Panel Bridges
export async function addSlackItem(item /* { channel, badge?, headline, summary?, url? } */) -> Promise<SlackDigestItem>;
export async function removeSlackItem(id) -> Promise<GatewayState>;
export async function promoteSlackToTodo(slackItemId) -> Promise<TodoItem | null>;
export async function promoteSlackToBookmark(slackItemId) -> Promise<BookmarkItem | null>;
export async function importSlackDigest(digestPayload /* { date, deliveredAt?, items[] } */) -> Promise<GatewayState>;

// Reading Queue & Bookmarks CRUD
export async function addBookmark(input /* string URL or { url, title?, tags?, estReadMins?, pinned? } */) -> Promise<BookmarkItem | null>;
export async function updateBookmarkStatus(id, status /* 'inbox' | 'archived' */) -> Promise<GatewayState>;
export async function toggleBookmarkPin(id) -> Promise<GatewayState>;
export async function promoteBookmarkToTodo(bookmarkId) -> Promise<TodoItem | null>;
export async function removeBookmark(id) -> Promise<GatewayState>;

// RSS Sources & Discovery Stream Actions
export async function addRssSource(source /* { name, xmlUrl, siteUrl?, category? } */) -> Promise<RssSource>;
export async function removeRssSource(id) -> Promise<GatewayState>;
export async function toggleRssSource(id) -> Promise<GatewayState>;
export async function dismissRssArticle(articleUrl) -> Promise<GatewayState>;
export async function updateRssCache(items /* RssArticleItem[] */, fetchedAt /* ISO string */) -> Promise<GatewayState>;

// Header, Focus, Mood, Onboarding, Digest & Sync Settings Updates
export async function updatePreferences(patch /* Partial<GatewayState['wellness']> & { focusTheme?: string, userName?: string, onboardingCompleted?: boolean, digestConfig?: Partial<GatewayState['digestConfig']> } */) -> Promise<GatewayState>;
export async function updateDigestConfig(config /* { title?: string, subtitle?: string, feedUrl?: string } */) -> Promise<GatewayState>;
export async function applyStarterPreset(presetId /* 'ai-web' | 'minimal' */, options?) -> Promise<GatewayState>;
export async function applyRssPresetPack(packId /* 'ai-web' | 'minimal' */) -> Promise<GatewayState>;
export function exportRssSourcesOpml(sources) -> string;
export function parseRssSourcesOpmlOrJson(rawText) -> Array<{ name, xmlUrl, siteUrl, category }>;
export async function importRssSourcesOpml(opmlOrJsonText, options /* { mode: 'merge' | 'replace' } */) -> Promise<{ importedCount, skippedCount, totalCount, state }>;
export async function saveSyncCredentials(creds /* { gistId: string, githubPat: string } */) -> Promise<GatewayState>;
export async function updateSyncMetadata(meta /* { lastSyncedAt?, lastSyncStatus?, lastSyncError?, gistId? } */) -> Promise<GatewayState>;
export async function importFullStateJson(jsonStringOrObj) -> Promise<GatewayState>;
export function exportCleanStateJson(state) -> string; // Strips githubPat
export async function syncFromLocalBundle(fetchImpl = globalThis.fetch) -> Promise<{ synced: boolean, state: GatewayState }>;
```

**Pre-Seeded Demo/Initial State in `createDefaultState()`**:
- Pre-seed neutral, helpful initial items (toggleable, removable, or swappable to a clean blank slate during onboarding):
  - 2 sample Objectives (e.g., `"Finalize Q4 Architecture & Agentic Workflow RFC"`, `"Review Edge Gateway 504 Timeout RCA & Rollout Guardrails"`)
  - 2 sample Tactical TODOs (e.g., `"Configure optional Private GitHub Gist sync or JSON backup"`)
  - 2 sample Daily Digest items (`#engineering`, `#release`) so the card looks alive out of the box
  - 3 sample Bookmarks (`https://antigravity.google/blog`, `https://www.anthropic.com/engineering`, `https://web.dev/articles/anchor-positioning`)
  - 10 pre-loaded Frontier AI & Web Engineering RSS Sources (`DEFAULT_RSS_SOURCES`) with curated offline fallbacks in `rss-engine.js`.

---

### 3.2 `js/gist-sync.js`
Conflict-safe Private GitHub Gist two-way sync client (`https://api.github.com/gists`).

```js
export const GIST_FILENAME = 'gateway-state.json';

export function serializeStateForGist(state) -> string; // Strips githubPat
export async function createPrivateGist(githubPat, initialState, fetchImpl = globalThis.fetch) -> Promise<{ gistId: string, htmlUrl: string, updatedAt: string }>;
export async function pullFromGist(gistId, githubPat, fetchImpl = globalThis.fetch) -> Promise<{ remoteState: GatewayState | null, etag?: string }>;
export async function pushToGist(gistId, githubPat, state, fetchImpl = globalThis.fetch) -> Promise<{ syncedAt: string }>;
export async function syncWithGist(options = { fetchImpl: globalThis.fetch }) -> Promise<{ status: 'local-only' | 'synced' | 'error', state: GatewayState, error?: string }>;
```
- Uses `Accept: application/vnd.github+json`, `Authorization: Bearer ${githubPat}`, `X-GitHub-Api-Version: 2022-11-28`.
- `syncWithGist()` loads current state, returns `{ status: 'local-only', state }` if `githubPat` is empty; if `gistId` is empty, calls `createPrivateGist` and saves the new `gistId`; otherwise pulls remote state, merges via `mergeStates(localState, remoteState)`, saves merged state locally, pushes merged state to Gist, and updates `lastSyncedAt` & `lastSyncStatus: 'synced'`.

---

### 3.3 `js/rss-engine.js`
Zero-dependency XML RSS 2.0 & Atom 1.0 parser + 30-minute cache manager (works in Window, Service Worker without `DOMParser` via lightweight regex/tag XML extractor fallback, and Node.js!).
> **CRITICAL MV3 NOTE**: Service Workers (`service-worker.js`) and Node.js do NOT have `window.DOMParser`! Therefore `parseFeedXml(xmlString, source)` MUST use a clean, deterministic pure-JS XML item/entry parser (supporting `<item>` RSS 2.0 and `<entry>` Atom 1.0, CDATA stripping, HTML entity decoding, and `sanitizeHttpUrl` validation) so it works identically in Browser Window, MV3 Service Worker, AND Node.js unit tests!

```js
export const RSS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function parseFeedXml(xmlText, source /* { id, name } */) -> RssArticleItem[];
export function getCuratedFallbackArticles(sources /* RssSource[] */) -> RssArticleItem[];
export async function refreshRssFeeds(options = { force: false, fetchImpl: globalThis.fetch }) -> Promise<{ items: RssArticleItem[], fromCache: boolean, usedFallback: boolean }>;
```

---

### 3.4 `js/wellness.js`
Circadian mood scheduler, anti-overwork wind-down engine (17:30+), stretch/hydration prompt rotator, and 60-second breathing phase timer.

```js
export const WELLNESS_PROMPTS = [ /* >= 6 calm stretch, 20-20-20 eye rest, posture, hydration prompts */ ];
export const CALM_QUOTES = [ /* >= 6 calm Principal SE quotes */ ];

export function computeCircadianMood(now = new Date(), moodOverride = 'auto') -> 'morning' | 'deep-work' | 'evening';
// 06:00 - 09:59 -> 'morning'
// 10:00 - 17:29 -> 'deep-work'
// 17:30 - 05:59 -> 'evening'

export function getGreetingData(now = new Date(), userName = '') -> {
  greeting: string,       // "Good morning" | "Good morning, <Name>" | "Good afternoon..." | "Good evening..."
  dateLabel: string,      // "Thu, Nov 19 · Week 47"
  mood: 'morning' | 'deep-work' | 'evening',
  moodLabel: string,      // "🌅 Morning Warmth" | "🧘 Deep Work Flow" | "🍵 Evening Wind-Down"
  isEveningWindDown: boolean
};

export function getActiveWellnessPrompt(wellnessState, now = new Date()) -> {
  id: string,
  icon: string,
  title: string,
  instruction: string,
  activeMinutes: number,
  isOverworkWarning: boolean
};

export async function recordBreakTaken(now = new Date()) -> Promise<GatewayState>;

// 4-4-6 Mindful Breathing cycle helper (Inhale 4s -> Hold 4s -> Exhale 6s = 14s cycle, 60s total)
export function getBreathingPhaseAtElapsedMs(elapsedMs, totalDurationMs = 60000) -> {
  done: boolean,
  phase: 'inhale' | 'hold' | 'exhale' | 'complete',
  label: string,
  secondsRemainingInPhase: number,
  progressRatio: number // 0..1
};
```

---

## 4. HTML & CSS Structural / Hook Contract (`css/*`, `index.html`, `sidepanel.html`)

### 4.1 Root Document Attributes (`<html>` or `<body>`)
`js/app.js` and `js/sidepanel.js` set these attributes on `document.documentElement`:
- `data-mood="morning" | "deep-work" | "evening"` — drives Circadian color tokens in `css/tokens.css`
- `data-theme="auto" | "light" | "dark"` — optional explicit light/dark override
- `data-focus="true" | "false"` — when `"true"`, collapses secondary discovery clutter for deep work
- `data-view="newtab" | "sidepanel"` — sets layout density for Side Panel (`sidepanel.html`) vs Full Gateway (`index.html`)

### 4.2 Required CSS Custom Properties (`css/tokens.css`)
Must define all tokens from Spec §1.2 with smooth `transition: background-color 400ms ease, color 400ms ease, border-color 400ms ease`:
- Surfaces: `--bg-canvas`, `--bg-surface`, `--bg-subtle`, `--bg-wellness`, `--bg-elevated`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Accents & Status: `--accent-primary`, `--accent-primary-hover`, `--accent-calm`, `--accent-danger`, `--accent-warning`
- Chrome & Geometry: `--border-subtle`, `--border-strong`, `--shadow-card`, `--shadow-modal`, `--radius-sm` (`8px`), `--radius-md` (`12px`), `--radius-lg` (`16px`), `--radius-pill` (`999px`)
- Typography: `--font-serif`, `--font-sans`, `--font-mono`

### 4.3 Shared CSS Layout & Component Classes (`css/layout.css`, `css/components.css`)
`M1-T2` MUST style and export clean, reusable classes used by `index.html` and `sidepanel.html`:
- **Shell & Grid (`css/layout.css`)**:
  - `.gateway-shell` (outer container, max-width `1440px`, centered, generous `24px–32px` desktop padding, `CLS = 0` reserved layout)
  - `.gateway-header` (top bar: greeting left, `.wellness-pill` center, `.header-controls` right)
  - `.evening-guardian-banner` (full-width warm anti-overwork recharge card visible in `[data-mood="evening"]` or when toggled)
  - `.gateway-grid` (2-column main workspace on desktop `>= 1024px`: `.col-execution` left, `.col-knowledge` right; 2-col adapted on iPad `768px–1023px`; 1-col with `.mobile-tab-bar` on `<= 767px`)
  - `.discovery-drawer` & `.discovery-drawer.is-collapsed` (bottom collapsible RSS strip + `.discovery-cards-grid` horizontal/responsive card grid)
  - `.sidepanel-shell` (compact single-column `320px–420px` stack for `sidepanel.html`: `.active-tab-hero`, `.wellness-mini-strip`, `.card-panel`)
  - `.mobile-tab-bar` (sticky bottom navigation bar for iPhone/mobile PWA viewports `<= 767px` switching active mobile section `[data-mobile-section]`)
- **Cards, Lists, Controls, Modals & Overlays (`css/components.css`)**:
  - `.card-panel`, `.card-header`, `.card-title`, `.card-badge`, `.card-body`, `.card-footer`
  - `.wellness-pill`, `.btn`, `.btn-primary`, `.btn-calm`, `.btn-ghost`, `.btn-icon`, `.btn-remove` (`×` remove button with accessible hit target)
  - `.pill-badge`, `.channel-badge`, `.tag-pill`, `.link-pill` (`↗` external link badge), `.filter-pills`, `.filter-pill.is-active`
  - `.objective-list`, `.objective-item`, `.objective-item.is-completed`, `.objective-circle`
  - `.progress-strip`, `.progress-bar-track`, `.progress-bar-fill`
  - `.todo-list`, `.todo-item`, `.todo-item.is-completed`, `.tactile-checkbox`
  - `.digest-list`, `.digest-item`, `.digest-actions`
  - `.bookmark-list`, `.bookmark-item`, `.bookmark-meta`, `.btn-star.is-pinned`
  - `.rss-card`, `.rss-card-header`, `.rss-card-title`, `.rss-card-actions`
  - `.quick-add-form`, `.quick-input`, `.inline-add-panel`
  - `<dialog class="gateway-modal">` (native HTML `<dialog>` for Command Palette `#cmd-palette-modal`, Manage RSS Sources `#rss-manager-modal`, Sync Settings `#sync-settings-modal`, and 60s Mindful Breathing `#breathing-modal` with `.breathing-orb` CSS animation!)
  - `.toast-region`, `.toast-message` (polite ARIA live region for action confirmations)

### 4.4 Extension Runtime Message Protocol (`service-worker.js` <-> UI)
Messages sent via `chrome.runtime.sendMessage({ type, payload })`:
- `{ type: 'SYNC_NOW' }` -> triggers `syncWithGist()` in SW, responds `{ ok: true, status, state }`
- `{ type: 'REFRESH_RSS', force: true }` -> triggers `refreshRssFeeds({ force: true })`, responds `{ ok: true, count }`
- `{ type: 'OPEN_SIDE_PANEL', windowId }` -> opens side panel if requested

---

## 5. Python Digest-to-Obsidian Bridge Contract (`bridge/sync_gateway_obsidian.py`)

- **Configuration Precedence**: `CLI flags > Environment variables (CALM_GATEWAY_*) > Config JSON (~/.calm-gateway/config.json or --config / CALM_GATEWAY_CONFIG) > Neutral defaults`.
- **CLI Flags** (non-interactive, safe for schedulers & tests):
  - `--config <path>`: JSON config file path (default `~/.calm-gateway/config.json`).
  - `--init-config` (`--force`): Generates a starter `~/.calm-gateway/config.json` template safely with `0600` permissions.
  - `--state-file <path>`: Local JSON file path mirroring `GatewayState v1` (default `~/.calm-gateway/gateway-state.json`).
  - `--digests-dir <path>`: Directory containing Daily Digest Markdown files (`YYYY-MM-DD*.md`).
  - `--vault-dir <path>`: Obsidian vault root where `Daily/YYYY-MM-DD.md` and `Reading/Bookmarks.md` are atomically exported.
  - `--vault-name <name>` / `--vault-prefix <relpath>`: Optional Obsidian vault name and subfolder prefix for `obsidian://open` wikilink URIs.
  - `--bundle-out <path>`: Optional local JSON bundle path for unpacked extension hydration (e.g., `data/latest-sync.json`).
  - `--gist-id <id>` & `--github-pat-env <ENV_NAME>` (default `CALM_GATEWAY_GITHUB_PAT`): Optional GitHub Gist two-way sync using Python stdlib `urllib.request` (zero external pip dependencies required!).
  - `--dry-run`: Prints summary JSON without writing files or network calls.
- **Two-Way Merge Rules**:
  - Reads `GatewayState v1` JSON, respects `tombstones` so items removed (`×`) in the Gateway UI are NOT re-added from older Digest Markdown files or Gist revisions, and preserves `onboardingCompleted`, `digestConfig`, `layout`, `widgets`, and `background`.
  - Exports `Daily/YYYY-MM-DD.md` (Today's Big 3 Objectives + Tactical TODOs `- [ ]` / `- [x]` + Daily Digest summary) and `Reading/Bookmarks.md` using atomic temp-file + `os.replace()` writes.

---

## 6. Customization, Onboarding & Public Release Extensions (`v1.3 / contentVersion = 3`)

1. **Collapsible Daily Digest Feed (`SLACK_COLLAPSED_LIMIT = 5`)**:
   - `wellness.slackExpanded: boolean` (default `false` -> renders at most 5 digest items via `getVisibleSlackDigestSlice(items, wellness, 5)`).
   - `wellness.slackPanelCollapsed: boolean` (default `false` -> collapses card body when `true`).
   - `digestConfig`: `{ title, subtitle, feedUrl }` supports customizing the digest title and connecting a user-provided HTTPS Digest JSON endpoint.
2. **4-Zone Component Layout & Widget Store (`js/widgets.js` + `state.layout` + `state.widgets`)**:
   - `layout.zones`: `{ top: string[], left: string[], right: string[], bottom: string[] }` across all 12 valid `WIDGET_CATALOG` IDs (`objectives`, `todos`, `weather`, `slack`, `bookmarks`, `discovery`, `pomodoro`, `world-clock`, `scratchpad`, `launchpad`, `habit-tracker`, `system-pulse`).
   - `widgets`: Persists per-widget configs & caches (`weather` with Open-Meteo 30m cache + offline fallback, `pomodoro`, `worldClock` starting with auto-detected local timezone, `scratchpad`, `launchpad`, `habits`).
3. **Daily-Switching Circadian Nerdy Background (`js/backgrounds.js` + `state.background`)**:
   - `background`: `{ mode: 'daily-random' | 'pinned' | 'custom-only' | 'off', pinnedId, categories, moodSync: 'auto' | 'morning' | 'deep-work' | 'evening' | 'night', opacity, blurPx, glassCards, shuffleNonce, customImages[] }`.
   - `resolveActiveBackground()` deterministically selects the daily scene by `YYYY-MM-DD#shuffleNonce` and renders circadian SVG data URIs (`morning`, `deep-work`, `evening`, `night`) or validated `https://` custom wallpapers.
