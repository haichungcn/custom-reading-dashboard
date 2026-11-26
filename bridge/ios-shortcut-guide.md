# iPhone & iPad PWA + 1-Tap Share Sheet Shortcut Guide

Run **Custom Reading Dashboard** as a standalone home-screen PWA on iPhone and iPad, synced bidirectionally with your desktop Chrome extension and optional Obsidian bridge via a **Private GitHub Gist** (`gateway-state.json`).

---

## 1. Create Your Private Sync Token & Gist

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Create a token with **only** `Gists: Read and write` permission (no repository scopes needed).
3. On your Mac in Custom Reading Dashboard (`New Tab` → **`⚙️ Sync Settings`**):
   - Paste your Fine-Grained PAT.
   - Leave **Gist ID** blank and click **Create & Link Private Gist** (or paste an existing 32-char hex Gist ID).
   - Copy the generated **Gist ID** and **PWA URL** (or scan the QR code displayed in Sync Settings).

> **Security Note**: Your PAT is stored locally in `calm_gateway_credentials_v1` and is **never** written into `gateway-state.json` or the Gist payload itself.

---

## 2. Host & Install the Standalone PWA on iPhone / iPad

Because `Custom Reading Dashboard` uses pure static HTML/CSS/ES Modules (`index.html`, `pwa-manifest.json`, `sw-pwa.js`), you can host it anywhere over HTTPS:

- **Option A — GitHub Pages / Cloudflare Pages (Recommended)**:
  Deploy the repository root directory (`index.html`, `pwa-manifest.json`, `sw-pwa.js`, `css/`, `js/`, `icons/`) to a private/public static site (your state stays in your own Private GitHub Gist, never in the static host).
- **Option B — Tailscale / Local HTTPS on Mac**:
  Serve locally via Tailscale Serve (`tailscale serve https / http://127.0.0.1:4173`) while running a local static server in the repo root.

### Add to Home Screen (iOS / iPadOS Safari)
1. Open the hosted URL in **Safari** on your iPhone or iPad (e.g. `https://<your-host>/index.html?gistId=<GIST_ID>`).
2. Tap the **Share** button (`□↑`) → **Add to Home Screen** → **Add**.
3. Launch **Calm Gateway** from your Home Screen:
   - Open **`⚙️ Sync Settings`**, enter your **Gist ID** + **GitHub PAT**, and tap **Save & Sync Now**.
   - On iPhone (`<= 767px`), use the bottom **Mobile Tab Bar** (`Focus`, `Digest`, `Queue`, `Discover`) to switch panels without clutter.
   - On iPad (`768px–1023px`), the 2-column calm workspace adapts automatically in portrait or landscape.

---

## 3. 1-Tap iOS Share Sheet Shortcut: "Save to Calm Gateway"

Save any article from Safari, Slack, X, or Hacker News straight into your **Reading Queue (`Inbox`)** in 1 tap—without even opening the PWA.

### Shortcut Actions (Apple Shortcuts App)

1. Open **Shortcuts** on iPhone/iPad → tap **`+`** → name it **`Save to Calm Gateway`**.
2. Tap the shortcut's info/details **`ⓘ`** icon → enable **Show in Share Sheet** → accept **URLs** and **Safari Web Pages**.
3. Add these actions in order:

   1. **Text** (Store Gist ID):
      `<YOUR_GIST_ID>` → set variable `GistId`.
   2. **Text** (Store Fine-Grained PAT):
      `<YOUR_GITHUB_PAT>` → set variable `GitHubPat`.
   3. **Get Contents of URL** (Pull current `gateway-state.json`):
      - **URL**: `https://api.github.com/gists/[GistId]`
      - **Method**: `GET`
      - **Headers**:
        - `Accept`: `application/vnd.github+json`
        - `Authorization`: `Bearer [GitHubPat]`
        - `X-GitHub-Api-Version`: `2022-11-28`
   4. **Get Dictionary Value**:
      - Key: `files.gateway-state.json.content` from **Contents of URL**
      - Pass into **Get Dictionary from Input** → set variable `GatewayState`.
   5. **Get Current Date** → **Format Date** as ISO 8601 (`yyyy-MM-dd'T'HH:mm:ss'Z'`, UTC) → set variable `NowIso`.
   6. **Text** (Build new `BookmarkItem` JSON):
      ```json
      {
        "id": "bm_ios_[Current Date (Unix Time)]",
        "url": "[Shortcut Input]",
        "title": "[Shortcut Input (Page Title or URL)]",
        "domain": "[Shortcut Input (Host)]",
        "tags": ["ios-share"],
        "status": "inbox",
        "pinned": false,
        "estReadMins": 5,
        "addedAt": "[NowIso]",
        "updatedAt": "[NowIso]"
      }
      ```
   7. **Run JavaScript / Dictionary Merge** (or append to `GatewayState.bookmarks` and update `GatewayState.updatedAt = NowIso`, ensuring `GatewayState.sync.githubPat = ""`).
      - *Tip*: Using the **Actions** / **Scriptable** helper or a 6-line Shortcut dictionary rebuild keeps `bookmarks` clean and avoids overwriting existing items.
   8. **Get Contents of URL** (Push updated `gateway-state.json` back to Gist):
      - **URL**: `https://api.github.com/gists/[GistId]`
      - **Method**: `PATCH`
      - **Headers**:
        - `Accept`: `application/vnd.github+json`
        - `Authorization`: `Bearer [GitHubPat]`
        - `X-GitHub-Api-Version`: `2022-11-28`
        - `Content-Type`: `application/json`
      - **Request Body** (`JSON`):
        ```json
        {
          "files": {
            "gateway-state.json": {
              "content": "[UpdatedGatewayStateJSON]"
            }
          }
        }
        ```
   9. **Show Notification**: `"Saved to Calm Gateway Reading Queue"`.

### Verification Tip
- Run the shortcut once on any `https://web.dev` article, then press **`🔄 Sync`** (or open a New Tab) on your Mac Chrome extension—the link appears immediately at the top of **Reading Queue** and is exported to Obsidian `Reading/Bookmarks.md` on the next Python bridge run.
