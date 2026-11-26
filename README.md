# Custom Reading Dashboard
A mindful, local-first software engineering workspace across **Chrome New Tab (`index.html`)**, **Chrome Side Panel (`sidepanel.html`)**, **iPhone & iPad PWA (`pwa-manifest.json` + `sw-pwa.js`)**, **Private GitHub Gist Sync**, and a **Generic Obsidian & Markdown CLI Bridge (`bridge/sync_gateway_obsidian.py`)**.

👉 **Full Feature & Customization Reference**: [`docs/FEATURES.md`](docs/FEATURES.md) · **Chrome Web Store Kit**: [`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md) · **Privacy Policy**: [`PRIVACY.md`](PRIVACY.md) · **License**: [`LICENSE`](LICENSE)

---

## Key Highlights

- **👋 First-Run Welcome & Starter Presets (`v1.3.0`)**: Onboard in seconds with an optional display name, weather city or geolocation, *Frontier AI & Web Engineering* vs. *Minimal / Blank Slate* workspace preset, and 1-click Daily Digest toggle.
- **🧩 Widget Store & Weather Forecast (`js/widgets.js`)**: Add or remove **any** of 12 dashboard components on demand—including a zero-key **Open-Meteo Weather Forecast** widget (`°C`/`°F`, hourly trend, 5-day forecast, city search + presets + geolocation, offline fallback), **Focus Pomodoro**, **Global Chapter Clocks**, **Quick Scratchpad**, **Quick Dev Launchpad**, **Daily Micro-Habits**, and **System Telemetry**, alongside all core workspace panels.
- **📐 Rearrange Every Component on the Page**: Drag any card's `⠿` handle across **4 layout zones** (`⤢ Top`, `← Left`, `→ Right`, `⤢ Bottom`), reorder with keyboard (`Space` + Arrow keys), or toggle **`📐 Layout`** (`l`) for 1-click zone placement & reset.
- **💬 Daily Digest & Team Pulse (Default 5 Items)**: Hydrates from a user-configured **Custom Digest JSON URL**, **Private GitHub Gist**, or optional local `data/latest-sync.json`, cleanly **collapsed to 5 items by default** with 1-click expand/collapse.
- **⚡ Portable Discovery Stream & OPML Import/Export**: Pre-loaded with Frontier AI & Web Dev feeds, plus **Starter Pack switching** and **OPML / JSON Import & Export** with runtime optional host permissions.
- **🖼️ Daily-Switching & Time-of-Day Nerdy Backgrounds (`js/backgrounds.js`)**: 12 built-in offline-ready nerdy scenes (**Pixelated 8/16-bit art**, **PCB & Isometric Tech**, **Modern Compiler Geometry**, **Retro CRT Terminal**, **Orbital Telemetry**) + custom HTTPS wallpaper URLs.
- **☁️ Local-First & Zero-Leak Sync**: Instant `0ms` boot via `chrome.storage.local` / `localStorage`, conflict-safe `tombstones`, and optional Private GitHub Gist sync with strict PAT stripping.

---

## Architecture Overview

```text
  Chrome Extension (MV3)                        iPhone & iPad / Mobile
  ├── index.html (4-Zone Customizable Gateway)  ├── Standalone Safari PWA
  ├── sidepanel.html (1-click Quick Capture)    └── Apple Share Sheet Shortcut
  ├── js/widgets.js (Widget Store & Weather)            │
  ├── js/backgrounds.js (Circadian Nerdy Art)           │
  └── service-worker.js (Alarms & ContextMenu)          │
                 │                                      │
                 └──────▶ Private GitHub Gist ◀────────┘
                 │        (gateway-state.json)
                 │                 ▲
                 │                 │ (Optional Generic CLI Bridge)
                 ▼                 ▼
       Optional Digest URL   bridge/sync_gateway_obsidian.py
       or data/latest-sync   ├── Config: ~/.calm-gateway/config.json
                             ├── Reads:  User-configured Digests/*.md
                             └── Writes: Daily/YYYY-MM-DD.md + Reading/Bookmarks.md
```

---

## 1. Install or Reload the Chrome Extension (Unpacked)

1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON (top-right).
3. Click **Load unpacked** (or click **🔄 Reload** if already loaded) and select the cloned repository root directory (`custom-reading-dashboard`).
4. Open a **New Tab** to launch Custom Reading Dashboard, or click the toolbar icon to open the **Side Panel Companion**.

### Build a Clean Chrome Web Store Release Package

```bash
node scripts/build-release.mjs
```

This validates `manifest.json`, verifies zero personal-data or token leaks, and emits a deterministic `dist/calm-morning-gateway-v1.3.0.zip` + `dist/SHA256SUMS.txt`.

### Optional CLI Bridge Setup (Obsidian & Local Digest Markdown)

```bash
python3 bridge/sync_gateway_obsidian.py --init-config
# Edit ~/.calm-gateway/config.json with your digestsDir, vaultDir, and optional gistId
python3 bridge/sync_gateway_obsidian.py --dry-run
```

---

## 2. Documentation Index

- **[`docs/FEATURES.md`](docs/FEATURES.md)** — Detailed guide to every feature, widget, layout gesture, wallpaper setting, OPML portability, and workflow.
- **[`docs/CHROME_WEB_STORE.md`](docs/CHROME_WEB_STORE.md)** — Store listing copy, permission justifications, and data disclosure matrix.
- **[`PRIVACY.md`](PRIVACY.md)** — Local-first privacy policy.
- **[`contracts.md`](contracts.md)** — Shared state schemas (`GatewayState`), security invariants, and module export contracts.
- **[`bridge/ios-shortcut-guide.md`](bridge/ios-shortcut-guide.md)** — Step-by-step iPhone/iPad PWA installation and 1-tap Share Sheet Shortcut recipe.

---

## 3. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘K` / `Ctrl+K` | Open / close Command & Search Palette |
| `u` | Open **🧩 Widget Store** (add or remove any widget) |
| `l` | Toggle **📐 Layout Edit Mode** (rearrange components across zones) |
| `g` | Open **🖼️ Nerdy Wallpaper & Circadian Mood Studio** |
| `o` | Focus **Daily Objectives (Big 3)** quick-add input |
| `t` | Focus **Tactical TODOs** quick-add input |
| `b` | Focus **Reading Queue & Bookmarks** URL input |
| `f` | Toggle **Deep-Work Focus Mode** |
| `m` | Cycle **Circadian Mood** (`Auto` → `Morning` → `Deep Work` → `Evening`) |
| `r` | Open **Manage RSS Sources** modal |
| `w` | Start **60-Second Mindful Breathing** modal (`4-4-6` cycle) |
| `Space` / `Enter` on `⠿` | Grab / drop focused widget for Arrow-key reordering |
| `Esc` | Cancel drag/reorder, close open modal, or blur active input |
| `Alt+Shift+S` | Chrome global command: bookmark active tab to Reading Queue |

---

## 4. Verification & Automated Tests

Run all verification suites (zero external dependencies required):

```bash
# Full MV3, CSP, XSS, DOM Parity, Store, Gist, RSS, OPML, Onboarding, Widget Store, Weather, Layout, Digest & Wallpaper Suite
node tests/verify_gateway.mjs

# Node Built-in Test Runner Spec Suite
node --test tests/gateway.test.mjs

# Python Obsidian & Generic Digest Bridge Unit Tests
python3 -B -m unittest discover -s bridge -p "test_*.py" -v

# Release Bundle Validation & Leak Audit
node scripts/build-release.mjs
```
