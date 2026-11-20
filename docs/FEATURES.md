# Calm Morning Gateway — Complete Feature Guide

This document explains every feature in **Calm Morning Gateway** (`v1.3.0`), how each feature works under the hood, and how to configure, rearrange, and test it across **Chrome (New Tab + Side Panel)** and **iPhone / iPad (Standalone PWA)**.

---

## Table of Contents

1. [Widget Store & Weather Forecast (`🧩 Widgets`)](#1-widget-store--weather-forecast--widgets)
2. [Full-Page Component Rearrangement (`📐 Layout`)](#2-full-page-component-rearrangement--layout)
3. [Daily Digest & Team Pulse (Default Collapsed to 5 Items)](#3-daily-digest--team-pulse-default-collapsed-to-5-items)
4. [Daily-Switching & Time-of-Day Nerdy Backgrounds (`🖼️ Wallpaper`)](#4-daily-switching--time-of-day-nerdy-backgrounds-️-wallpaper)
5. [Daily Objectives ("The Big 3") & Tactical TODOs](#5-daily-objectives-the-big-3--tactical-todos)
6. [Rich Item Context, Key Takeaways & Connected Sources Modal](#6-rich-item-context-key-takeaways--connected-sources-modal)
7. [Reading Queue & Portable Discovery Stream (OPML / Starter Packs)](#7-reading-queue--portable-discovery-stream-opml--starter-packs)
8. [Circadian Moods, Anti-Overwork Guardian & 60s Breathing](#8-circadian-moods-anti-overwork-guardian--60s-breathing)
9. [Chrome Companion Side Panel & Context Menus](#9-chrome-companion-side-panel--context-menus)
10. [First-Run Onboarding, Private GitHub Gist Sync & Generic Obsidian Bridge](#10-first-run-onboarding-private-github-gist-sync--generic-obsidian-bridge)
11. [Command Palette & Keyboard Shortcuts](#11-command-palette--keyboard-shortcuts)
12. [Automated Verification & Release Build](#12-automated-verification--release-build)

---

## 1. Widget Store & Weather Forecast (`🧩 Widgets`)

Click **`🧩 Widgets`** in the top header (or press `u` / open `⌘K`) to launch the **Widget Store** (`#widget-store-modal`, powered by `js/widgets.js`).

- **Add or Remove Any Component**: Every widget on the page—both core panels and optional engineering/wellness widgets—can be added (`+ Add to Page`), assigned to a target layout zone (`⤢ Top`, `← Left`, `→ Right`, `⤢ Bottom`), or removed (`× Remove`) at any time.
- **Non-Destructive Removal**: Removing a widget hides it from the dashboard and records a conflict-safe layout tombstone (`widget:<id>`), **without deleting its stored items or settings**. Re-adding it later restores all your data immediately.
- **Filter Tabs**: Browse widgets by `All (12)`, `On Page`, `Available`, `Core Panels`, `Engineering & Weather`, or `Mindful Focus`.

### Built-In Catalog (`12` Components)

| Widget | ID | Default State | Highlights |
| :--- | :--- | :--- | :--- |
| **🌤️ Weather Forecast** | `weather` | **Active (`→ Right`)** | Zero-key Open-Meteo live forecast, 6-hour upcoming trend, 5-day High/Low & rain probability, `°C`/`°F` toggle, global city search + presets + `📍 My Location`, 30m cache, and offline seasonal fallback. |
| **🎯 Daily Objectives** | `objectives` | **Active (`← Left`)** | "The Big 3" daily strategic outcomes with guardrail hint at 3/3, URL extraction, and full context notes. |
| **✅ Tactical TODOs** | `todos` | **Active (`← Left`)** | Daily checklist with live completion progress bar, `#tag` parsing, Clear Completed, and Day Rollover. |
| **💬 Daily Digest & Team Pulse** | `slack` | **Active (`→ Right`)** | Daily team & project takeaways hydrated from a Custom Digest JSON URL, Private GitHub Gist, or optional local bundle, **collapsed to 5 items by default**. |
| **📚 Reading Queue** | `bookmarks` | **Active (`→ Right`)** | Local-first article queue with `#tag` filter tabs, `★` pinning, estimated read time, Read/Archive toggle, and `+ TODO` promotion. |
| **⚡ Discovery Stream** | `discovery` | **Active (`⤢ Bottom`)** | Collapsible RSS/Atom/HTML blog reader with AI & Web Engineering starter feeds, **OPML / JSON Import & Export**, and runtime origin permissions. |
| **⏱️ Focus Pomodoro** | `pomodoro` | Available in Store | `25m Sprint`, `50m Deep Work`, and `5m Recharge` countdown timer synced with your daily mindful break counter. |
| **🌍 Global Chapter Clocks** | `world-clock` | Available in Store | Multi-timezone live clock strip starting with your auto-detected local timezone alongside `UTC`, `San Francisco`, `London`, `Tokyo`, plus `+ Add TZ` / `×`. |
| **📝 Quick Scratchpad** | `scratchpad` | Available in Store | Debounced auto-saving monospace jotter with live word count and two-way Gist sync. |
| **🚀 Quick Dev Launchpad** | `launchpad` | Available in Store | Customizable 1-click shortcut grid (GitHub, GitLab, MDN Docs, Antigravity, Claude, Gemini, plus `+ Shortcut` / `×`). |
| **🌱 Daily Micro-Habits** | `habit-tracker` | Available in Store | Lightweight daily habit check-offs with logged-day counters and `+ Add` / `×` remove. |
| **🖥️ System & Sync Telemetry** | `system-pulse` | Available in Store | Live browser CPU thread count, network link RTT/downlink, viewport & DPR, active widget count, and cache metrics. |

---

## 2. Full-Page Component Rearrangement (`📐 Layout`)

Every active component on the dashboard can be moved freely across **4 layout zones**:
1. **`⤢ Top` (`#zone-top`)** — Full-width deck above the 2-column grid (collapses cleanly to zero height when empty).
2. **`← Left` (`#zone-left`)** — Left workspace column.
3. **`→ Right` (`#zone-right`)** — Right workspace column.
4. **`⤢ Bottom` (`#zone-bottom`)** — Full-width deck below the 2-column grid.

### Three Ways to Rearrange Components
1. **Direct Pointer Drag & Drop (`⠿` Handle)**:
   - Grab the **`⠿`** handle in the top-left of any card header and drag it up, down, into the opposite column, or into the Full-Width Top / Bottom decks.
   - Uses pointer capture, layout midpoint hit-testing, and a crisp fixed drop-line indicator (`--drop-marker-color`) without jittery mid-drag sibling reflows. Press `Esc` mid-drag to cancel cleanly.
2. **Keyboard Grab–Move–Drop (`Space` + Arrow Keys)**:
   - Tab to any card's **`⠿`** handle and press `Space` or `Enter` to grab it (`aria-pressed="true"`).
   - Use `ArrowUp` / `ArrowDown` to move within a zone (or cross into Top/Bottom decks at boundaries) and `ArrowLeft` / `ArrowRight` to jump between Left and Right columns.
   - Press `Space` / `Enter` to drop, or `Esc` to cancel.
3. **Interactive Layout Customize Mode (`📐 Layout` / press `l`)**:
   - Click **`📐 Layout`** in the header to reveal explicit per-card toolbars (`↑ Up`, `↓ Down`, `⤢ Top`, `← Left`, `→ Right`, `⤢ Bottom`, `× Remove`) plus a top banner with **`🧩 + Add / Remove Widgets`** and **`↺ Reset Default Layout`**.
   - On mobile viewports (`<= 767px`), turning on **`📐 Layout`** reveals all zones simultaneously so touch rearrangement works across the entire page.

---

## 3. Daily Digest & Team Pulse (Default Collapsed to 5 Items)

The **💬 Daily Digest** card (`state.digestConfig.title`) stays calm even on busy mornings with 15–30+ items:

- **Default Collapsed to 5 Items (`SLACK_COLLAPSED_LIMIT = 5`)**:
  - On initial load (`state.wellness.slackExpanded = false`), the feed displays **at most 5 items** and shows `5 of N` in the card header badge.
  - Whenever `totalCount > 5`, a dedicated footer button (`#slack-expand-btn`) appears at the bottom of the digest list:
    - Collapsed state: **`Show all 16 digest items (+11 more) ▾`**
    - Expanded state: **`Collapse digest to 5 items ▴`**
- **Custom Title & HTTPS JSON Feed**:
  - In **`⚙️ Sync & Gateway Settings`**, customize the widget's **Title** or enter an optional **Custom Digest JSON URL** (supports both full `GatewayState` JSON and lightweight `{ date, deliveredAt, items: [...] }` JSON). Chrome dynamically prompts for host permission for that origin via `optional_host_permissions`.
- **Full Card Collapse (`Collapse ▴` / `Expand ▾`)**:
  - Click `#slack-body-collapse-btn` in the digest card header to tuck the entire panel body away to a single header line during deep work (`state.wellness.slackPanelCollapsed`).
- **Per-Item Actions**:
  - Click any digest card to open its full **Context, Takeaways & Sources** modal, open the primary link in a new tab (`↗ Open Source`), promote it to **Today's TODOs** (`+ To TODO`), bookmark its URL (`🔖 Save`), or dismiss it (`×` with tombstone protection so re-syncing never resurrects dismissed items).

---

## 4. Daily-Switching & Time-of-Day Nerdy Backgrounds (`🖼️ Wallpaper`)

Click **`🖼️ Wallpaper`** in the header (or press `g`, or use the floating bottom-left pill's `🎲` / `⚙️` buttons) to open the **Nerdy Wallpaper & Circadian Mood Studio** (`js/backgrounds.js`).

### Key Capabilities
- **Automatic Daily Random Switching (`daily-random`)**:
  - Uses a deterministic daily hash (`YYYY-MM-DD` + `shuffleNonce`) so your background **automatically switches to a fresh nerdy artwork every calendar day** while remaining calm and consistent across tabs throughout that day.
  - Click **`🎲 Shuffle Now`** anytime to roll a new wallpaper on demand, or switch to **`📌 Pin Selected Scene`**, **`🌐 Custom Image URLs Only`**, or **`🚫 Off`**.
- **Time-of-Day Circadian Mood & Lighting Adaptation**:
  - Every built-in scene dynamically shifts its sky gradients, celestial bodies (sunrise sunbeams, daylight sun, twilight crescent moon, midnight pixel starfield), window lights, and ambient tint across four phases:
    - **`06:00 – 09:59` (`morning`)**: Warm sunrise amber, terracotta & soft mist.
    - **`10:00 – 17:29` (`deep-work`)**: Calm sage & daylight studio clarity.
    - **`17:30 – 21:59` (`evening`)**: Cozy cedar twilight, warm desk-lamp windows & crescent moon.
    - **`22:00 – 05:59` (`night`)**: Deep obsidian sky, phosphor accents & crisp starlight.
- **12 Built-In Offline-Ready Nerdy Artworks Across 5 Categories**:
  1. **👾 Pixel Art** (`shape-rendering="crispEdges"` + `image-rendering: pixelated`):
     - *16-Bit Cyber-Bonsai Desk*, *8-Bit Rooftop Server Skyline*, *Pixel Quantum Lab & Espresso*, *Pixel Starship Observation Deck*.
  2. **🔌 Circuit & Tech**:
     - *Silicon & Copper PCB Bus*, *Isometric Edge Compute Mesh*, *Transformer Attention Lattice*.
  3. **📐 Modern Architecture**:
     - *Modernist Compiler Geometry*, *Algorithmic Elevation Isolines*, *Spectral Dot-Matrix Studio*.
  4. **🖥️ Retro Terminal**:
     - *Mainframe Phosphor Horizon* (perspective synth grid + subtle CRT scanlines).
  5. **🛰️ Orbital & Sci-Fi**:
     - *Lagrange Orbital Telemetry*.
- **Full Visual Customization**:
  - Toggle which nerdy categories participate in the Daily Random pool.
  - Adjust **Wallpaper Intensity** (`10%–90%`, default `42%`), **Backdrop Blur** (`0px Crisp Pixel` to `16px`), and **Frosted Glass Cards** (`backdrop-filter: blur(14px)`).
  - Add & remove your own **Custom HTTPS Wallpaper URLs** (with optional crisp Pixel scaling mode).

---

## 5. Daily Objectives ("The Big 3") & Tactical TODOs

- **🎯 Daily Objectives**: Focus on up to 3 high-leverage outcomes per day. Supports natural-language URL extraction (`Finalize Q4 RFC https://...`), 1-click completion circles, guardrail hint above 3 items, rich context notes, and `×` removal.
- **✅ Tactical TODOs**: Supports inline `#tag` and URL parsing (`Review PR https://github.com/... #perf`), animated completion progress strip, `Clear Completed` (archives to `archivedLog`), and **`🍵 Wrap Up Day & Rollover`** (archives completed Objectives & TODOs and carries unfinished TODOs cleanly into tomorrow).

---

## 6. Rich Item Context, Key Takeaways & Connected Sources Modal

Nothing on the dashboard is a dry one-liner:
- Click **any row or card** across Objectives, Tactical TODOs, Slack Digest, Reading Queue, or Discovery Stream (or click its **`📖 Context & Sources`** pill) to open `#item-context-modal` (and `#sp-context-modal` in the Side Panel).
- View full background prose, bulleted **Key Takeaways & Decisions**, and clickable **Connected Sources & References** (all validated via `sanitizeHttpUrl` and opening safely in a new tab with `target="_blank" rel="noopener noreferrer"`).
- Edit titles, context notes, takeaways, or attach/detach reference URLs (`https://` or `obsidian://`) inline.

---

## 7. Reading Queue & Portable Discovery Stream (OPML / Starter Packs)

- **📚 Reading Queue**: Save links via quick paste, Discovery Stream `🔖 Queue`, Chrome right-click context menu, Side Panel `🔖 Bookmark Tab`, or `Alt+Shift+S`. Filter dynamically by `#tag` or `Archived / Read`, pin favorites (`★`), or schedule as a TODO (`+ TODO`).
- **⚡ Discovery Stream**: Pre-configured with **10 starter sources** across Frontier AI & Web Engineering (*Google Antigravity Blog*, *Google Gemini Blog*, *Google DeepMind*, *Claude Engineering*, *Claude & Anthropic News*, *OpenAI & ChatGPT*, *Daily.dev*, *Web.dev*, *Chrome Developers*, and *Smashing Magazine*).
- **Starter Packs & OPML Portability**: Inside **`⚙️ Manage RSS`** (`r`), switch between **Restore AI & Web Starter Pack** and **Clear All Sources**, **Import OPML / JSON** (file upload or paste, merge or replace), **Export OPML**, or add any custom RSS 2.0, Atom 1.0, or HTML blog URL (automatically requesting optional host permission for the new origin).

---

## 8. Circadian Moods, Anti-Overwork Guardian & 60s Breathing

- **Wellness Pill**: Rotates gentle micro-prompts (chest stretch, `20-20-20` eye rest, hydration, posture reset, wrist/neck release) and escalates gently after `60+` minutes of continuous focus.
- **Evening Wind-Down Guardian (`17:30+`)**: Automatically surfaces a warm recharge banner summarizing completed tasks and offering 1-click **Guided Breathing** or **Task Rollover to Tomorrow**.
- **60-Second Mindful Breathing (`4-4-6`)**: Press `w` or click `🧘 Breathe` for a guided `4s inhale · 4s hold · 6s exhale` animated orb that automatically logs a mindful break on completion.

---

## 9. Chrome Companion Side Panel & Context Menus

- Click the Chrome toolbar icon to open `sidepanel.html` alongside any webpage (`openPanelOnActionClick: true`).
- Capture the active tab with `#ai`, `#arch`, `#perf`, or `#read-later` tags in 1 click, check off Objectives/TODOs, or right-click any page/link/selection to save to Calm Gateway with instant `✓` badge feedback.

---

## 10. First-Run Onboarding, Private GitHub Gist Sync & Generic Obsidian Bridge

- **First-Run Welcome Setup (`#onboarding-modal`)**: Prompts new installs once for optional display name, weather city or geolocation, starter preset (*Frontier AI & Web Engineering* vs. *Minimal / Blank Slate*), and Daily Digest visibility. Re-open anytime from **Settings** or `⌘K`.
- **Private GitHub Gist Sync (`js/gist-sync.js`)**: Optional two-way sync across Chrome and iPhone/iPad Safari PWA. Your Fine-Grained GitHub PAT is stored strictly in local-only `calm_gateway_credentials_v1` and stripped (`""`) from all Gist payloads and JSON backups.
- **Generic Obsidian & Digest CLI Bridge (`bridge/sync_gateway_obsidian.py`)**:
  - Reads optional configuration from `~/.calm-gateway/config.json` (generate a template with `python3 bridge/sync_gateway_obsidian.py --init-config`), environment variables (`CALM_GATEWAY_*`), or CLI flags (`CLI > Env > Config > Default`).
  - Parses Markdown callouts (`P0`, `P1`, `P2`, `[!todo]+`) and channel headings from your configured `--digests-dir`, optionally mirrors `Daily/YYYY-MM-DD.md` and `Reading/Bookmarks.md` inside `--vault-dir`, and syncs bidirectionally with Private GitHub Gist.

---

## 11. Command Palette & Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘K` / `Ctrl+K` | Open / close universal **Command & Search Palette** |
| `u` | Open **🧩 Widget Store** (add, remove, or relocate any widget) |
| `l` | Toggle **📐 Layout Edit Mode** (rearrange all components on the page) |
| `g` | Open **🖼️ Wallpaper & Circadian Mood Studio** |
| `o` | Focus **Daily Objectives** quick-add input |
| `t` | Focus **Tactical TODOs** quick-add input |
| `b` | Focus **Reading Queue** bookmark input |
| `f` | Toggle **Deep-Work Focus Mode** |
| `m` | Cycle **Circadian Mood** (`Auto` → `Morning` → `Deep Work` → `Evening`) |
| `r` | Open **Manage RSS Sources** modal |
| `w` | Start **60-Second Mindful Breathing (`4-4-6`)** |
| `Space` / `Enter` (on `⠿`) | Grab / drop focused widget for **Arrow-key layout reordering** |
| `Esc` | Cancel active drag/reorder, close open `<dialog>`, or blur input |
| `Alt+Shift+S` | Chrome global shortcut: bookmark active tab to Reading Queue |

---

## 12. Automated Verification & Release Build

Run all zero-network, deterministic verification suites locally:

```bash
# 1. Full Static MV3, CSP, XSS, DOM-Hook Parity, Store, Sync, OPML, Onboarding, Widget, Layout, Digest & Wallpaper Suite
node tests/verify_gateway.mjs

# 2. Itemized Node Test Runner Spec Suite
node --test tests/gateway.test.mjs

# 3. Python Obsidian & Generic Digest Bridge Unit Tests
python3 -B -m unittest discover -s bridge -p "test_*.py" -v

# 4. Build & Leak-Audit Chrome Web Store ZIP Package
node scripts/build-release.mjs
```
