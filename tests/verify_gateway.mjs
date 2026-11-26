import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STORAGE_KEY,
  sanitizeHttpUrl,
  parseQuickInput,
  extractDomain,
  createDefaultState,
  detectLocalTimeZone,
  loadState,
  resetMemoryStoreForTests,
  mergeStates,
  addObjective,
  toggleObjective,
  updateObjective,
  removeObjective,
  addTodo,
  toggleTodo,
  updateTodo,
  removeTodo,
  clearCompletedTodos,
  rolloverDay,
  addSlackItem,
  removeSlackItem,
  promoteSlackToTodo,
  promoteSlackToBookmark,
  importSlackDigest,
  addBookmark,
  updateBookmarkStatus,
  toggleBookmarkPin,
  promoteBookmarkToTodo,
  removeBookmark,
  addRssSource,
  removeRssSource,
  toggleRssSource,
  dismissRssArticle,
  applyRssPresetPack,
  applyStarterPreset,
  exportRssSourcesOpml,
  importRssSourcesOpml,
  parseRssSourcesOpmlOrJson,
  updateDigestConfig,
  syncFromLocalBundle,
  saveSyncCredentials,
  exportCleanStateJson,
} from '../js/store.js';

import {
  GIST_FILENAME,
  serializeStateForGist,
  syncWithGist,
  pullFromGist,
} from '../js/gist-sync.js';

import {
  parseBlogHtml,
  parseFeedXml,
  refreshRssFeeds,
} from '../js/rss-engine.js';

import {
  computeCircadianMood,
  getGreetingData,
  getActiveWellnessPrompt,
  recordBreakTaken,
  getBreathingPhaseAtElapsedMs,
} from '../js/wellness.js';

import { runAllV2FeatureTests } from './verify_v2_features.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buf.subarray(0, 8), pngSig, `${filePath} must have valid PNG signature`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

async function verifyMv3AndStaticRules() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
  assert.equal(manifest.version, '1.3.0', 'manifest version must be bumped to 1.3.0');
  assert.ok(manifest.description.length <= 132, 'manifest description must be <= 132 characters for CWS');
  assert.equal(manifest.chrome_url_overrides?.newtab, 'index.html');
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');
  assert.equal(manifest.background?.service_worker, 'service-worker.js');
  assert.equal(manifest.background?.type, 'module');
  assert.ok(manifest.action && !manifest.action.default_popup, 'action must exist without default_popup');

  for (const perm of ['storage', 'sidePanel', 'tabs', 'contextMenus', 'alarms']) {
    assert.ok(manifest.permissions.includes(perm), `manifest permissions must include ${perm}`);
  }
  assert.ok(!manifest.permissions.includes('activeTab'), 'side panel must use tabs rather than relying on activeTab');
  assert.ok(!manifest.host_permissions.includes('<all_urls>'), 'host_permissions must be scoped, not <all_urls>');

  for (const size of [16, 48, 128]) {
    const rel = manifest.icons[String(size)];
    assert.equal(rel, `icons/icon-${size}.png`);
    const dims = readPngDimensions(path.join(ROOT, rel));
    assert.deepEqual(dims, { width: size, height: size }, `icon-${size}.png must be ${size}x${size}`);
  }

  const pwaManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pwa-manifest.json'), 'utf8'));
  assert.equal(pwaManifest.display, 'standalone');

  // HTML CSP & New-Tab Link checks
  for (const htmlFile of ['index.html', 'sidepanel.html']) {
    const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptTags.length >= 1, `${htmlFile} must load external module script`);
    for (const [, attrs, body] of scriptTags) {
      assert.match(attrs, /\bsrc\s*=/i, `${htmlFile} must have no inline <script> without src`);
      assert.equal(body.trim(), '', `${htmlFile} <script> body must be empty`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${htmlFile} must have zero inline event attributes`);

    const extLinks = [...html.matchAll(/<a\b([^>]*href\s*=\s*["']https?:\/\/[^"']+["'][^>]*)>/gi)];
    for (const [fullTag, attrs] of extLinks) {
      assert.match(attrs, /target\s*=\s*["']_blank["']/i, `${htmlFile} external link missing target="_blank": ${fullTag}`);
      assert.match(attrs, /rel\s*=\s*["'][^"']*noopener[^"']*["']/i, `${htmlFile} external link missing noopener: ${fullTag}`);
    }
  }

  // JS quality & MV3 Service Worker invariants
  const jsFiles = [
    'service-worker.js',
    'sw-pwa.js',
    'js/store.js',
    'js/backgrounds.js',
    'js/widgets.js',
    'js/gist-sync.js',
    'js/rss-engine.js',
    'js/wellness.js',
    'js/app.js',
    'js/sidepanel.js',
  ];

  for (const rel of jsFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Strip comments and string literals lightly for forbidden call checks
    assert.doesNotMatch(src, /\.(then|catch)\s*\(/, `${rel} must use async/await, never .then()/.catch()`);
    assert.doesNotMatch(src, /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/, `${rel} must not use innerHTML/outerHTML/insertAdjacentHTML`);
    assert.doesNotMatch(src, /\beval\s*\(|new\s+Function\s*\(/, `${rel} must not use eval or new Function`);
    assert.doesNotMatch(src, /chrome\.windows\.query\b/, `${rel} must not call non-existent chrome.windows.query`);
    assert.doesNotMatch(src, /openPanelOnActionIconClick/, `${rel} must use openPanelOnActionClick, never openPanelOnActionIconClick`);
  }

  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  assert.match(sw, /openPanelOnActionClick\s*:\s*true/, 'service-worker.js must set openPanelOnActionClick: true');
  assert.match(sw, /chrome\.contextMenus\.create/, 'service-worker.js must register contextMenus');
  assert.match(sw, /setBadgeText/, 'service-worker.js must show badge feedback on context menu actions');
  assert.match(sw, /chrome\.alarms\.create/, 'service-worker.js must schedule periodic work via chrome.alarms');
  assert.doesNotMatch(sw, /\b(setTimeout|setInterval)\s*\(/, 'service-worker.js must not use setTimeout/setInterval');
  assert.match(sw, /return\s+true\s*;/, 'service-worker.js onMessage must return true synchronously');

  // Verify zero personal/company data leaks in packaged extension runtime files
  const runtimeTextFiles = [
    'manifest.json',
    'pwa-manifest.json',
    'index.html',
    'sidepanel.html',
    ...jsFiles,
    'css/tokens.css',
    'css/layout.css',
    'css/components.css',
  ];
  const leakPatterns = [
    /\/Us[e]rs\//,
    /\/opt\/homebr[e]w\//,
    /\bhubbl(?:[e]|esoftware)\b/i,
    /\bst[r]api\b/i,
    /\bho ch[i] minh\b/i,
    /#team-w[e]b\b/i,
    /local\.h[a]i/i,
    /\bcth[a]i\b/i,
    /Good morning, H[a]i/i,
  ];
  for (const rel of runtimeTextFiles) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const pat of leakPatterns) {
      assert.doesNotMatch(content, pat, `Personal leak pattern ${pat} found in ${rel}`);
    }
  }
}

async function verifyStoreCrudAndMerge() {
  resetMemoryStoreForTests();
  const initial = await loadState();
  assert.equal(initial.schemaVersion, 1);
  assert.equal(initial.userName, '', 'Default userName must be neutral empty string');
  assert.equal(initial.onboardingCompleted, false, 'Default onboardingCompleted must be false');
  assert.equal(initial.digestConfig?.title, 'Daily Digest');
  assert.equal(initial.digestConfig?.feedUrl, '');
  assert.equal(
    initial.widgets.worldClock.clocks[0].timeZone,
    detectLocalTimeZone(),
    'Default world clock first entry must auto-detect local timezone'
  );
  assert.ok(initial.rssSources.length >= 10, 'Default state must pre-seed AI (Antigravity, Gemini, Claude, OpenAI) + Web sources');
  for (const expectedId of ['rss_antigravity', 'rss_gemini', 'rss_deepmind', 'rss_claude_eng', 'rss_claude_news', 'rss_openai']) {
    assert.ok(initial.rssSources.some((s) => s.id === expectedId), `Missing AI source ${expectedId}`);
  }
  assert.ok(initial.objectives[0].context.length > 20 && initial.objectives[0].sources.length >= 2, 'Seeded objectives must include rich context & sources');
  assert.ok(initial.slackDigest.items[0].context.length > 20 && initial.slackDigest.items[0].sources.length >= 1, 'Seeded Daily Digest items must include rich context & sources');

  // URL sanitization & quick input shorthand
  assert.equal(sanitizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeHttpUrl('data:text/html,<h1>x</h1>'), null);
  assert.equal(sanitizeHttpUrl('obsidian://open?vault=Engineering'), 'obsidian://open?vault=Engineering');
  assert.equal(sanitizeHttpUrl('obsidian://open?vault=Engineering', false), null);

  const parsed = parseQuickInput('Check CI pipeline https://gitlab.com/org/web/-/merge_requests/482#note_1 #frontend #Perf');
  assert.equal(parsed.url, 'https://gitlab.com/org/web/-/merge_requests/482#note_1');
  assert.equal(parsed.urlLabel, 'gitlab.com');
  assert.deepEqual(parsed.tags, ['frontend', 'perf']);
  assert.equal(extractDomain('https://www.smashingmagazine.com/feed/'), 'smashingmagazine.com');

  // Objectives CRUD
  const obj = await addObjective('Ship Gateway v1 https://github.com/example/calm-gateway');
  assert.equal(obj.urlLabel, 'github.com');
  let st = await toggleObjective(obj.id);
  assert.equal(st.objectives.find((o) => o.id === obj.id).completed, true);
  st = await updateObjective(obj.id, { title: 'Ship Gateway v1.1' });
  assert.equal(st.objectives.find((o) => o.id === obj.id).title, 'Ship Gateway v1.1');
  st = await removeObjective(obj.id);
  assert.equal(st.objectives.find((o) => o.id === obj.id), undefined);
  assert.ok(st.tombstones[obj.id], 'Removed objective must record tombstone');

  // TODOs CRUD + clearCompleted + rolloverDay
  const todo1 = await addTodo('Reply to Alex https://team.slack.com/archives/C123 #frontend');
  const todo2 = await addTodo('Unfinished architecture review #arch');
  await toggleTodo(todo1.id);
  await updateTodo(todo2.id, { text: 'Unfinished architecture review Q4' });
  st = await clearCompletedTodos();
  assert.equal(st.todos.find((t) => t.id === todo1.id), undefined);
  assert.ok(st.archivedLog.length >= 1, 'Completed TODO should move to archivedLog');

  const roll = await rolloverDay('2026-11-20');
  assert.equal(roll.state.activeDate, '2026-11-20');
  assert.ok(roll.carriedOverTodos >= 1);

  // Daily Digest CRUD & cross-panel promotion + tombstone protection
  const slack = await addSlackItem({
    channel: '#frontend',
    badge: 'Decision',
    headline: 'Adopt CSS Anchor Positioning',
    summary: 'Approved for Q4 design system components',
    url: 'https://web.dev/articles/anchor-positioning',
  });
  const promotedTodo = await promoteSlackToTodo(slack.id);
  assert.ok(promotedTodo.text.includes('Adopt CSS Anchor Positioning'));
  const promotedBm = await promoteSlackToBookmark(slack.id);
  assert.equal(promotedBm.domain, 'web.dev');
  st = await removeSlackItem(slack.id);
  assert.ok(st.tombstones[slack.id]);

  // Importing a digest containing a tombstoned ID must NOT resurrect it
  st = await importSlackDigest({
    date: '2026-11-20',
    deliveredAt: '09:00 UTC',
    items: [
      { ...slack, updatedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'slack_fresh_1', channel: '#release-train', badge: 'Release', headline: 'v2.15 cut', summary: 'All green', url: 'https://gitlab.com/r/1' },
    ],
  });
  assert.equal(st.slackDigest.items.find((i) => i.id === slack.id), undefined, 'Tombstoned Digest item must stay deleted');
  assert.ok(st.slackDigest.items.find((i) => i.id === 'slack_fresh_1'));

  // Bookmarks CRUD
  const bm = await addBookmark({ url: 'https://developer.chrome.com/blog/new-in-chrome', title: 'New in Chrome', tags: ['chrome'] });
  assert.equal(bm.domain, 'developer.chrome.com');
  await toggleBookmarkPin(bm.id);
  const bmTodo = await promoteBookmarkToTodo(bm.id);
  assert.ok(bmTodo);
  await updateBookmarkStatus(bm.id, 'archived');
  st = await removeBookmark(bm.id);
  assert.ok(st.tombstones[bm.id]);

  // Custom RSS Source CRUD
  const src = await addRssSource({ name: 'GitLab Eng', xmlUrl: 'https://about.gitlab.com/atom.xml', category: 'infra' });
  st = await toggleRssSource(src.id);
  assert.equal(st.rssSources.find((s) => s.id === src.id).enabled, false);
  st = await removeRssSource(src.id);
  assert.ok(st.tombstones[src.id]);
  st = await dismissRssArticle('https://example.com/noisy-post');
  assert.ok(st.rssCache.dismissedUrls.includes('https://example.com/noisy-post'));

  // PAT Secret Stripping & Two-Way Merge
  await saveSyncCredentials({ gistId: 'abcdef1234567890', githubPat: 'ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK' });
  const cur = await loadState();
  assert.equal(cur.sync.githubPat, 'ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK');
  const exported = exportCleanStateJson(cur);
  assert.ok(!exported.includes('ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK'), 'exportCleanStateJson must strip PAT');
  assert.ok(!serializeStateForGist(cur).includes('ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK'), 'serializeStateForGist must strip PAT');

  const remote = createDefaultState(new Date('2026-11-20T10:00:00Z'));
  remote.todos.push({
    id: 'todo_remote_only',
    text: 'Remote iPhone task',
    completed: false,
    tags: ['mobile'],
    sourceUrl: null,
    sourceLabel: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    completedAt: null,
    updatedAt: '2026-11-20T10:00:00.000Z',
  });
  const merged = mergeStates(cur, remote);
  assert.ok(merged.todos.find((t) => t.id === 'todo_remote_only'), 'mergeStates must preserve remote additions');
  assert.equal(merged.todos.find((t) => t.id === todo1.id), undefined, 'mergeStates must honor local tombstones');

  // Onboarding presets, OPML import/export, and custom Digest JSON hydration
  st = await applyStarterPreset('minimal', {
    userName: 'Alex',
    includeDigestWidget: false,
    markOnboardingComplete: true,
  });
  assert.equal(st.userName, 'Alex');
  assert.equal(st.onboardingCompleted, true);
  assert.equal(st.objectives.length, 0);
  assert.equal(st.todos.length, 0);
  assert.equal(st.slackDigest.items.length, 0);
  assert.equal(st.bookmarks.length, 0);
  assert.equal(st.rssSources.length, 0);
  assert.ok(!st.layout.zones.right.includes('slack'));

  st = await applyStarterPreset('ai-web', { includeDigestWidget: true });
  assert.ok(st.objectives.length >= 2);
  assert.ok(st.rssSources.length >= 10);
  assert.ok(st.layout.zones.right.includes('slack'));

  const exportedOpml = exportRssSourcesOpml(st.rssSources);
  assert.match(exportedOpml, /<opml version="2\.0">/);
  const sampleOpml = `<?xml version="1.0"?>
    <opml version="2.0">
      <body>
        <outline text="Frontend" title="Frontend">
          <outline type="rss" text="MDN Blog" xmlUrl="https://developer.mozilla.org/en-US/blog/rss.xml" htmlUrl="https://developer.mozilla.org/en-US/blog/" />
          <outline type="rss" text="Bad Feed" xmlUrl="javascript:alert(1)" />
        </outline>
      </body>
    </opml>`;
  const parsedOpml = parseRssSourcesOpmlOrJson(sampleOpml);
  assert.equal(parsedOpml.length, 1, 'OPML parser must drop non-http(s) feeds');
  assert.equal(parsedOpml[0].category, 'frontend');

  const mergeOpmlRes = await importRssSourcesOpml(sampleOpml, { mode: 'merge' });
  assert.equal(mergeOpmlRes.importedCount, 1);
  const replaceOpmlRes = await importRssSourcesOpml(
    JSON.stringify([{ name: 'Custom Engineering', xmlUrl: 'https://engineering.example.com/feed.xml', category: 'eng' }]),
    { mode: 'replace' },
  );
  assert.equal(replaceOpmlRes.totalCount, 1);

  st = await applyRssPresetPack('minimal');
  assert.equal(st.rssSources.length, 0);
  st = await applyRssPresetPack('ai-web');
  assert.ok(st.rssSources.length >= 10);

  await assert.rejects(
    async () => updateDigestConfig({ feedUrl: 'javascript:alert(1)' }),
    /valid http/i,
  );
  await updateDigestConfig({ title: 'Engineering Pulse', feedUrl: 'https://digest.example.com/feed.json' });
  const digestSyncRes = await syncFromLocalBundle(async (url) => {
    assert.equal(url, 'https://digest.example.com/feed.json');
    return {
      ok: true,
      json: async () => ({
        date: '2026-11-20',
        deliveredAt: '08:30 UTC',
        items: [
          {
            channel: '#platform',
            badge: 'Release',
            headline: 'Edge router v3 deployed',
            summary: 'Zero elevated 5xx across canary',
            url: 'https://status.example.com/v3',
          },
        ],
      }),
    };
  });
  assert.equal(digestSyncRes.synced, true);
  assert.equal(digestSyncRes.state.slackDigest.items.length, 1);
  assert.equal(digestSyncRes.state.slackDigest.items[0].channel, '#platform');

  const missingBundleRes = await syncFromLocalBundle(async () => ({ ok: false, status: 404 }));
  assert.equal(missingBundleRes.synced, false, 'Missing digest bundle must fail silently');
}

async function verifyGistRssAndWellness() {
  // SSRF / invalid Gist ID rejection
  await assert.rejects(
    async () => pullFromGist('../../users/evil', 'pat_test', async () => ({ ok: true })),
    /Invalid.*Gist ID/i,
  );

  // Mock Gist auto-create flow
  resetMemoryStoreForTests();
  await saveSyncCredentials({ gistId: '', githubPat: 'ghp_test_token_123' });
  let postedBody = null;
  const mockFetch = async (url, init = {}) => {
    if (init.method === 'POST' && url === 'https://api.github.com/gists') {
      postedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 201,
        headers: { get: () => null },
        json: async () => ({
          id: 'a1b2c3d4e5f60718',
          html_url: 'https://gist.github.com/a1b2c3d4e5f60718',
          updated_at: '2026-11-19T12:00:00Z',
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const syncRes = await syncWithGist({ fetchImpl: mockFetch });
  assert.equal(syncRes.status, 'synced');
  assert.equal(syncRes.state.sync.gistId, 'a1b2c3d4e5f60718');
  assert.ok(postedBody.files[GIST_FILENAME], 'Gist payload must include gateway-state.json');
  assert.ok(!postedBody.files[GIST_FILENAME].content.includes('ghp_test_token_123'), 'Gist payload must not leak PAT');

  // RSS 2.0 + Atom 1.0 + HTML Blog + Rich Context/Sources + XSS link filtering
  const rssXml = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item>
        <title><![CDATA[Chrome 138 &amp; Extension Security]]></title>
        <link>https://developer.chrome.com/blog/ext-sec</link>
        <description><![CDATA[<p>Deep dive into MV3 service workers and <a href="https://developer.chrome.com/docs/extensions">Extension Docs</a>.</p><ul><li>Use chrome.alarms instead of setTimeout in background scripts.</li><li>Validate external URLs strictly before rendering links.</li></ul>]]></description>
        <dc:creator>Chrome Team</dc:creator>
        <category>security</category>
        <pubDate>Thu, 19 Nov 2026 08:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Evil XSS Item</title>
        <link>javascript:alert(document.cookie)</link>
      </item>
    </channel></rss>`;
  const rssItems = parseFeedXml(rssXml, { id: 'rss_chrome', name: 'Chrome Devs', siteUrl: 'https://developer.chrome.com' });
  assert.equal(rssItems.length, 1, 'XSS javascript: item must be dropped');
  assert.equal(rssItems[0].title, 'Chrome 138 & Extension Security');
  assert.ok(rssItems[0].summary.includes('Deep dive into MV3 service workers'), 'RSS item must extract summary prose');
  assert.equal(rssItems[0].keyPoints.length, 2, 'RSS item must extract <li> key takeaways');
  assert.ok(rssItems[0].sources.some((s) => s.url === 'https://developer.chrome.com/docs/extensions'), 'RSS item must extract cited links');

  const htmlBlog = `<!doctype html><html><body>
    <a href="/blog/gemini-4-in-antigravity">
      <h3>Gemini 4 Orchestration in Google Antigravity</h3>
      <p>Multi-wave coordination with explicit file write scopes and verification.</p>
      <time datetime="2026-11-19T12:00:00Z">Nov 19, 2026</time>
    </a>
  </body></html>`;
  const blogItems = parseBlogHtml(htmlBlog, {
    id: 'rss_antigravity',
    name: 'Google Antigravity',
    siteUrl: 'https://antigravity.google/blog',
    category: 'antigravity',
  });
  assert.equal(blogItems.length, 1, 'HTML blog parser must extract post cards');
  assert.equal(blogItems[0].url, 'https://antigravity.google/blog/gemini-4-in-antigravity');

  const atomXml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Calm Web Architecture</title>
        <link rel="alternate" href="https://web.dev/articles/calm-arch"/>
        <updated>2026-11-19T09:00:00Z</updated>
      </entry>
    </feed>`;
  const atomItems = parseFeedXml(atomXml, { id: 'rss_webdev', name: 'Web.dev' });
  assert.equal(atomItems.length, 1);
  assert.equal(atomItems[0].url, 'https://web.dev/articles/calm-arch');

  const offlineFeed = await refreshRssFeeds({
    force: true,
    fetchImpl: async () => { throw new Error('Offline in sandbox'); },
  });
  assert.ok(offlineFeed.items.length >= 3, 'Offline refresh must gracefully return curated fallback articles');

  // Wellness & Circadian Mood boundaries
  assert.equal(computeCircadianMood(new Date('2026-11-19T08:15:00')), 'morning');
  assert.equal(computeCircadianMood(new Date('2026-11-19T14:00:00')), 'deep-work');
  assert.equal(computeCircadianMood(new Date('2026-11-19T17:30:00')), 'evening');
  assert.equal(computeCircadianMood(new Date('2026-11-19T08:15:00'), 'evening'), 'evening');

  const neutralGreet = getGreetingData(new Date('2026-11-19T08:15:00'), '');
  assert.equal(neutralGreet.greeting, 'Good morning');

  const greet = getGreetingData(new Date('2026-11-19T18:15:00'), 'Alex');
  assert.equal(greet.isEveningWindDown, true);
  assert.match(greet.greeting, /Good evening, Alex/);

  const prompt = getActiveWellnessPrompt(syncRes.state.wellness, new Date('2026-11-19T18:15:00'));
  assert.equal(prompt.isOverworkWarning, true);

  const afterBreak = await recordBreakTaken(new Date('2026-11-19T10:30:00'));
  assert.equal(afterBreak.wellness.breaksToday, 1);

  assert.equal(getBreathingPhaseAtElapsedMs(2000).phase, 'inhale');
  assert.equal(getBreathingPhaseAtElapsedMs(6000).phase, 'hold');
  assert.equal(getBreathingPhaseAtElapsedMs(10000).phase, 'exhale');
  assert.equal(getBreathingPhaseAtElapsedMs(60000).done, true);
}

await verifyMv3AndStaticRules();
await verifyStoreCrudAndMerge();
await verifyGistRssAndWellness();
await runAllV2FeatureTests();
console.log(`PASS: Custom Reading Dashboard verification suite (${STORAGE_KEY}) — all MV3, CSP, XSS, Store CRUD, Gist Sync, RSS/Atom, Wellness, Widget Store, Weather, Layout, Slack Collapse, and Circadian Wallpaper assertions succeeded.`);
