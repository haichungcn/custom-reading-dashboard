# Privacy Policy for Custom Reading Dashboard

**Effective Date:** 2026-11-20  
**Applies to:** Custom Reading Dashboard Chrome Extension (Manifest V3) and Standalone Progressive Web App (PWA)

---

## 1. Local-First Core Architecture

Custom Reading Dashboard is designed to be **local-first and privacy-preserving**:

- **Zero Analytics, Tracking, or Telemetry**: Custom Reading Dashboard does not use Google Analytics, third-party ad networks, tracking pixels, behavioral telemetry, or remote scripts.
- **No Developer Backend**: The extension has no developer-operated server or database. All dashboard data stays on your device unless you explicitly configure an external sync destination.

---

## 2. What Data Is Stored & Where

All workspace data is stored locally in your browser via `chrome.storage.local` (in the Chrome Extension) or `localStorage` (in the Standalone PWA):

- **Workspace Content**: Your optional display name, focus motto, daily objectives, tactical TODOs, daily digest items, reading queue bookmarks, scratchpad notes, launchpad shortcuts, micro-habits, layout zone arrangement, and wallpaper preferences.
- **Weather Preferences**: Your selected city name, coordinates, temperature unit (°C/°F), and a 30-minute cached forecast snapshot.
- **RSS Source List & Cache**: Your enabled RSS/Atom/blog URLs, cached feed articles, and dismissed article URLs.
- **Optional Sync Credentials (`calm_gateway_credentials_v1`)**: If you enter a GitHub Fine-Grained Personal Access Token (PAT) and Gist ID for two-way sync, the PAT is stored **only on your local device** in `calm_gateway_credentials_v1` and is **strictly stripped (`""`)** from every JSON backup export and every GitHub Gist upload (`gateway-state.json`).

---

## 3. Outbound Network Requests (Only When Enabled or Needed)

Custom Reading Dashboard communicates only with the endpoints required for features you use:

1. **Open-Meteo Weather & Geocoding (`api.open-meteo.com`, `geocoding-api.open-meteo.com`)**:
   - When the Weather Forecast widget is active, the extension fetches forecasts for your chosen city (or coordinates if you click **Use My Location** and grant browser geolocation permission). No user identity or browsing history is sent.
2. **RSS / Atom / Blog Discovery Feeds**:
   - The extension fetches articles directly from the enabled RSS/Atom/blog URLs configured in your Manage RSS Sources modal (default curated tech feeds plus any custom feeds you add after granting per-origin permission).
3. **Optional Private GitHub Gist Sync (`api.github.com`)**:
   - Only runs if you explicitly enter a GitHub PAT and Gist ID in **Sync & Gateway Settings**. Your PAT is sent exclusively in the `Authorization: Bearer` header to `https://api.github.com` to read/update your own private `gateway-state.json` Gist.
4. **Optional Custom Daily Digest JSON URL**:
   - Only fetched if you explicitly enter an HTTPS Digest JSON URL in **Sync & Gateway Settings** and grant host permission for that origin.
5. **Active Tab Metadata (`tabs` permission)**:
   - Used strictly on demand when you open the Side Panel, click a context menu item, or trigger the `Alt+Shift+S` shortcut to capture the active tab's URL and title into your local Reading Queue or TODO list. Your browsing history is never logged, monitored in the background, or transmitted.

---

## 4. Data Sharing & Selling

- We **do not sell**, rent, trade, or share any user data with third parties, advertisers, or data brokers.
- Your data is never used for advertising, profiling, creditworthiness, or purposes unrelated to the dashboard's core functionality.

---

## 5. Data Retention, Export & Deletion

- Your data remains locally in your browser until you edit, clear, or delete it.
- You can export a clean JSON backup (with any GitHub PAT stripped) or switch to a **Minimal / Blank Slate** at any time in **Sync & Gateway Settings**.
- Uninstalling the extension (or clearing site storage for the PWA) immediately removes all locally stored extension state and credentials.

---

## 6. Changes & Contact

If this policy changes in a future release, the updated policy and effective date will be published in the repository (`PRIVACY.md`). For privacy questions or security reports, please open an issue on the project's GitHub repository.
