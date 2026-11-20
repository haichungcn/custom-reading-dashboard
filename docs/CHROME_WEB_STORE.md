# Chrome Web Store Listing — Calm Morning Gateway

> Last Updated: 2026-11-20

## Store Listing

**Extension Name** [REQUIRED]
Calm Morning Gateway

**Short Description** [REQUIRED]
Mindful morning dashboard: Daily Objectives, TODOs, Daily Digest, Weather, RSS, Widget Store, 4-zone layout, and circadian art.

**Detailed Description** [REQUIRED]
Calm Morning Gateway turns your New Tab page and Chrome Side Panel into a calm, local-first daily workspace without trackers, accounts, or clutter.

Key Features:
- Daily Objectives (The Big 3) and Tactical TODOs with completion progress, tag parsing, rich context notes, and one-click day rollover.
- Daily Digest and Team Pulse card collapsed to 5 items by default, with optional sync from a Private GitHub Gist or your own HTTPS Digest JSON endpoint.
- Customizable 4-Zone Dashboard and 12-Widget Store: drag, keyboard-reorder, add, or remove panels including Weather Forecast, Focus Pomodoro, World Clocks, Quick Scratchpad, Dev Launchpad, Micro-Habits, and System Telemetry.
- Discovery Stream and Reading Queue: built-in AI and web engineering starter feeds, one-click OPML and JSON import/export, and tag-filtered bookmarks with reading-time estimates.
- Chrome Side Panel Companion and Context Menus: capture any active tab, link, or text selection into your Reading Queue or TODO list in one click or with Alt+Shift+S.
- Circadian Themes, Guided Breathing, and Daily Nerdy Wallpapers: adaptive Morning, Deep-Work, and Evening palettes with a 60-second 4-4-6 breathing timer and 12 built-in offline artworks.

How It Works:
1. Open a New Tab to complete the optional quick setup (display name, weather city, and starter preset or clean blank slate).
2. Arrange your favorite widgets across Top, Left, Right, and Bottom zones or toggle Focus Mode whenever you want zero distractions.
3. Click the toolbar icon anytime to open the Side Panel Companion alongside your current tab.
4. Optionally connect a Fine-Grained GitHub Personal Access Token in Settings to sync your dashboard across Chrome and the mobile PWA via your own Private GitHub Gist.

Privacy First:
All workspace data stays in your browser's local storage. There is zero analytics, telemetry, or developer backend, and any optional GitHub sync token never leaves your device except to talk directly to GitHub's API.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Provide a calm, local-first New Tab workspace and Side Panel companion for managing daily objectives, tasks, reading bookmarks, weather, and RSS feeds.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
| :--- | :--- | :--- | :--- |
| Store Icon [REQUIRED] | 128x128 PNG | Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280x800 or 640x400 | Capture from New Tab | Full New Tab morning view with Objectives, Weather & Daily Digest |
| Screenshot 2 [RECOMMENDED] | 1280x800 or 640x400 | Capture from Side Panel | Side Panel Companion capturing an active webpage tab |
| Screenshot 3 [RECOMMENDED] | 1280x800 or 640x400 | Capture from Modals | Widget Store, Layout Edit Mode, & Circadian Wallpaper Studio |
| Small Promo Tile [RECOMMENDED] | 440x280 | Optional | Promotional card for CWS featured sections |

---

## Permissions Justification

| Permission | Type | Justification |
| :--- | :--- | :--- |
| `storage` | permissions | Stores all user objectives, tasks, bookmarks, digest items, RSS sources, layout preferences, and optional local sync settings directly in `chrome.storage.local` so the New Tab and Side Panel stay instantly synchronized offline and across sessions. |
| `sidePanel` | permissions | Displays the compact Calm Gateway Companion (`sidepanel.html`) beside any open webpage when the user clicks the extension toolbar icon, allowing 1-click tab capture and task check-offs without leaving the current page. |
| `tabs` | permissions | Reads the active tab's URL and title on demand inside the Side Panel Companion and when the user triggers the `Alt+Shift+S` shortcut (`activeTab` does not grant access to tab URLs from a Side Panel button click, so `tabs` is required). Browsing history is never logged or transmitted. |
| `contextMenus` | permissions | Adds two right-click menu actions ("Save to Calm Gateway Reading Queue" and "Add to Today's Calm Gateway TODOs") so users can save links, pages, or highlighted text directly into their local workspace. |
| `alarms` | permissions | Schedules lightweight background `chrome.alarms` tasks to clear action-badge checkmarks after saving items and to run optional 15-minute RSS cache and Private GitHub Gist refreshes without keeping a persistent background page alive. |
| `https://api.github.com/*` | host_permissions | Enables optional two-way sync of `gateway-state.json` with the user's own Private GitHub Gist when configured in Sync Settings. |
| `https://api.open-meteo.com/*`, `https://geocoding-api.open-meteo.com/*` | host_permissions | Powers the zero-key Weather Forecast widget's live forecasts, 5-day outlooks, and global city search. |
| Curated starter feed origins (`antigravity.google`, `blog.google`, `www.blog.google`, `deepmind.google`, `openai.com`, `raw.githubusercontent.com`, `www.anthropic.com`, `claude.com`, `api.daily.dev`, `web.dev`, `www.smashingmagazine.com`, `developer.chrome.com`) | host_permissions | Allows the Discovery Stream widget to fetch RSS/Atom updates for the built-in starter engineering and AI feed pack out of the box without extra CORS proxies or intermediate servers. |
| `https://*/*` | optional_host_permissions | Requested dynamically at runtime via `chrome.permissions.request()` only when the user explicitly adds a custom RSS/Atom feed URL, imports an OPML feed list, or configures a custom HTTPS Daily Digest JSON endpoint. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (stored locally on the user's device; transmitted only to user-configured sync targets or Weather/RSS APIs).

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
| :--- | :--- | :--- | :--- | :--- |
| Personally identifiable info | Optional display name only (local) | Only if user enables Private GitHub Gist Sync (stored in user's own private Gist) | Personalized greeting | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | Optional user-supplied GitHub PAT (stored strictly locally) | Sent only in `Authorization` header to `api.github.com` when user enables Gist sync; never included in Gist state payload | Optional two-way Private Gist sync | No |
| Personal communications | No | No | N/A | No |
| Location | City choice or optional browser geolocation | Latitude/longitude coordinates sent to `api.open-meteo.com` when Weather Forecast refreshes | Local weather forecast | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | User-saved bookmark URLs/titles & user tasks | Only if user enables Private GitHub Gist Sync (saved to user's own private Gist) | Local Reading Queue & cross-device sync | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
Host `PRIVACY.md` at your public GitHub repository or GitHub Pages URL (for example: `https://github.com/<your-org>/calm-morning-gateway/blob/main/PRIVACY.md`).

---

## Pre-Publish Checklist

- [x] `manifest_version` is `3` with no remote code or inline scripts.
- [x] Version bumped to `1.3.0` and short description is 127 characters (`<= 132`).
- [x] `node scripts/build-release.mjs` produces clean `dist/calm-morning-gateway-v1.3.0.zip` excluding tests, bridge scripts, docs, and personal files.
- [x] All automated JS, Python, and Snyk security checks pass.

---

## Version History

| Version | Date | Changes | Status |
| :--- | :--- | :--- | :--- |
| `1.3.0` | 2026-11-20 | Public release preparation: neutral defaults, first-run onboarding wizard, Daily Digest & custom JSON feed URL, OPML/JSON RSS import & export, runtime optional host permissions, generic bridge config (`~/.calm-gateway/config.json`), and deterministic CWS packager. | Ready |
