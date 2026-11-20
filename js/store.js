/**
 * Calm Morning Gateway — Universal Reactive Store (`js/store.js`)
 *
 * Works identically across Chrome MV3 Extension (New Tab / Side Panel / Service Worker),
 * iOS Safari PWA (`localStorage`), and Node.js unit tests (in-memory `Map` fallback).
 */

import { BACKGROUND_CATEGORIES, BACKGROUND_PACK } from './backgrounds.js';
import { POPULAR_WEATHER_CITIES, VALID_WIDGET_IDS, WIDGET_CATALOG } from './widgets.js';

export const STORAGE_KEY = 'calm_gateway_state_v1';
export const CREDENTIALS_KEY = 'calm_gateway_credentials_v1';
export const CONTENT_ENRICHMENT_VERSION = 3;
export const SLACK_COLLAPSED_LIMIT = 5;
export const WIDGET_ZONES = ['top', 'left', 'right', 'bottom'];

export const DEFAULT_LAYOUT_ZONES = {
  top: [],
  left: ['objectives', 'todos'],
  right: ['weather', 'slack', 'bookmarks'],
  bottom: ['discovery']
};

const SEED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/**
 * Canonical preset sources across Frontier AI Labs (Antigravity, Gemini, Claude, OpenAI)
 * and Web Platform Engineering (Daily.dev, Web.dev, Chrome Devs, Smashing Magazine).
 */
export const DEFAULT_RSS_SOURCES = [
  {
    id: 'rss_antigravity',
    name: 'Google Antigravity',
    xmlUrl: 'https://antigravity.google/blog',
    siteUrl: 'https://antigravity.google/blog',
    category: 'antigravity',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_gemini',
    name: 'Google Gemini Blog',
    xmlUrl: 'https://blog.google/products/gemini/rss/',
    siteUrl: 'https://blog.google/products/gemini/',
    category: 'gemini',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_deepmind',
    name: 'Google DeepMind',
    xmlUrl: 'https://deepmind.google/blog/rss.xml',
    siteUrl: 'https://deepmind.google/discover/blog/',
    category: 'gemini',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_claude_eng',
    name: 'Claude Engineering',
    xmlUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml',
    siteUrl: 'https://www.anthropic.com/engineering',
    category: 'claude',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_claude_news',
    name: 'Claude & Anthropic News',
    xmlUrl: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
    siteUrl: 'https://www.anthropic.com/news',
    category: 'claude',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_openai',
    name: 'OpenAI & ChatGPT',
    xmlUrl: 'https://openai.com/news/rss.xml',
    siteUrl: 'https://openai.com/news/',
    category: 'chatgpt',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_dailydev',
    name: 'Daily.dev',
    xmlUrl: 'https://api.daily.dev/rss/b/eed5dc32-699a-46c0-a6c5-8d2c6f4fb7eb',
    siteUrl: 'https://app.daily.dev',
    category: 'engineering',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_webdev',
    name: 'Web.dev',
    xmlUrl: 'https://web.dev/feed.xml',
    siteUrl: 'https://web.dev',
    category: 'web',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_chromedevs',
    name: 'Chrome Developers',
    xmlUrl: 'https://developer.chrome.com/static/blog/feed.xml',
    siteUrl: 'https://developer.chrome.com',
    category: 'chrome',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  },
  {
    id: 'rss_smashing',
    name: 'Smashing Magazine',
    xmlUrl: 'https://www.smashingmagazine.com/feed/',
    siteUrl: 'https://www.smashingmagazine.com',
    category: 'frontend',
    enabled: true,
    updatedAt: SEED_TIMESTAMP
  }
];

const memoryStorage = new Map();
const listeners = new Set();

let cachedSnapshot = null;
let lastNotifiedSerialized = '';
let crossContextListenersRegistered = false;
let stateMutationChain = Promise.resolve();

/**
 * Deep-clone plain JSON-compatible state values safely.
 * @param {any} value
 * @returns {any}
 */
function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Format a Date as local YYYY-MM-DD (avoids UTC day-shift for local timezones).
 * @param {Date} [date]
 * @returns {string}
 */
function formatLocalDate(date = new Date()) {
  const validDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = String(validDate.getFullYear());
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate a unique entity ID with a readable prefix.
 * @param {string} prefix
 * @returns {string}
 */
function generateId(prefix) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/**
 * Parse an ISO timestamp into epoch ms, or NaN if invalid.
 * @param {unknown} value
 * @returns {number}
 */
function parseTimestampMs(value) {
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
  return Date.parse(value);
}

/**
 * Return the chronologically newer of two ISO timestamps (or fallback).
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [fallback]
 * @returns {string}
 */
function maxIsoTimestamp(a, b, fallback = new Date().toISOString()) {
  const msA = parseTimestampMs(a);
  const msB = parseTimestampMs(b);
  if (Number.isNaN(msA) && Number.isNaN(msB)) return fallback;
  if (Number.isNaN(msA)) return String(b);
  if (Number.isNaN(msB)) return String(a);
  return msA >= msB ? String(a) : String(b);
}

/**
 * Normalize an array of lowercase tag strings without leading '#'.
 * @param {unknown} rawTags
 * @returns {string[]}
 */
function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const result = [];
  for (const tag of rawTags) {
    if (typeof tag !== 'string') continue;
    const cleaned = tag.trim().replace(/^#+/, '').toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

/**
 * Normalize an array of concise bullet takeaway strings.
 * @param {unknown} rawPoints
 * @returns {string[]}
 */
function normalizeKeyPoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  const result = [];
  const seen = new Set();
  for (const pt of rawPoints) {
    if (typeof pt !== 'string') continue;
    const cleaned = pt.trim().replace(/^[-*•]\s*/, '');
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

/**
 * Normalize an array of reference source objects `{ label, url, kind? }`.
 * Ensures primaryUrl (when provided) is always represented first without duplicates.
 * @param {unknown} rawSources
 * @param {string | null} [primaryUrl]
 * @param {string | null} [primaryLabel]
 * @param {boolean} [allowObsidian=true]
 * @returns {Array<{ label: string, url: string, kind: string }>}
 */
export function normalizeSourcesList(rawSources, primaryUrl = null, primaryLabel = null, allowObsidian = true) {
  const result = [];
  const seenUrls = new Set();

  const addCandidate = (urlCandidate, labelCandidate, kindCandidate = 'reference') => {
    const validUrl = sanitizeHttpUrl(urlCandidate, allowObsidian);
    if (!validUrl || seenUrls.has(validUrl)) return;
    seenUrls.add(validUrl);
    const fallbackLabel = extractDomain(validUrl) || 'Source';
    const cleanLabel = typeof labelCandidate === 'string' && labelCandidate.trim()
      ? labelCandidate.trim()
      : fallbackLabel;
    const cleanKind = typeof kindCandidate === 'string' && kindCandidate.trim()
      ? kindCandidate.trim()
      : 'reference';
    result.push({ label: cleanLabel, url: validUrl, kind: cleanKind });
  };

  if (primaryUrl) {
    addCandidate(primaryUrl, primaryLabel || extractDomain(primaryUrl) || 'Primary Source', 'primary');
  }

  if (Array.isArray(rawSources)) {
    for (const src of rawSources) {
      if (typeof src === 'string') {
        addCandidate(src, null, 'reference');
      } else if (src && typeof src === 'object') {
        addCandidate(src.url, src.label || src.title, src.kind || 'reference');
      }
    }
  }

  return result;
}

/**
 * Validate and sanitize an external URL.
 * Permits only `http:`, `https:`, and optionally `obsidian:`.
 * @param {string} rawUrl
 * @param {boolean} [allowObsidian=true]
 * @returns {string | null}
 */
export function sanitizeHttpUrl(rawUrl, allowObsidian = true) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return parsed.hostname ? parsed.href : null;
    }
    if (allowObsidian && protocol === 'obsidian:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract display domain from a URL (without leading "www.").
 * @param {string} url
 * @returns {string}
 */
export function extractDomain(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol.toLowerCase() === 'obsidian:') return 'obsidian';
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Trim unbalanced trailing sentence punctuation from a matched URL token.
 * @param {string} candidate
 * @returns {string}
 */
function trimUrlCandidate(candidate) {
  let result = candidate.replace(/[.,;:!?]+$/, '');
  while (result.endsWith(')')) {
    const opens = (result.match(/\(/g) || []).length;
    const closes = (result.match(/\)/g) || []).length;
    if (closes > opens) {
      result = result.slice(0, -1).replace(/[.,;:!?]+$/, '');
    } else {
      break;
    }
  }
  while (result.endsWith(']')) {
    const opens = (result.match(/\[/g) || []).length;
    const closes = (result.match(/\]/g) || []).length;
    if (closes > opens) {
      result = result.slice(0, -1).replace(/[.,;:!?]+$/, '');
    } else {
      break;
    }
  }
  return result;
}

/**
 * Parse natural shorthand input for objectives, TODOs, and quick bookmarks.
 * Extracts first valid http/https URL, #tags, urlLabel, and cleaned text.
 * @param {string} rawText
 * @returns {{ cleanText: string, url: string | null, urlLabel: string | null, tags: string[] }}
 */
export function parseQuickInput(rawText) {
  if (typeof rawText !== 'string') {
    return { cleanText: '', url: null, urlLabel: null, tags: [] };
  }

  let workingText = rawText;
  let extractedUrl = null;
  let urlLabel = null;

  const urlRegex = /https?:\/\/[^\s<>"'`{}|\\^[\]]+/gi;
  let match = urlRegex.exec(workingText);
  while (match !== null) {
    const rawCandidate = match[0];
    const trimmedCandidate = trimUrlCandidate(rawCandidate);
    const validUrl = sanitizeHttpUrl(trimmedCandidate, false);
    if (validUrl) {
      extractedUrl = validUrl;
      urlLabel = extractDomain(validUrl) || null;
      const before = workingText.slice(0, match.index);
      const trailingPunct = rawCandidate.slice(trimmedCandidate.length);
      const after = workingText.slice(match.index + rawCandidate.length);
      workingText = `${before} ${trailingPunct}${after}`;
      break;
    }
    match = urlRegex.exec(workingText);
  }

  const tags = [];
  const seenTags = new Set();
  workingText = workingText.replace(/(^|\s)#([a-zA-Z0-9][a-zA-Z0-9_-]*)/g, (full, prefix, rawTag) => {
    // Avoid treating bare issue numbers like "#42" as tags; require at least one letter.
    if (!/[a-zA-Z]/.test(rawTag)) {
      return full;
    }
    const lowerTag = rawTag.toLowerCase();
    if (!seenTags.has(lowerTag)) {
      seenTags.add(lowerTag);
      tags.push(lowerTag);
    }
    return prefix;
  });

  const cleanText = workingText.replace(/\s+/g, ' ').trim();
  return {
    cleanText,
    url: extractedUrl,
    urlLabel,
    tags
  };
}

/**
 * Estimate reading time in minutes (integer >= 1) from title/text and URL.
 * @param {string} titleOrText
 * @param {string} [url]
 * @returns {number}
 */
export function estimateReadMinutes(titleOrText, url = '') {
  const text = typeof titleOrText === 'string' ? titleOrText.trim() : '';
  const safeUrl = typeof url === 'string' ? url : '';
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

  if (words >= 220) {
    return Math.max(1, Math.ceil(words / 220));
  }

  const combined = `${text} ${safeUrl}`.toLowerCase();
  if (/\b(rfc|architecture|deep[- ]dive|handbook|specification|guide|postmortem|internals)\b/.test(combined)) {
    return 8;
  }
  if (/\b(release|changelog|tip|snippet|quick|summary|announce)\b/.test(combined)) {
    return 3;
  }
  if (words >= 9) {
    return 6;
  }
  return 5;
}

/**
 * Detect the browser or OS IANA timezone safely, falling back to 'UTC'.
 * @returns {string}
 */
export function detectLocalTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz.trim()) {
      new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }).format(new Date());
      return tz.trim();
    }
  } catch {
    // Fall through to UTC
  }
  return 'UTC';
}

/**
 * Format a clean display label from an IANA timezone string.
 * @param {string} timeZone
 * @returns {string}
 */
function formatTimeZoneLabel(timeZone) {
  if (!timeZone || timeZone === 'UTC') return 'UTC';
  const parts = String(timeZone).split('/');
  const leaf = parts[parts.length - 1] || timeZone;
  return leaf.replace(/_/g, ' ').trim() || 'Local';
}

/**
 * Build default World Clock entries starting with the auto-detected local timezone.
 * @returns {Array<{ id: string, label: string, timeZone: string, updatedAt: string }>}
 */
function buildDefaultWorldClocks() {
  const localTz = detectLocalTimeZone();
  const clocks = [
    {
      id: 'wc_local',
      label: formatTimeZoneLabel(localTz),
      timeZone: localTz,
      updatedAt: SEED_TIMESTAMP
    }
  ];
  const hubs = [
    { id: 'wc_utc', label: 'UTC', timeZone: 'UTC' },
    { id: 'wc_sfo', label: 'San Francisco', timeZone: 'America/Los_Angeles' },
    { id: 'wc_lon', label: 'London', timeZone: 'Europe/London' },
    { id: 'wc_tyo', label: 'Tokyo', timeZone: 'Asia/Tokyo' },
    { id: 'wc_sgp', label: 'Singapore', timeZone: 'Asia/Singapore' }
  ];
  for (const hub of hubs) {
    if (clocks.length >= 5) break;
    if (hub.timeZone === localTz) continue;
    clocks.push({ ...hub, updatedAt: SEED_TIMESTAMP });
  }
  return clocks;
}

/**
 * Select a neutral default Weather city matching the local timezone (or San Francisco fallback).
 * @param {string} [localTz]
 */
function detectDefaultWeatherLocation(localTz = detectLocalTimeZone()) {
  const matched = POPULAR_WEATHER_CITIES.find((city) => city.timezone === localTz);
  const chosen = matched || POPULAR_WEATHER_CITIES[0];
  return {
    locationName: chosen.locationName,
    country: chosen.country,
    latitude: chosen.latitude,
    longitude: chosen.longitude,
    timezone: chosen.timezone,
    unit: 'celsius',
    cache: null,
    updatedAt: SEED_TIMESTAMP
  };
}

/**
 * Build the default pre-seeded GatewayState v1.
 * @param {Date} [now]
 * @returns {import('./types').GatewayState}
 */
export function createDefaultState(now = new Date()) {
  const validNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowIso = validNow.toISOString();
  const todayStr = formatLocalDate(validNow);
  const yesterday = new Date(validNow.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = formatLocalDate(yesterday);
  const localTz = detectLocalTimeZone();
  const defaultWeather = detectDefaultWeatherLocation(localTz);

  return {
    schemaVersion: 1,
    contentVersion: CONTENT_ENRICHMENT_VERSION,
    updatedAt: nowIso,
    activeDate: todayStr,
    userName: '',
    onboardingCompleted: false,
    focusTheme: 'Clarity over volume.',
    digestConfig: {
      title: 'Daily Digest',
      subtitle: 'Team & Project Pulse',
      feedUrl: ''
    },

    objectives: [
      {
        id: 'obj_seed_1',
        title: 'Finalize Q4 Architecture & Agentic Workflow RFC',
        url: 'https://antigravity.google/blog',
        urlLabel: 'antigravity.google',
        context: 'Align the engineering team on standardized multi-agent coding workflows, Core Web Vitals budgets (INP < 150ms, zero CLS), and reusable UI primitives.',
        keyPoints: [
          'Lock shared contracts first before parallelizing frontend & backend implementation waves.',
          'Adopt Baseline native <dialog>, CSS Anchor Positioning, and View Transitions instead of heavy JS runtime wrappers.',
          'Document verification gates and SAST security checks in repository engineering guidelines.'
        ],
        sources: [
          { label: 'Google Antigravity Engineering Blog', url: 'https://antigravity.google/blog', kind: 'primary' },
          { label: 'Claude Engineering — Agent Harnesses', url: 'https://www.anthropic.com/engineering', kind: 'reference' },
          { label: 'Web.dev — Optimize INP', url: 'https://web.dev/articles/optimize-inp', kind: 'spec' }
        ],
        completed: false,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP
      },
      {
        id: 'obj_seed_2',
        title: 'Review Edge Gateway 504 Timeout RCA & Rollout Guardrails',
        url: 'https://web.dev/articles/optimize-ttfb',
        urlLabel: 'web.dev',
        context: 'Verify upstream origin keep-alive timeouts, connection pool saturation metrics, and conservative CDN cache TTL guardrails ahead of the scheduled rollout.',
        keyPoints: [
          'Ensure origin idle timeout exceeds load-balancer keep-alive timeout by at least 5 seconds.',
          'Stage canary at 10% traffic for 30 minutes while monitoring P95 TTFB and 5xx rates.',
          'Document postmortem lessons in the shared team engineering handbook.'
        ],
        sources: [
          { label: 'Web.dev — Optimize TTFB Guide', url: 'https://web.dev/articles/optimize-ttfb', kind: 'primary' },
          { label: 'Google SRE — Postmortem Culture', url: 'https://sre.google/sre-book/postmortem-culture/', kind: 'reference' }
        ],
        completed: false,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP
      }
    ],

    todos: [
      {
        id: 'todo_seed_1',
        text: 'Configure optional Private GitHub Gist sync or JSON backup',
        completed: false,
        tags: ['sync', 'setup'],
        sourceUrl: 'https://docs.github.com/en/rest/gists',
        sourceLabel: 'docs.github.com',
        context: 'Optionally add a Fine-Grained GitHub PAT (Gists read/write scope only) in Settings to sync your dashboard across desktop Chrome and mobile PWA.',
        keyPoints: [
          'Tokens stay strictly in local browser storage and are stripped before uploading gateway-state.json.',
          'You can also import/export clean JSON backups or connect a custom Daily Digest JSON endpoint anytime.'
        ],
        sources: [
          { label: 'GitHub Gists REST API Docs', url: 'https://docs.github.com/en/rest/gists', kind: 'primary' }
        ],
        createdAt: SEED_TIMESTAMP,
        completedAt: null,
        updatedAt: SEED_TIMESTAMP
      },
      {
        id: 'todo_seed_2',
        text: 'Evaluate Gemini, Claude, and OpenAI Responses API patterns for dev tooling',
        completed: false,
        tags: ['ai', 'architecture'],
        sourceUrl: 'https://blog.google/products/gemini/',
        sourceLabel: 'blog.google',
        context: 'Compare structured output contracts, prompt caching, and background subagent delegation across Gemini, Claude Code, and OpenAI Responses APIs for engineering workflows.',
        keyPoints: [
          'Compare latency vs reasoning depth for coordinator tiers and fast execution workers.',
          'Capture recommended patterns in the Reading Queue under #ai and #architecture.'
        ],
        sources: [
          { label: 'Google Gemini Product Blog', url: 'https://blog.google/products/gemini/', kind: 'primary' },
          { label: 'Anthropic Engineering Blog', url: 'https://www.anthropic.com/engineering', kind: 'reference' },
          { label: 'OpenAI Developer News', url: 'https://openai.com/news/', kind: 'reference' }
        ],
        createdAt: SEED_TIMESTAMP,
        completedAt: null,
        updatedAt: SEED_TIMESTAMP
      }
    ],

    archivedLog: [],

    slackDigest: {
      date: yesterdayStr,
      deliveredAt: '09:00 UTC',
      items: [
        {
          id: 'slack_seed_1',
          channel: '#engineering',
          badge: 'Decision',
          headline: 'Edge Gateway rollout window & cache TTL guardrails',
          summary: 'Agreed to keep CDN cache TTL conservative during the first 24 hours after cutover and gate full traffic behind automated synthetic checks.',
          context: 'Consensus between Frontend and Platform Infra: deploy during core coverage hours, keep edge stale-while-revalidate enabled, and verify auth headers on staging before promoting.',
          keyPoints: [
            'Stage canary deployment with an automated rollback script ready.',
            'Keep CDN TTL at 300s for the first 24h before restoring 1h caching.',
            'Verify OAuth callback and CSP headers across dev and staging.'
          ],
          url: 'https://web.dev/articles/optimize-ttfb',
          sources: [
            { label: 'Web.dev — Edge TTFB Best Practices', url: 'https://web.dev/articles/optimize-ttfb', kind: 'primary' },
            { label: 'Google SRE — Canary Rollouts', url: 'https://sre.google/sre-book/postmortem-culture/', kind: 'reference' }
          ],
          createdAt: SEED_TIMESTAMP,
          updatedAt: SEED_TIMESTAMP
        },
        {
          id: 'slack_seed_2',
          channel: '#release',
          badge: 'Release',
          headline: 'v4.18 canary metrics steady with 0 regression alerts',
          summary: 'P95 edge TTFB remained within 18ms baseline across regional POPs; client error budget sits at 99.94%.',
          context: 'Automated release summary: v4.18 shipped 14 frontend improvements including accessible dialog focus handling and route-level bundle splitting.',
          keyPoints: [
            'P95 TTFB steady at 18ms across regional edge POPs.',
            'Zero client-side error regressions over the 4-hour canary window.',
            'Next scheduled release cut: Tuesday 10:00 UTC.'
          ],
          url: 'https://developer.chrome.com/docs/web-platform/view-transitions',
          sources: [
            { label: 'Chrome View Transitions Docs', url: 'https://developer.chrome.com/docs/web-platform/view-transitions', kind: 'primary' }
          ],
          createdAt: SEED_TIMESTAMP,
          updatedAt: SEED_TIMESTAMP
        }
      ]
    },

    bookmarks: [
      {
        id: 'bm_seed_1',
        url: 'https://antigravity.google/blog',
        title: 'Google Antigravity Blog — Agentic Engineering & Multi-Model Orchestration',
        domain: 'antigravity.google',
        tags: ['antigravity', 'ai', 'architecture'],
        status: 'inbox',
        pinned: true,
        estReadMins: 7,
        context: 'Official engineering announcements and architectural guides from the Google Antigravity team covering agentic workflows, CLI & SDK automation, and parallel multi-agent orchestration.',
        keyPoints: [
          'Pair high-reasoning coordinator models with fast execution workers and explicit file write scopes.',
          'Use skills, MCP integrations, and state-bound verification to prevent context drift.'
        ],
        sources: [
          { label: 'Google Antigravity Blog', url: 'https://antigravity.google/blog', kind: 'primary' },
          { label: 'Google DeepMind Blog', url: 'https://deepmind.google/discover/blog/', kind: 'reference' }
        ],
        addedAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP
      },
      {
        id: 'bm_seed_2',
        url: 'https://www.anthropic.com/engineering',
        title: 'Anthropic Engineering — Building Effective Agent Harnesses & Claude Code',
        domain: 'anthropic.com',
        tags: ['claude', 'ai', 'engineering'],
        status: 'inbox',
        pinned: true,
        estReadMins: 8,
        context: 'Deep technical write-ups from Anthropic Engineering on designing minimal, composable agent loops, context compaction strategies, tool-use ergonomics, and scaling autonomous coding workflows.',
        keyPoints: [
          'Prefer simple, inspectable workflows and deterministic verification commands over opaque abstractions.',
          'Isolate subagent exploration so raw tool outputs do not pollute the primary coordinator window.'
        ],
        sources: [
          { label: 'Anthropic Engineering Blog', url: 'https://www.anthropic.com/engineering', kind: 'primary' },
          { label: 'Anthropic Newsroom', url: 'https://www.anthropic.com/news', kind: 'reference' }
        ],
        addedAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP
      },
      {
        id: 'bm_seed_3',
        url: 'https://web.dev/articles/anchor-positioning',
        title: 'CSS Anchor Positioning Guide',
        domain: 'web.dev',
        tags: ['css', 'architecture'],
        status: 'inbox',
        pinned: false,
        estReadMins: 8,
        context: 'Comprehensive guide to tethering popovers, tooltips, and menus natively in CSS with automatic viewport collision flipping and zero main-thread scroll listeners.',
        keyPoints: [
          'Eliminates heavy JS positioning libraries and layout thrashing on scroll.',
          'Pairs cleanly with the native HTML Popover API and <dialog>.'
        ],
        sources: [
          { label: 'Web.dev — CSS Anchor Positioning', url: 'https://web.dev/articles/anchor-positioning', kind: 'primary' },
          { label: 'Chrome Developers — View Transitions', url: 'https://developer.chrome.com/docs/web-platform/view-transitions', kind: 'reference' }
        ],
        addedAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP
      }
    ],

    rssSources: cloneValue(DEFAULT_RSS_SOURCES),

    rssCache: {
      fetchedAt: null,
      items: [],
      dismissedUrls: []
    },

    wellness: {
      moodOverride: 'auto',
      colorScheme: 'auto',
      focusMode: false,
      rssCollapsed: false,
      slackExpanded: false,
      slackPanelCollapsed: false,
      breaksToday: 0,
      lastBreakAt: null,
      promptIndex: 0,
      activeMinutesStart: nowIso
    },

    layout: {
      editMode: false,
      zones: cloneValue(DEFAULT_LAYOUT_ZONES),
      updatedAt: SEED_TIMESTAMP
    },

    widgets: {
      weather: defaultWeather,
      pomodoro: {
        workMins: 25,
        breakMins: 5,
        completedSessions: 0,
        updatedAt: SEED_TIMESTAMP
      },
      worldClock: {
        clocks: buildDefaultWorldClocks()
      },
      scratchpad: {
        text: '',
        updatedAt: SEED_TIMESTAMP
      },
      launchpad: {
        links: [
          { id: 'lp_github', label: 'GitHub', url: 'https://github.com', icon: '🐙', updatedAt: SEED_TIMESTAMP },
          { id: 'lp_gitlab', label: 'GitLab', url: 'https://gitlab.com', icon: '🦊', updatedAt: SEED_TIMESTAMP },
          { id: 'lp_mdn', label: 'MDN Docs', url: 'https://developer.mozilla.org', icon: '📘', updatedAt: SEED_TIMESTAMP },
          { id: 'lp_antigravity', label: 'Antigravity', url: 'https://antigravity.google/blog', icon: '🚀', updatedAt: SEED_TIMESTAMP },
          { id: 'lp_claude', label: 'Claude', url: 'https://claude.ai', icon: '🟠', updatedAt: SEED_TIMESTAMP },
          { id: 'lp_gemini', label: 'Gemini', url: 'https://gemini.google.com', icon: '✨', updatedAt: SEED_TIMESTAMP }
        ]
      },
      habits: {
        items: [
          { id: 'hb_water', label: '💧 Hydrate (2L water)', completedDates: [], updatedAt: SEED_TIMESTAMP },
          { id: 'hb_deepwork', label: '🧘 90m Deep-Work Block', completedDates: [], updatedAt: SEED_TIMESTAMP },
          { id: 'hb_walk', label: '🌿 Outdoor / Window Stretch', completedDates: [], updatedAt: SEED_TIMESTAMP },
          { id: 'hb_cutoff', label: '🍵 Unplug on time (17:30)', completedDates: [], updatedAt: SEED_TIMESTAMP }
        ]
      }
    },

    background: {
      mode: 'daily-random',
      pinnedId: 'pixel-cyber-bonsai',
      categories: BACKGROUND_CATEGORIES.map((c) => c.id),
      moodSync: 'auto',
      opacity: 0.42,
      blurPx: 0,
      glassCards: true,
      shuffleNonce: 0,
      customImages: [],
      updatedAt: SEED_TIMESTAMP
    },

    sync: {
      gistId: '',
      githubPat: '',
      lastSyncedAt: null,
      lastSyncStatus: 'local-only',
      lastSyncError: null
    },

    tombstones: {}
  };
}

/**
 * Normalize an arbitrary raw object into a valid GatewayState v1.
 * Sanitizes URLs and fills missing fields cleanly without mutating the input.
 * @param {any} raw
 * @returns {any}
 */
function normalizeState(raw) {
  const defaults = createDefaultState();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const nowIso = new Date().toISOString();

  const normalizeObjective = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) return null;
    const url = sanitizeHttpUrl(item.url, true);
    const urlLabel = url
      ? (typeof item.urlLabel === 'string' && item.urlLabel.trim() ? item.urlLabel.trim() : extractDomain(url) || null)
      : null;
    const context = typeof item.context === 'string' ? item.context.trim() : '';
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    const sources = normalizeSourcesList(item.sources, url, urlLabel, true);
    return {
      id: item.id,
      title,
      url,
      urlLabel,
      context,
      keyPoints,
      sources,
      completed: Boolean(item.completed),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : (typeof item.createdAt === 'string' ? item.createdAt : nowIso)
    };
  };

  const normalizeTodo = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return null;
    const sourceUrl = sanitizeHttpUrl(item.sourceUrl, true);
    const sourceLabel = typeof item.sourceLabel === 'string' && item.sourceLabel.trim()
      ? item.sourceLabel.trim()
      : (sourceUrl ? extractDomain(sourceUrl) || null : null);
    const completed = Boolean(item.completed);
    const context = typeof item.context === 'string' ? item.context.trim() : '';
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    const sources = normalizeSourcesList(item.sources, sourceUrl, sourceLabel, true);
    return {
      id: item.id,
      text,
      completed,
      tags: normalizeTags(item.tags),
      sourceUrl,
      sourceLabel,
      context,
      keyPoints,
      sources,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso,
      completedAt: completed ? (typeof item.completedAt === 'string' ? item.completedAt : nowIso) : null,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : (typeof item.createdAt === 'string' ? item.createdAt : nowIso)
    };
  };

  const normalizeArchived = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return null;
    return {
      id: item.id,
      kind: item.kind === 'objective' ? 'objective' : 'todo',
      text,
      date: typeof item.date === 'string' && item.date ? item.date : defaults.activeDate,
      completedAt: typeof item.completedAt === 'string' ? item.completedAt : nowIso
    };
  };

  const normalizeSlackItem = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const headline = typeof item.headline === 'string' ? item.headline.trim() : '';
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    if (!headline && !summary) return null;
    const rawChannel = typeof item.channel === 'string' && item.channel.trim() ? item.channel.trim() : '#general';
    const channel = rawChannel.startsWith('#') ? rawChannel : `#${rawChannel}`;
    const url = sanitizeHttpUrl(item.url, true);
    const context = typeof item.context === 'string' ? item.context.trim() : '';
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    const sources = normalizeSourcesList(item.sources, url, `${channel} Thread`, true);
    return {
      id: item.id,
      channel,
      badge: typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : null,
      headline: headline || summary,
      summary,
      context,
      keyPoints,
      url,
      sources,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : (typeof item.createdAt === 'string' ? item.createdAt : nowIso)
    };
  };

  const normalizeBookmark = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const url = sanitizeHttpUrl(item.url, true);
    if (!url) return null;
    const domain = typeof item.domain === 'string' && item.domain.trim() ? item.domain.trim() : extractDomain(url);
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : (domain || url);
    const context = typeof item.context === 'string' ? item.context.trim() : '';
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    const sources = normalizeSourcesList(item.sources, url, domain || title, true);
    return {
      id: item.id,
      url,
      title,
      domain,
      tags: normalizeTags(item.tags),
      status: item.status === 'archived' ? 'archived' : 'inbox',
      pinned: Boolean(item.pinned),
      estReadMins: Number.isFinite(item.estReadMins) && item.estReadMins > 0
        ? Math.round(item.estReadMins)
        : estimateReadMinutes(`${title} ${context}`, url),
      context,
      keyPoints,
      sources,
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : nowIso,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : (typeof item.addedAt === 'string' ? item.addedAt : nowIso)
    };
  };

  const normalizeRssSource = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) return null;
    const xmlUrl = sanitizeHttpUrl(item.xmlUrl, false);
    if (!xmlUrl) return null;
    const siteUrl = sanitizeHttpUrl(item.siteUrl, false) || new URL(xmlUrl).origin;
    return {
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : extractDomain(xmlUrl),
      xmlUrl,
      siteUrl,
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().toLowerCase() : 'general',
      enabled: item.enabled !== false,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso
    };
  };

  const normalizeRssArticle = (item) => {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string') return null;
    const url = sanitizeHttpUrl(item.url, false);
    if (!url) return null;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) return null;
    const sourceName = typeof item.sourceName === 'string' && item.sourceName.trim() ? item.sourceName.trim() : extractDomain(url);
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    const keyPoints = normalizeKeyPoints(item.keyPoints);
    const sources = normalizeSourcesList(item.sources, url, sourceName, false);
    const author = typeof item.author === 'string' && item.author.trim() ? item.author.trim() : null;
    const categories = normalizeTags(item.categories);
    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : generateId('rssitem'),
      sourceId: typeof item.sourceId === 'string' ? item.sourceId : '',
      sourceName,
      title,
      url,
      summary,
      keyPoints,
      sources,
      author,
      categories,
      publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : nowIso,
      estReadMins: Number.isFinite(item.estReadMins) && item.estReadMins > 0
        ? Math.round(item.estReadMins)
        : estimateReadMinutes(`${title} ${summary}`, url)
    };
  };

  const tombstones = {};
  if (raw.tombstones && typeof raw.tombstones === 'object' && !Array.isArray(raw.tombstones)) {
    for (const [id, ts] of Object.entries(raw.tombstones)) {
      if (id && typeof ts === 'string' && !Number.isNaN(Date.parse(ts))) {
        tombstones[id] = ts;
      }
    }
  }

  const validMoods = new Set(['auto', 'morning', 'deep-work', 'evening']);
  const validSchemes = new Set(['auto', 'light', 'dark']);
  const validSyncStatuses = new Set(['local-only', 'synced', 'syncing', 'error']);

  const rawWellness = raw.wellness && typeof raw.wellness === 'object' ? raw.wellness : {};
  const rawSync = raw.sync && typeof raw.sync === 'object' ? raw.sync : {};
  const rawSlack = raw.slackDigest && typeof raw.slackDigest === 'object' ? raw.slackDigest : {};
  const rawCache = raw.rssCache && typeof raw.rssCache === 'object' ? raw.rssCache : {};

  const dismissedUrls = [];
  if (Array.isArray(rawCache.dismissedUrls)) {
    const seenUrls = new Set();
    for (const candidate of rawCache.dismissedUrls) {
      const clean = sanitizeHttpUrl(candidate, false);
      if (clean && !seenUrls.has(clean)) {
        seenUrls.add(clean);
        dismissedUrls.push(clean);
      }
    }
  }

  const hasLegacyUserActivity = Boolean(
    (typeof raw.userName === 'string' && raw.userName.trim())
    || (typeof raw.sync?.gistId === 'string' && raw.sync.gistId.trim())
    || (Array.isArray(raw.archivedLog) && raw.archivedLog.length > 0)
  );
  const onboardingCompleted = typeof raw.onboardingCompleted === 'boolean'
    ? raw.onboardingCompleted
    : hasLegacyUserActivity;

  const rawDigestCfg = raw.digestConfig && typeof raw.digestConfig === 'object' ? raw.digestConfig : {};
  const digestConfig = {
    title: typeof rawDigestCfg.title === 'string' && rawDigestCfg.title.trim()
      ? rawDigestCfg.title.trim().slice(0, 60)
      : defaults.digestConfig.title,
    subtitle: typeof rawDigestCfg.subtitle === 'string' && rawDigestCfg.subtitle.trim()
      ? rawDigestCfg.subtitle.trim().slice(0, 80)
      : defaults.digestConfig.subtitle,
    feedUrl: sanitizeHttpUrl(rawDigestCfg.feedUrl, false) || ''
  };

  const normalized = {
    schemaVersion: 1,
    contentVersion: Number.isFinite(raw.contentVersion) ? Number(raw.contentVersion) : CONTENT_ENRICHMENT_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : defaults.updatedAt,
    activeDate: typeof raw.activeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.activeDate)
      ? raw.activeDate
      : defaults.activeDate,
    userName: typeof raw.userName === 'string' ? raw.userName.trim() : defaults.userName,
    onboardingCompleted,
    focusTheme: typeof raw.focusTheme === 'string' && raw.focusTheme.trim() ? raw.focusTheme.trim() : defaults.focusTheme,
    digestConfig,

    objectives: Array.isArray(raw.objectives) ? raw.objectives.map(normalizeObjective).filter(Boolean) : defaults.objectives,
    todos: Array.isArray(raw.todos) ? raw.todos.map(normalizeTodo).filter(Boolean) : defaults.todos,
    archivedLog: Array.isArray(raw.archivedLog) ? raw.archivedLog.map(normalizeArchived).filter(Boolean) : [],

    slackDigest: {
      date: typeof rawSlack.date === 'string' && rawSlack.date ? rawSlack.date : defaults.slackDigest.date,
      deliveredAt: typeof rawSlack.deliveredAt === 'string' && rawSlack.deliveredAt ? rawSlack.deliveredAt : defaults.slackDigest.deliveredAt,
      items: Array.isArray(rawSlack.items) ? rawSlack.items.map(normalizeSlackItem).filter(Boolean) : defaults.slackDigest.items
    },

    bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks.map(normalizeBookmark).filter(Boolean) : defaults.bookmarks,
    rssSources: Array.isArray(raw.rssSources) ? raw.rssSources.map(normalizeRssSource).filter(Boolean) : defaults.rssSources,

    rssCache: {
      fetchedAt: typeof rawCache.fetchedAt === 'string' && !Number.isNaN(Date.parse(rawCache.fetchedAt))
        ? rawCache.fetchedAt
        : null,
      items: Array.isArray(rawCache.items) ? rawCache.items.map(normalizeRssArticle).filter(Boolean) : [],
      dismissedUrls
    },

    wellness: {
      moodOverride: validMoods.has(rawWellness.moodOverride) ? rawWellness.moodOverride : 'auto',
      colorScheme: validSchemes.has(rawWellness.colorScheme) ? rawWellness.colorScheme : 'auto',
      focusMode: Boolean(rawWellness.focusMode),
      rssCollapsed: Boolean(rawWellness.rssCollapsed),
      slackExpanded: Boolean(rawWellness.slackExpanded),
      slackPanelCollapsed: Boolean(rawWellness.slackPanelCollapsed),
      breaksToday: Number.isFinite(rawWellness.breaksToday) && rawWellness.breaksToday >= 0
        ? Math.floor(rawWellness.breaksToday)
        : 0,
      lastBreakAt: typeof rawWellness.lastBreakAt === 'string' ? rawWellness.lastBreakAt : null,
      promptIndex: Number.isFinite(rawWellness.promptIndex) && rawWellness.promptIndex >= 0
        ? Math.floor(rawWellness.promptIndex)
        : 0,
      activeMinutesStart: typeof rawWellness.activeMinutesStart === 'string' && !Number.isNaN(Date.parse(rawWellness.activeMinutesStart))
        ? rawWellness.activeMinutesStart
        : nowIso
    },

    layout: normalizeLayoutBlock(raw.layout, defaults.layout),
    widgets: normalizeWidgetsBlock(raw.widgets, defaults.widgets, nowIso),
    background: normalizeBackgroundBlock(raw.background, defaults.background),

    sync: {
      gistId: typeof rawSync.gistId === 'string' ? rawSync.gistId.trim() : '',
      githubPat: typeof rawSync.githubPat === 'string' ? rawSync.githubPat.trim() : '',
      lastSyncedAt: typeof rawSync.lastSyncedAt === 'string' ? rawSync.lastSyncedAt : null,
      lastSyncStatus: validSyncStatuses.has(rawSync.lastSyncStatus) ? rawSync.lastSyncStatus : 'local-only',
      lastSyncError: typeof rawSync.lastSyncError === 'string' ? rawSync.lastSyncError : null
    },

    tombstones
  };

  // Non-destructive enrichment migration for existing v1 stores lacking AI feeds & item context/sources.
  if (Number(raw.contentVersion || 1) < CONTENT_ENRICHMENT_VERSION) {
    const existingSourceIds = new Set(normalized.rssSources.map((s) => s.id));
    const existingXmlUrls = new Set(normalized.rssSources.map((s) => s.xmlUrl));
    const newlyAddedSources = [];
    for (const preset of DEFAULT_RSS_SOURCES) {
      if (normalized.tombstones[preset.id]) continue;
      if (existingSourceIds.has(preset.id) || existingXmlUrls.has(preset.xmlUrl)) continue;
      newlyAddedSources.push(cloneValue(preset));
    }
    if (newlyAddedSources.length > 0) {
      normalized.rssSources = [...newlyAddedSources, ...normalized.rssSources];
      normalized.rssCache.fetchedAt = null;
    }

    const enrichById = (items, seedItems) => {
      const seedMap = new Map(seedItems.map((s) => [s.id, s]));
      for (const item of items) {
        const seed = seedMap.get(item.id);
        if (!seed) continue;
        if (!item.context && seed.context) item.context = seed.context;
        if ((!item.keyPoints || item.keyPoints.length === 0) && seed.keyPoints) {
          item.keyPoints = cloneValue(seed.keyPoints);
        }
        if ((!item.sources || item.sources.length === 0) && seed.sources) {
          item.sources = cloneValue(seed.sources);
        }
        if ('url' in seed && !item.url && seed.url) {
          item.url = seed.url;
          if ('urlLabel' in seed && !item.urlLabel) item.urlLabel = seed.urlLabel;
        }
        if ('sourceUrl' in seed && !item.sourceUrl && seed.sourceUrl) {
          item.sourceUrl = seed.sourceUrl;
          if ('sourceLabel' in seed && !item.sourceLabel) item.sourceLabel = seed.sourceLabel;
        }
      }
    };

    enrichById(normalized.objectives, defaults.objectives);
    enrichById(normalized.todos, defaults.todos);
    enrichById(normalized.slackDigest.items, defaults.slackDigest.items);
    enrichById(normalized.bookmarks, defaults.bookmarks);

    // Also seed AI blog bookmarks if none of the new AI bookmarks exist and not tombstoned.
    const existingBmUrls = new Set(normalized.bookmarks.map((b) => b.url));
    for (const seedBm of defaults.bookmarks) {
      if (normalized.tombstones[seedBm.id] || existingBmUrls.has(seedBm.url)) continue;
      if (seedBm.tags.includes('ai')) {
        normalized.bookmarks.unshift(cloneValue(seedBm));
      }
    }

    if (normalized.rssCache.items.some((it) => !it.summary)) {
      normalized.rssCache.fetchedAt = null;
    }

    // Ensure upgraded v1/v2 stores include the Weather Forecast widget if not explicitly configured yet
    if (!raw.layout && !isWidgetActive(normalized, 'weather') && !normalized.tombstones['widget:weather']) {
      normalized.layout.zones.right = ['weather', ...normalized.layout.zones.right.filter((id) => id !== 'weather')];
    }

    normalized.contentVersion = CONTENT_ENRICHMENT_VERSION;
  }

  return normalized;
}

/**
 * Normalize layout zones (`top`, `left`, `right`, `bottom`) without duplicate widget IDs.
 * @param {any} rawLayout
 * @param {any} defaultLayout
 */
function normalizeLayoutBlock(rawLayout, defaultLayout) {
  if (!rawLayout || typeof rawLayout !== 'object' || !rawLayout.zones || typeof rawLayout.zones !== 'object') {
    return cloneValue(defaultLayout);
  }

  const seen = new Set();
  const zones = { top: [], left: [], right: [], bottom: [] };
  for (const zone of WIDGET_ZONES) {
    const rawList = Array.isArray(rawLayout.zones[zone]) ? rawLayout.zones[zone] : [];
    for (const id of rawList) {
      if (typeof id === 'string' && VALID_WIDGET_IDS.has(id) && !seen.has(id)) {
        seen.add(id);
        zones[zone].push(id);
      }
    }
  }

  return {
    editMode: Boolean(rawLayout.editMode),
    zones,
    updatedAt: typeof rawLayout.updatedAt === 'string' && !Number.isNaN(Date.parse(rawLayout.updatedAt))
      ? rawLayout.updatedAt
      : defaultLayout.updatedAt
  };
}

/**
 * Normalize per-widget state (`weather`, `pomodoro`, `worldClock`, `scratchpad`, `launchpad`, `habits`).
 */
function normalizeWidgetsBlock(rawWidgets, defaultWidgets, nowIso) {
  const rw = rawWidgets && typeof rawWidgets === 'object' ? rawWidgets : {};

  const rawWeather = rw.weather && typeof rw.weather === 'object' ? rw.weather : {};
  const lat = Number(rawWeather.latitude);
  const lon = Number(rawWeather.longitude);
  const weather = {
    locationName: typeof rawWeather.locationName === 'string' && rawWeather.locationName.trim()
      ? rawWeather.locationName.trim()
      : defaultWidgets.weather.locationName,
    country: typeof rawWeather.country === 'string' ? rawWeather.country.trim() : defaultWidgets.weather.country,
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : defaultWidgets.weather.latitude,
    longitude: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : defaultWidgets.weather.longitude,
    timezone: typeof rawWeather.timezone === 'string' && rawWeather.timezone.trim()
      ? rawWeather.timezone.trim()
      : defaultWidgets.weather.timezone,
    unit: rawWeather.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    cache: rawWeather.cache && typeof rawWeather.cache === 'object' ? cloneValue(rawWeather.cache) : null,
    updatedAt: typeof rawWeather.updatedAt === 'string' ? rawWeather.updatedAt : defaultWidgets.weather.updatedAt
  };

  const rawPomo = rw.pomodoro && typeof rw.pomodoro === 'object' ? rw.pomodoro : {};
  const pomodoro = {
    workMins: Number.isFinite(Number(rawPomo.workMins)) && Number(rawPomo.workMins) >= 1
      ? Math.min(120, Math.round(Number(rawPomo.workMins)))
      : defaultWidgets.pomodoro.workMins,
    breakMins: Number.isFinite(Number(rawPomo.breakMins)) && Number(rawPomo.breakMins) >= 1
      ? Math.min(60, Math.round(Number(rawPomo.breakMins)))
      : defaultWidgets.pomodoro.breakMins,
    completedSessions: Number.isFinite(Number(rawPomo.completedSessions)) && Number(rawPomo.completedSessions) >= 0
      ? Math.floor(Number(rawPomo.completedSessions))
      : 0,
    updatedAt: typeof rawPomo.updatedAt === 'string' ? rawPomo.updatedAt : defaultWidgets.pomodoro.updatedAt
  };

  const rawClocks = Array.isArray(rw.worldClock?.clocks) ? rw.worldClock.clocks : defaultWidgets.worldClock.clocks;
  const clocks = [];
  const seenClockIds = new Set();
  for (const clk of rawClocks) {
    if (!clk || typeof clk !== 'object' || typeof clk.timeZone !== 'string' || !clk.timeZone.trim()) continue;
    const id = typeof clk.id === 'string' && clk.id.trim() ? clk.id.trim() : generateId('wc');
    if (seenClockIds.has(id)) continue;
    seenClockIds.add(id);
    clocks.push({
      id,
      label: typeof clk.label === 'string' && clk.label.trim() ? clk.label.trim() : clk.timeZone.trim(),
      timeZone: clk.timeZone.trim(),
      updatedAt: typeof clk.updatedAt === 'string' ? clk.updatedAt : nowIso
    });
  }

  const rawScratch = rw.scratchpad && typeof rw.scratchpad === 'object' ? rw.scratchpad : {};
  const scratchpad = {
    text: typeof rawScratch.text === 'string' ? rawScratch.text : '',
    updatedAt: typeof rawScratch.updatedAt === 'string' ? rawScratch.updatedAt : defaultWidgets.scratchpad.updatedAt
  };

  const rawLinks = Array.isArray(rw.launchpad?.links) ? rw.launchpad.links : defaultWidgets.launchpad.links;
  const links = [];
  const seenLinkIds = new Set();
  for (const lnk of rawLinks) {
    if (!lnk || typeof lnk !== 'object') continue;
    const url = sanitizeHttpUrl(lnk.url, true);
    if (!url) continue;
    const id = typeof lnk.id === 'string' && lnk.id.trim() ? lnk.id.trim() : generateId('lp');
    if (seenLinkIds.has(id)) continue;
    seenLinkIds.add(id);
    links.push({
      id,
      label: typeof lnk.label === 'string' && lnk.label.trim() ? lnk.label.trim() : (extractDomain(url) || 'Shortcut'),
      url,
      icon: typeof lnk.icon === 'string' && lnk.icon.trim() ? lnk.icon.trim().slice(0, 4) : '🔗',
      updatedAt: typeof lnk.updatedAt === 'string' ? lnk.updatedAt : nowIso
    });
  }

  const rawHabits = Array.isArray(rw.habits?.items) ? rw.habits.items : defaultWidgets.habits.items;
  const habitItems = [];
  const seenHabitIds = new Set();
  for (const hb of rawHabits) {
    if (!hb || typeof hb !== 'object' || typeof hb.label !== 'string' || !hb.label.trim()) continue;
    const id = typeof hb.id === 'string' && hb.id.trim() ? hb.id.trim() : generateId('hb');
    if (seenHabitIds.has(id)) continue;
    seenHabitIds.add(id);
    const completedDates = Array.isArray(hb.completedDates)
      ? Array.from(new Set(hb.completedDates.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))))
      : [];
    habitItems.push({
      id,
      label: hb.label.trim(),
      completedDates,
      updatedAt: typeof hb.updatedAt === 'string' ? hb.updatedAt : nowIso
    });
  }

  return {
    weather,
    pomodoro,
    worldClock: { clocks },
    scratchpad,
    launchpad: { links },
    habits: { items: habitItems }
  };
}

/**
 * Normalize background wallpaper settings (`state.background`).
 */
function normalizeBackgroundBlock(rawBg, defaultBg) {
  if (!rawBg || typeof rawBg !== 'object') {
    return cloneValue(defaultBg);
  }
  const validModes = new Set(['daily-random', 'pinned', 'custom-only', 'off']);
  const validMoodSyncs = new Set(['auto', 'morning', 'deep-work', 'evening', 'night']);
  const validCatIds = new Set(BACKGROUND_CATEGORIES.map((c) => c.id));

  const categories = Array.isArray(rawBg.categories)
    ? Array.from(new Set(rawBg.categories.filter((c) => validCatIds.has(c))))
    : cloneValue(defaultBg.categories);

  const customImages = [];
  const seenUrls = new Set();
  if (Array.isArray(rawBg.customImages)) {
    for (const img of rawBg.customImages) {
      if (!img || typeof img !== 'object') continue;
      const cleanUrl = sanitizeHttpUrl(img.url, false);
      if (!cleanUrl || seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);
      customImages.push({
        id: typeof img.id === 'string' && img.id.trim() ? img.id.trim() : generateId('bgcustom'),
        name: typeof img.name === 'string' && img.name.trim()
          ? img.name.trim()
          : (typeof img.label === 'string' && img.label.trim() ? img.label.trim() : (extractDomain(cleanUrl) || 'Custom Wallpaper')),
        category: 'custom',
        isPixelArt: Boolean(img.isPixelArt),
        url: cleanUrl,
        updatedAt: typeof img.updatedAt === 'string' ? img.updatedAt : defaultBg.updatedAt
      });
    }
  }

  const rawOpacity = Number(rawBg.opacity);
  const rawBlur = Number(rawBg.blurPx);
  const pinnedCandidate = typeof rawBg.pinnedId === 'string' && rawBg.pinnedId.trim()
    ? rawBg.pinnedId.trim()
    : defaultBg.pinnedId;
  const validPinned = BACKGROUND_PACK.some((s) => s.id === pinnedCandidate)
    || customImages.some((c) => c.id === pinnedCandidate);

  return {
    mode: validModes.has(rawBg.mode) ? rawBg.mode : 'daily-random',
    pinnedId: validPinned ? pinnedCandidate : defaultBg.pinnedId,
    categories: categories.length > 0 ? categories : cloneValue(defaultBg.categories),
    moodSync: validMoodSyncs.has(rawBg.moodSync) ? rawBg.moodSync : 'auto',
    opacity: Number.isFinite(rawOpacity) ? Math.min(0.92, Math.max(0.08, rawOpacity)) : defaultBg.opacity,
    blurPx: Number.isFinite(rawBlur) ? Math.min(20, Math.max(0, Math.round(rawBlur))) : defaultBg.blurPx,
    glassCards: rawBg.glassCards !== false,
    shuffleNonce: Number.isFinite(Number(rawBg.shuffleNonce)) ? Math.max(0, Math.floor(Number(rawBg.shuffleNonce))) : 0,
    customImages,
    updatedAt: typeof rawBg.updatedAt === 'string' && !Number.isNaN(Date.parse(rawBg.updatedAt))
      ? rawBg.updatedAt
      : defaultBg.updatedAt
  };
}

/**
 * Resolve the active storage adapter dynamically (chrome.storage.local -> localStorage -> Map).
 */
function hasChromeStorage() {
  return Boolean(globalThis.chrome?.storage?.local);
}

function getLocalStorageRef() {
  try {
    if (typeof globalThis.window !== 'undefined') {
      const candidate = globalThis.window.localStorage || globalThis.localStorage;
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        return candidate;
      }
      return null;
    }
    const execArgv = globalThis.process?.execArgv;
    if (Array.isArray(execArgv) && execArgv.some((arg) => arg.startsWith('--localstorage-file'))) {
      const candidate = globalThis.localStorage;
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function storageGet(keys) {
  if (hasChromeStorage()) {
    return await globalThis.chrome.storage.local.get(keys);
  }
  const out = {};
  const ls = getLocalStorageRef();
  if (ls) {
    for (const key of keys) {
      const raw = ls.getItem(key);
      if (raw !== null) {
        try {
          out[key] = JSON.parse(raw);
        } catch {
          out[key] = null;
        }
      }
    }
    return out;
  }
  for (const key of keys) {
    if (memoryStorage.has(key)) {
      out[key] = cloneValue(memoryStorage.get(key));
    }
  }
  return out;
}

async function storageSet(entries) {
  if (hasChromeStorage()) {
    await globalThis.chrome.storage.local.set(entries);
    return;
  }
  const ls = getLocalStorageRef();
  if (ls) {
    for (const [key, val] of Object.entries(entries)) {
      ls.setItem(key, JSON.stringify(val));
    }
    return;
  }
  for (const [key, val] of Object.entries(entries)) {
    memoryStorage.set(key, cloneValue(val));
  }
}

/**
 * Reset internal in-memory state & storage (for Node.js unit tests).
 */
export function resetMemoryStoreForTests() {
  memoryStorage.clear();
  cachedSnapshot = null;
  lastNotifiedSerialized = '';
  listeners.clear();
}

/**
 * Notify all subscribed listeners with a fresh clone of the current state.
 * @param {any} state
 */
function notifyListeners(state) {
  const serialized = JSON.stringify(state);
  if (serialized === lastNotifiedSerialized) return;
  lastNotifiedSerialized = serialized;
  for (const listener of listeners) {
    try {
      listener(cloneValue(state));
    } catch (err) {
      console.error('Store subscriber error:', err);
    }
  }
}

/**
 * Register cross-context storage listeners once when running in Extension or Browser window.
 */
function ensureCrossContextListeners() {
  if (crossContextListenersRegistered) return;

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes[STORAGE_KEY] && !changes[CREDENTIALS_KEY]) return;
      (async () => {
        try {
          const refreshed = await loadState();
          notifyListeners(refreshed);
        } catch (err) {
          console.error('Failed handling chrome.storage.onChanged:', err);
        }
      })();
    });
    crossContextListenersRegistered = true;
  } else if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', (event) => {
      if (event.key !== null && event.key !== STORAGE_KEY && event.key !== CREDENTIALS_KEY) return;
      (async () => {
        try {
          const refreshed = await loadState();
          notifyListeners(refreshed);
        } catch (err) {
          console.error('Failed handling window storage event:', err);
        }
      })();
    });
    crossContextListenersRegistered = true;
  }
}

/**
 * Serialize sequential state mutations cleanly to prevent concurrent overwrites.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runSerialized(fn) {
  const previous = stateMutationChain;
  let release;
  stateMutationChain = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Load GatewayState from active storage, merging local-only sync credentials.
 * @returns {Promise<any>}
 */
export async function loadState() {
  ensureCrossContextListeners();
  const raw = await storageGet([STORAGE_KEY, CREDENTIALS_KEY]);
  const storedState = raw[STORAGE_KEY];
  const storedCreds = raw[CREDENTIALS_KEY];

  let state;
  let shouldPersistInitial = false;
  if (!storedState) {
    state = createDefaultState();
    shouldPersistInitial = true;
  } else {
    const prevContentVersion = Number(storedState.contentVersion || 1);
    state = normalizeState(storedState);
    if (state.contentVersion !== prevContentVersion) {
      shouldPersistInitial = true;
    }
  }

  // Migrate any stray githubPat out of STORAGE_KEY into CREDENTIALS_KEY.
  let credsGistId = typeof storedCreds?.gistId === 'string' ? storedCreds.gistId.trim() : '';
  let credsPat = typeof storedCreds?.githubPat === 'string' ? storedCreds.githubPat.trim() : '';
  let migratedPat = false;

  if (!credsPat && state.sync.githubPat) {
    credsPat = state.sync.githubPat;
    migratedPat = true;
  }
  if (!credsGistId && state.sync.gistId) {
    credsGistId = state.sync.gistId;
  }

  if (credsGistId) {
    state.sync.gistId = credsGistId;
  }
  state.sync.githubPat = credsPat;

  if (shouldPersistInitial || migratedPat) {
    const cleanState = cloneValue(state);
    cleanState.sync.githubPat = '';
    const toWrite = { [STORAGE_KEY]: cleanState };
    if (migratedPat || credsGistId || credsPat) {
      toWrite[CREDENTIALS_KEY] = { gistId: credsGistId, githubPat: credsPat };
    }
    await storageSet(toWrite);
  }

  cachedSnapshot = cloneValue(state);
  lastNotifiedSerialized = JSON.stringify(cachedSnapshot);
  return cloneValue(state);
}

/**
 * Persist GatewayState to storage (always stripping githubPat from STORAGE_KEY)
 * and notify subscribers.
 * @param {any} nextState
 * @param {{ bumpUpdatedAt?: boolean, persistCredentials?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function saveState(nextState, options = { bumpUpdatedAt: true }) {
  ensureCrossContextListeners();
  const { bumpUpdatedAt = true, persistCredentials = false } = options || {};
  const normalized = normalizeState(nextState);
  if (bumpUpdatedAt) {
    normalized.updatedAt = new Date().toISOString();
  }

  const runtimePat = normalized.sync.githubPat || '';
  const cleanForMainStorage = cloneValue(normalized);
  cleanForMainStorage.sync.githubPat = '';

  const entries = { [STORAGE_KEY]: cleanForMainStorage };
  if (persistCredentials || runtimePat) {
    entries[CREDENTIALS_KEY] = {
      gistId: normalized.sync.gistId || '',
      githubPat: runtimePat
    };
  }

  await storageSet(entries);
  cachedSnapshot = cloneValue(normalized);
  notifyListeners(normalized);
  return cloneValue(normalized);
}

/**
 * Synchronous getter returning latest cached state after loadState().
 * @returns {any}
 */
export function getStateSnapshot() {
  if (!cachedSnapshot) {
    cachedSnapshot = createDefaultState();
  }
  return cloneValue(cachedSnapshot);
}

/**
 * Subscribe to state updates across this context and other browser contexts.
 * @param {(state: any) => void} listener
 * @returns {() => void}
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribe listener must be a function');
  }
  ensureCrossContextListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Merge entity arrays by ID, filtering tombstones (unless updatedAt > tombstoneTs)
 * and picking the newer updatedAt on conflict.
 * @param {any[]} localItems
 * @param {any[]} remoteItems
 * @param {Record<string, string>} tombstones
 * @returns {any[]}
 */
function mergeEntityList(localItems, remoteItems, tombstones) {
  const byId = new Map();

  const getItemTs = (item) => item?.updatedAt || item?.createdAt || item?.addedAt || '';

  const considerItem = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return;
    const itemTs = getItemTs(item);
    const itemMs = parseTimestampMs(itemTs);
    const tombTs = tombstones[item.id];
    if (tombTs) {
      const tombMs = parseTimestampMs(tombTs);
      if (Number.isNaN(itemMs) || (!Number.isNaN(tombMs) && itemMs <= tombMs)) {
        return;
      }
    }

    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, cloneValue(item));
      return;
    }

    const existingMs = parseTimestampMs(getItemTs(existing));
    if (!Number.isNaN(itemMs) && (Number.isNaN(existingMs) || itemMs > existingMs)) {
      byId.set(item.id, cloneValue(item));
    }
  };

  for (const item of localItems || []) considerItem(item);
  for (const item of remoteItems || []) considerItem(item);

  return Array.from(byId.values());
}

/**
 * Two-way conflict-safe state merger honoring tombstones and entity timestamps.
 * Never imports remote githubPat and preserves local credentials if set.
 * @param {any} localState
 * @param {any} remoteState
 * @returns {any}
 */
export function mergeStates(localState, remoteState) {
  const local = normalizeState(localState);
  if (!remoteState || typeof remoteState !== 'object') {
    return local;
  }
  const remote = normalizeState(remoteState);

  // 1. Union tombstones keeping latest deletion timestamp.
  const mergedTombstones = { ...local.tombstones };
  for (const [id, remoteTs] of Object.entries(remote.tombstones || {})) {
    if (!mergedTombstones[id]) {
      mergedTombstones[id] = remoteTs;
    } else {
      mergedTombstones[id] = maxIsoTimestamp(mergedTombstones[id], remoteTs, remoteTs);
    }
  }

  // 2. Determine newer overall scalar state.
  const localTopMs = parseTimestampMs(local.updatedAt);
  const remoteTopMs = parseTimestampMs(remote.updatedAt);
  const remoteIsNewer = !Number.isNaN(remoteTopMs) && (Number.isNaN(localTopMs) || remoteTopMs > localTopMs);
  const newerState = remoteIsNewer ? remote : local;

  // 3. Merge entity lists with tombstone filtering & LWW per item.
  const objectives = mergeEntityList(local.objectives, remote.objectives, mergedTombstones);
  const todos = mergeEntityList(local.todos, remote.todos, mergedTombstones);
  const slackItems = mergeEntityList(local.slackDigest?.items, remote.slackDigest?.items, mergedTombstones);
  const bookmarks = mergeEntityList(local.bookmarks, remote.bookmarks, mergedTombstones);
  const rssSources = mergeEntityList(local.rssSources, remote.rssSources, mergedTombstones);

  // 4. Union archivedLog by id.
  const archivedById = new Map();
  for (const entry of [...(local.archivedLog || []), ...(remote.archivedLog || [])]) {
    if (!entry || !entry.id) continue;
    const existing = archivedById.get(entry.id);
    if (!existing) {
      archivedById.set(entry.id, cloneValue(entry));
    } else if (parseTimestampMs(entry.completedAt) > parseTimestampMs(existing.completedAt)) {
      archivedById.set(entry.id, cloneValue(entry));
    }
  }

  // 5. Merge rssCache: union dismissedUrls, keep fresher cache items minus dismissedUrls.
  const dismissedSet = new Set([
    ...(local.rssCache?.dismissedUrls || []),
    ...(remote.rssCache?.dismissedUrls || [])
  ]);
  const localCacheMs = parseTimestampMs(local.rssCache?.fetchedAt);
  const remoteCacheMs = parseTimestampMs(remote.rssCache?.fetchedAt);
  const useRemoteCache = !Number.isNaN(remoteCacheMs) && (Number.isNaN(localCacheMs) || remoteCacheMs > localCacheMs);
  const chosenCache = useRemoteCache ? remote.rssCache : local.rssCache;
  const filteredCacheItems = (chosenCache?.items || [])
    .filter((item) => item && !dismissedSet.has(item.url))
    .map((item) => cloneValue(item));

  // 6. Pick Slack digest metadata by newer digest date (falling back to newer state).
  const useRemoteDigestMeta = remote.slackDigest.date > local.slackDigest.date
    || (remote.slackDigest.date === local.slackDigest.date && remoteIsNewer);

  return {
    schemaVersion: 1,
    contentVersion: CONTENT_ENRICHMENT_VERSION,
    updatedAt: maxIsoTimestamp(local.updatedAt, remote.updatedAt),
    activeDate: newerState.activeDate,
    userName: newerState.userName || local.userName,
    onboardingCompleted: Boolean(local.onboardingCompleted || remote.onboardingCompleted),
    focusTheme: newerState.focusTheme || local.focusTheme,
    digestConfig: cloneValue(newerState.digestConfig),

    objectives,
    todos,
    archivedLog: Array.from(archivedById.values()),

    slackDigest: {
      date: useRemoteDigestMeta ? remote.slackDigest.date : local.slackDigest.date,
      deliveredAt: useRemoteDigestMeta ? remote.slackDigest.deliveredAt : local.slackDigest.deliveredAt,
      items: slackItems
    },

    bookmarks,
    rssSources,

    rssCache: {
      fetchedAt: chosenCache?.fetchedAt || null,
      items: filteredCacheItems,
      dismissedUrls: Array.from(dismissedSet)
    },

    wellness: cloneValue(newerState.wellness),

    layout: cloneValue(
      parseTimestampMs(remote.layout?.updatedAt) > parseTimestampMs(local.layout?.updatedAt)
        ? remote.layout
        : local.layout
    ),

    widgets: {
      weather: cloneValue(
        parseTimestampMs(remote.widgets?.weather?.updatedAt) > parseTimestampMs(local.widgets?.weather?.updatedAt)
          ? remote.widgets.weather
          : local.widgets.weather
      ),
      pomodoro: cloneValue(
        parseTimestampMs(remote.widgets?.pomodoro?.updatedAt) > parseTimestampMs(local.widgets?.pomodoro?.updatedAt)
          ? remote.widgets.pomodoro
          : local.widgets.pomodoro
      ),
      worldClock: {
        clocks: mergeEntityList(
          local.widgets?.worldClock?.clocks,
          remote.widgets?.worldClock?.clocks,
          mergedTombstones
        )
      },
      scratchpad: cloneValue(
        parseTimestampMs(remote.widgets?.scratchpad?.updatedAt) > parseTimestampMs(local.widgets?.scratchpad?.updatedAt)
          ? remote.widgets.scratchpad
          : local.widgets.scratchpad
      ),
      launchpad: {
        links: mergeEntityList(
          local.widgets?.launchpad?.links,
          remote.widgets?.launchpad?.links,
          mergedTombstones
        )
      },
      habits: {
        items: mergeEntityList(
          local.widgets?.habits?.items,
          remote.widgets?.habits?.items,
          mergedTombstones
        )
      }
    },

    background: (() => {
      const useRemoteBg = parseTimestampMs(remote.background?.updatedAt) > parseTimestampMs(local.background?.updatedAt);
      const chosenBg = cloneValue(useRemoteBg ? remote.background : local.background);
      chosenBg.customImages = mergeEntityList(
        local.background?.customImages,
        remote.background?.customImages,
        mergedTombstones
      );
      return chosenBg;
    })(),

    sync: {
      gistId: local.sync.gistId || remote.sync.gistId || '',
      githubPat: local.sync.githubPat || '',
      lastSyncedAt: maxIsoTimestamp(local.sync.lastSyncedAt, remote.sync.lastSyncedAt, '') || null,
      lastSyncStatus: local.sync.lastSyncStatus || 'local-only',
      lastSyncError: local.sync.lastSyncError || null
    },

    tombstones: mergedTombstones
  };
}

// ---------------------------------------------------------------------------
// Internal atomic builders used by both direct CRUD and cross-panel promotion
// ---------------------------------------------------------------------------

function buildTodoItem(rawInput, nowIso) {
  let text = '';
  let tags = [];
  let sourceUrl = null;
  let sourceLabel = null;
  let context = '';
  let keyPoints = [];
  let rawSources = [];

  if (typeof rawInput === 'string') {
    const parsed = parseQuickInput(rawInput);
    text = parsed.cleanText || parsed.urlLabel || parsed.url || '';
    tags = parsed.tags;
    sourceUrl = parsed.url;
    sourceLabel = parsed.urlLabel;
  } else if (rawInput && typeof rawInput === 'object') {
    const rawText = typeof rawInput.text === 'string' ? rawInput.text.trim() : '';
    const parsed = parseQuickInput(rawText);
    const explicitUrl = sanitizeHttpUrl(rawInput.sourceUrl, true);
    sourceUrl = explicitUrl || parsed.url;
    text = (explicitUrl ? rawText : parsed.cleanText) || rawText || (sourceUrl ? extractDomain(sourceUrl) : '');
    const explicitTags = normalizeTags(rawInput.tags);
    tags = explicitTags.length > 0 ? explicitTags : parsed.tags;
    sourceLabel = typeof rawInput.sourceLabel === 'string' && rawInput.sourceLabel.trim()
      ? rawInput.sourceLabel.trim()
      : (sourceUrl ? extractDomain(sourceUrl) || null : parsed.urlLabel);
    context = typeof rawInput.context === 'string' ? rawInput.context.trim() : '';
    keyPoints = normalizeKeyPoints(rawInput.keyPoints);
    rawSources = Array.isArray(rawInput.sources) ? rawInput.sources : [];
  }

  if (!text) {
    throw new Error('TODO text is required');
  }

  return {
    id: generateId('todo'),
    text,
    completed: false,
    tags,
    sourceUrl,
    sourceLabel,
    context,
    keyPoints,
    sources: normalizeSourcesList(rawSources, sourceUrl, sourceLabel, true),
    createdAt: nowIso,
    completedAt: null,
    updatedAt: nowIso
  };
}

function buildBookmarkItem(input, nowIso) {
  let rawUrl = '';
  let rawTitle = '';
  let rawTags = [];
  let estReadMins;
  let pinned = false;
  let context = '';
  let keyPoints = [];
  let rawSources = [];

  if (typeof input === 'string') {
    const trimmed = input.trim();
    const directUrl = sanitizeHttpUrl(trimmed, true);
    if (directUrl) {
      rawUrl = directUrl;
    } else {
      const parsed = parseQuickInput(trimmed);
      rawUrl = parsed.url || '';
      rawTitle = parsed.cleanText;
      rawTags = parsed.tags;
    }
  } else if (input && typeof input === 'object') {
    rawUrl = input.url || '';
    rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
    rawTags = normalizeTags(input.tags);
    estReadMins = input.estReadMins;
    pinned = Boolean(input.pinned);
    context = typeof input.context === 'string' ? input.context.trim() : '';
    keyPoints = normalizeKeyPoints(input.keyPoints);
    rawSources = Array.isArray(input.sources) ? input.sources : [];
  }

  const url = sanitizeHttpUrl(rawUrl, true);
  if (!url) return null;

  const domain = extractDomain(url);
  const title = rawTitle || domain || url;
  const computedMins = Number.isFinite(estReadMins) && estReadMins > 0
    ? Math.round(estReadMins)
    : estimateReadMinutes(`${title} ${context}`, url);

  return {
    id: generateId('bm'),
    url,
    title,
    domain,
    tags: rawTags,
    status: 'inbox',
    pinned,
    estReadMins: computedMins,
    context,
    keyPoints,
    sources: normalizeSourcesList(rawSources, url, domain || title, true),
    addedAt: nowIso,
    updatedAt: nowIso
  };
}

// ---------------------------------------------------------------------------
// Objectives CRUD ("The Big 3")
// ---------------------------------------------------------------------------

/**
 * Add a daily strategic objective.
 * @param {string | { title: string, url?: string | null, urlLabel?: string | null, context?: string, keyPoints?: string[], sources?: any[] }} rawInput
 */
export async function addObjective(rawInput) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();

    let title = '';
    let url = null;
    let urlLabel = null;
    let context = '';
    let keyPoints = [];
    let rawSources = [];

    if (typeof rawInput === 'string') {
      const parsed = parseQuickInput(rawInput);
      url = parsed.url;
      urlLabel = parsed.urlLabel;
      title = parsed.cleanText || parsed.urlLabel || parsed.url || '';
    } else if (rawInput && typeof rawInput === 'object') {
      const rawTitle = typeof rawInput.title === 'string' ? rawInput.title.trim() : '';
      const explicitUrl = sanitizeHttpUrl(rawInput.url, true);
      if (explicitUrl) {
        url = explicitUrl;
        urlLabel = typeof rawInput.urlLabel === 'string' && rawInput.urlLabel.trim()
          ? rawInput.urlLabel.trim()
          : (extractDomain(url) || null);
        title = rawTitle;
      } else {
        const parsed = parseQuickInput(rawTitle);
        url = parsed.url;
        urlLabel = parsed.urlLabel;
        title = parsed.cleanText || rawTitle;
      }
      context = typeof rawInput.context === 'string' ? rawInput.context.trim() : '';
      keyPoints = normalizeKeyPoints(rawInput.keyPoints);
      rawSources = Array.isArray(rawInput.sources) ? rawInput.sources : [];
    }

    if (!title) {
      throw new Error('Objective title is required');
    }

    const item = {
      id: generateId('obj'),
      title,
      url,
      urlLabel,
      context,
      keyPoints,
      sources: normalizeSourcesList(rawSources, url, urlLabel, true),
      completed: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.objectives.push(item);
    await saveState(state);
    return cloneValue(item);
  });
}

export async function toggleObjective(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const target = state.objectives.find((item) => item.id === id);
    if (!target) return state;
    target.completed = !target.completed;
    target.updatedAt = nowIso;
    return await saveState(state);
  });
}

export async function updateObjective(id, patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.objectives.find((item) => item.id === id);
    if (!target || !patch || typeof patch !== 'object') return state;

    if (typeof patch.title === 'string') {
      const trimmed = patch.title.trim();
      if (trimmed) target.title = trimmed;
    }
    if (patch.url !== undefined) {
      target.url = sanitizeHttpUrl(patch.url, true);
      if (!target.url) {
        target.urlLabel = null;
      } else if (patch.urlLabel === undefined) {
        target.urlLabel = extractDomain(target.url) || null;
      }
    }
    if (patch.urlLabel !== undefined && target.url) {
      target.urlLabel = typeof patch.urlLabel === 'string' && patch.urlLabel.trim()
        ? patch.urlLabel.trim()
        : (extractDomain(target.url) || null);
    }
    if (typeof patch.context === 'string') {
      target.context = patch.context.trim();
    }
    if (patch.keyPoints !== undefined) {
      target.keyPoints = normalizeKeyPoints(patch.keyPoints);
    }
    if (patch.sources !== undefined || patch.url !== undefined) {
      const candidateSources = patch.sources !== undefined ? patch.sources : target.sources;
      target.sources = normalizeSourcesList(candidateSources, target.url, target.urlLabel, true);
    }

    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function removeObjective(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nextObjectives = state.objectives.filter((item) => item.id !== id);
    if (nextObjectives.length === state.objectives.length && !id) return state;
    state.objectives = nextObjectives;
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// Tactical TODOs CRUD & Day Rollover
// ---------------------------------------------------------------------------

export async function addTodo(rawInput) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const item = buildTodoItem(rawInput, nowIso);
    state.todos.push(item);
    await saveState(state);
    return cloneValue(item);
  });
}

export async function toggleTodo(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const target = state.todos.find((item) => item.id === id);
    if (!target) return state;
    target.completed = !target.completed;
    target.completedAt = target.completed ? nowIso : null;
    target.updatedAt = nowIso;
    return await saveState(state);
  });
}

export async function updateTodo(id, patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.todos.find((item) => item.id === id);
    if (!target || !patch || typeof patch !== 'object') return state;

    if (typeof patch.text === 'string') {
      const trimmed = patch.text.trim();
      if (trimmed) target.text = trimmed;
    }
    if (patch.tags !== undefined) {
      target.tags = normalizeTags(patch.tags);
    }
    if (patch.sourceUrl !== undefined) {
      target.sourceUrl = sanitizeHttpUrl(patch.sourceUrl, true);
      if (!target.sourceUrl && patch.sourceLabel === undefined) {
        target.sourceLabel = null;
      } else if (target.sourceUrl && patch.sourceLabel === undefined) {
        target.sourceLabel = extractDomain(target.sourceUrl) || null;
      }
    }
    if (patch.sourceLabel !== undefined) {
      target.sourceLabel = typeof patch.sourceLabel === 'string' && patch.sourceLabel.trim()
        ? patch.sourceLabel.trim()
        : null;
    }
    if (typeof patch.context === 'string') {
      target.context = patch.context.trim();
    }
    if (patch.keyPoints !== undefined) {
      target.keyPoints = normalizeKeyPoints(patch.keyPoints);
    }
    if (patch.sources !== undefined || patch.sourceUrl !== undefined) {
      const candidateSources = patch.sources !== undefined ? patch.sources : target.sources;
      target.sources = normalizeSourcesList(candidateSources, target.sourceUrl, target.sourceLabel, true);
    }

    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function removeTodo(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.todos = state.todos.filter((item) => item.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

export async function clearCompletedTodos() {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const existingArchivedIds = new Set(state.archivedLog.map((entry) => entry.id));

    const remaining = [];
    for (const todo of state.todos) {
      if (todo.completed) {
        if (!existingArchivedIds.has(todo.id)) {
          state.archivedLog.push({
            id: todo.id,
            kind: 'todo',
            text: todo.text,
            date: state.activeDate,
            completedAt: todo.completedAt || nowIso
          });
          existingArchivedIds.add(todo.id);
        }
        state.tombstones[todo.id] = nowIso;
      } else {
        remaining.push(todo);
      }
    }

    state.todos = remaining;
    return await saveState(state);
  });
}

export async function rolloverDay(newDateStr) {
  return await runSerialized(async () => {
    const state = await loadState();
    const now = new Date();
    const nowIso = now.toISOString();
    const targetDate = typeof newDateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(newDateStr)
      ? newDateStr
      : formatLocalDate(now);

    const existingArchivedIds = new Set(state.archivedLog.map((entry) => entry.id));

    let completedObjectives = 0;
    const remainingObjectives = [];
    for (const obj of state.objectives) {
      if (obj.completed) {
        completedObjectives += 1;
        if (!existingArchivedIds.has(obj.id)) {
          state.archivedLog.push({
            id: obj.id,
            kind: 'objective',
            text: obj.title,
            date: state.activeDate,
            completedAt: obj.updatedAt || nowIso
          });
          existingArchivedIds.add(obj.id);
        }
        state.tombstones[obj.id] = nowIso;
      } else {
        remainingObjectives.push(obj);
      }
    }

    let completedTodos = 0;
    const carriedTodos = [];
    for (const todo of state.todos) {
      if (todo.completed) {
        completedTodos += 1;
        if (!existingArchivedIds.has(todo.id)) {
          state.archivedLog.push({
            id: todo.id,
            kind: 'todo',
            text: todo.text,
            date: state.activeDate,
            completedAt: todo.completedAt || nowIso
          });
          existingArchivedIds.add(todo.id);
        }
        state.tombstones[todo.id] = nowIso;
      } else {
        carriedTodos.push(todo);
      }
    }

    state.objectives = remainingObjectives;
    state.todos = carriedTodos;
    state.activeDate = targetDate;
    state.wellness.breaksToday = 0;
    state.wellness.activeMinutesStart = nowIso;

    const saved = await saveState(state);
    return {
      completedObjectives,
      completedTodos,
      carriedOverTodos: carriedTodos.length,
      state: saved
    };
  });
}

// ---------------------------------------------------------------------------
// Slack Digest CRUD & Cross-Panel Bridges
// ---------------------------------------------------------------------------

export async function addSlackItem(item) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();

    const headline = typeof item?.headline === 'string' ? item.headline.trim() : '';
    const summary = typeof item?.summary === 'string' ? item.summary.trim() : '';
    if (!headline && !summary) {
      throw new Error('Slack digest headline or summary is required');
    }

    const rawChannel = typeof item?.channel === 'string' && item.channel.trim()
      ? item.channel.trim()
      : '#general';
    const channel = rawChannel.startsWith('#') ? rawChannel : `#${rawChannel}`;

    const url = sanitizeHttpUrl(item?.url, true);
    const context = typeof item?.context === 'string' ? item.context.trim() : '';
    const keyPoints = normalizeKeyPoints(item?.keyPoints);
    const entry = {
      id: generateId('slack'),
      channel,
      badge: typeof item?.badge === 'string' && item.badge.trim() ? item.badge.trim() : null,
      headline: headline || summary,
      summary,
      context,
      keyPoints,
      url,
      sources: normalizeSourcesList(item?.sources, url, `${channel} Thread`, true),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    state.slackDigest.items.unshift(entry);
    await saveState(state);
    return cloneValue(entry);
  });
}

export async function updateSlackItem(id, patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.slackDigest.items.find((item) => item.id === id);
    if (!target || !patch || typeof patch !== 'object') return state;

    if (typeof patch.headline === 'string' && patch.headline.trim()) {
      target.headline = patch.headline.trim();
    }
    if (typeof patch.summary === 'string') {
      target.summary = patch.summary.trim();
    }
    if (typeof patch.context === 'string') {
      target.context = patch.context.trim();
    }
    if (patch.badge !== undefined) {
      target.badge = typeof patch.badge === 'string' && patch.badge.trim() ? patch.badge.trim() : null;
    }
    if (patch.url !== undefined) {
      target.url = sanitizeHttpUrl(patch.url, true);
    }
    if (patch.keyPoints !== undefined) {
      target.keyPoints = normalizeKeyPoints(patch.keyPoints);
    }
    if (patch.sources !== undefined || patch.url !== undefined) {
      const candidateSources = patch.sources !== undefined ? patch.sources : target.sources;
      target.sources = normalizeSourcesList(candidateSources, target.url, `${target.channel} Thread`, true);
    }

    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function removeSlackItem(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.slackDigest.items = state.slackDigest.items.filter((item) => item.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

export async function promoteSlackToTodo(slackItemId) {
  return await runSerialized(async () => {
    const state = await loadState();
    const slackItem = state.slackDigest.items.find((item) => item.id === slackItemId);
    if (!slackItem) return null;

    const nowIso = new Date().toISOString();
    const channelTag = slackItem.channel.replace(/^#+/, '').toLowerCase();
    const todo = buildTodoItem({
      text: `Follow up: ${slackItem.headline || slackItem.summary}`,
      tags: channelTag ? [channelTag] : [],
      sourceUrl: slackItem.url || slackItem.sources?.[0]?.url || null,
      sourceLabel: slackItem.channel,
      context: [slackItem.summary, slackItem.context].filter(Boolean).join('\n\n'),
      keyPoints: slackItem.keyPoints || [],
      sources: slackItem.sources || []
    }, nowIso);

    state.todos.push(todo);
    await saveState(state);
    return cloneValue(todo);
  });
}

export async function promoteSlackToBookmark(slackItemId) {
  return await runSerialized(async () => {
    const state = await loadState();
    const slackItem = state.slackDigest.items.find((item) => item.id === slackItemId);
    const primaryUrl = slackItem?.url || slackItem?.sources?.[0]?.url || null;
    if (!slackItem || !primaryUrl) return null;

    const nowIso = new Date().toISOString();
    const channelTag = slackItem.channel.replace(/^#+/, '').toLowerCase();
    const bookmark = buildBookmarkItem({
      url: primaryUrl,
      title: slackItem.headline || slackItem.summary,
      tags: channelTag ? [channelTag] : [],
      context: [slackItem.summary, slackItem.context].filter(Boolean).join('\n\n'),
      keyPoints: slackItem.keyPoints || [],
      sources: slackItem.sources || []
    }, nowIso);

    if (!bookmark) return null;
    const existingIdx = state.bookmarks.findIndex((b) => b.url === bookmark.url);
    if (existingIdx >= 0) {
      const existing = state.bookmarks[existingIdx];
      existing.title = bookmark.title || existing.title;
      existing.tags = normalizeTags([...existing.tags, ...bookmark.tags]);
      existing.status = 'inbox';
      existing.updatedAt = nowIso;
      await saveState(state);
      return cloneValue(existing);
    }

    state.bookmarks.unshift(bookmark);
    await saveState(state);
    return cloneValue(bookmark);
  });
}

export async function importSlackDigest(digestPayload) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!digestPayload || typeof digestPayload !== 'object') return state;

    const nowIso = new Date().toISOString();
    if (typeof digestPayload.date === 'string' && digestPayload.date.trim()) {
      state.slackDigest.date = digestPayload.date.trim();
    }
    if (typeof digestPayload.deliveredAt === 'string' && digestPayload.deliveredAt.trim()) {
      state.slackDigest.deliveredAt = digestPayload.deliveredAt.trim();
    }

    const incomingRaw = Array.isArray(digestPayload.items) ? digestPayload.items : [];
    const normalizedIncoming = [];

    for (const rawItem of incomingRaw) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const headline = typeof rawItem.headline === 'string' ? rawItem.headline.trim() : '';
      const summary = typeof rawItem.summary === 'string' ? rawItem.summary.trim() : '';
      if (!headline && !summary) continue;

      const rawChannel = typeof rawItem.channel === 'string' && rawItem.channel.trim()
        ? rawItem.channel.trim()
        : '#general';
      const channel = rawChannel.startsWith('#') ? rawChannel : `#${rawChannel}`;
      const id = typeof rawItem.id === 'string' && rawItem.id.trim()
        ? rawItem.id.trim()
        : generateId('slack');

      const url = sanitizeHttpUrl(rawItem.url, true);
      normalizedIncoming.push({
        id,
        channel,
        badge: typeof rawItem.badge === 'string' && rawItem.badge.trim() ? rawItem.badge.trim() : null,
        headline: headline || summary,
        summary,
        context: typeof rawItem.context === 'string' ? rawItem.context.trim() : '',
        keyPoints: normalizeKeyPoints(rawItem.keyPoints),
        url,
        sources: normalizeSourcesList(rawItem.sources, url, `${channel} Thread`, true),
        createdAt: typeof rawItem.createdAt === 'string' ? rawItem.createdAt : nowIso,
        updatedAt: typeof rawItem.updatedAt === 'string' ? rawItem.updatedAt : nowIso
      });
    }

    state.slackDigest.items = mergeEntityList(state.slackDigest.items, normalizedIncoming, state.tombstones);
    return await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// Reading Queue & Bookmarks CRUD
// ---------------------------------------------------------------------------

export async function addBookmark(input) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const candidate = buildBookmarkItem(input, nowIso);
    if (!candidate) return null;

    const existingIdx = state.bookmarks.findIndex((item) => item.url === candidate.url);
    if (existingIdx >= 0) {
      const existing = state.bookmarks[existingIdx];
      existing.title = candidate.title || existing.title;
      existing.tags = normalizeTags([...existing.tags, ...candidate.tags]);
      if (candidate.context && !existing.context) existing.context = candidate.context;
      if (candidate.keyPoints?.length > 0 && (!existing.keyPoints || existing.keyPoints.length === 0)) {
        existing.keyPoints = candidate.keyPoints;
      }
      if (candidate.sources?.length > 0) {
        existing.sources = normalizeSourcesList([...(existing.sources || []), ...candidate.sources], existing.url, existing.domain, true);
      }
      existing.status = 'inbox';
      existing.pinned = existing.pinned || candidate.pinned;
      existing.updatedAt = nowIso;
      await saveState(state);
      return cloneValue(existing);
    }

    state.bookmarks.unshift(candidate);
    await saveState(state);
    return cloneValue(candidate);
  });
}

export async function updateBookmark(id, patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.bookmarks.find((item) => item.id === id);
    if (!target || !patch || typeof patch !== 'object') return state;

    if (typeof patch.title === 'string' && patch.title.trim()) {
      target.title = patch.title.trim();
    }
    if (typeof patch.context === 'string') {
      target.context = patch.context.trim();
    }
    if (patch.tags !== undefined) {
      target.tags = normalizeTags(patch.tags);
    }
    if (patch.keyPoints !== undefined) {
      target.keyPoints = normalizeKeyPoints(patch.keyPoints);
    }
    if (patch.sources !== undefined) {
      target.sources = normalizeSourcesList(patch.sources, target.url, target.domain || target.title, true);
    }

    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function updateBookmarkStatus(id, status) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.bookmarks.find((item) => item.id === id);
    if (!target) return state;
    if (status !== 'inbox' && status !== 'archived') return state;
    target.status = status;
    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function toggleBookmarkPin(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.bookmarks.find((item) => item.id === id);
    if (!target) return state;
    target.pinned = !target.pinned;
    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function promoteBookmarkToTodo(bookmarkId) {
  return await runSerialized(async () => {
    const state = await loadState();
    const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
    if (!bookmark) return null;

    const nowIso = new Date().toISOString();
    const todo = buildTodoItem({
      text: `Read: ${bookmark.title}`,
      tags: bookmark.tags,
      sourceUrl: bookmark.url,
      sourceLabel: bookmark.domain,
      context: bookmark.context || '',
      keyPoints: bookmark.keyPoints || [],
      sources: bookmark.sources || []
    }, nowIso);

    state.todos.push(todo);
    await saveState(state);
    return cloneValue(todo);
  });
}

export async function removeBookmark(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.bookmarks = state.bookmarks.filter((item) => item.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// RSS Sources & Discovery Stream Actions
// ---------------------------------------------------------------------------

export async function addRssSource(source) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const xmlUrl = sanitizeHttpUrl(source?.xmlUrl, false);
    if (!xmlUrl) {
      throw new Error('Valid http/https RSS feed XML URL is required');
    }

    const siteUrl = sanitizeHttpUrl(source?.siteUrl, false) || new URL(xmlUrl).origin;
    const item = {
      id: generateId('rss'),
      name: typeof source?.name === 'string' && source.name.trim()
        ? source.name.trim()
        : (extractDomain(xmlUrl) || 'Custom Feed'),
      xmlUrl,
      siteUrl,
      category: typeof source?.category === 'string' && source.category.trim()
        ? source.category.trim().toLowerCase()
        : 'general',
      enabled: true,
      updatedAt: nowIso
    };

    state.rssSources.push(item);
    await saveState(state);
    return cloneValue(item);
  });
}

export async function removeRssSource(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.rssSources = state.rssSources.filter((src) => src.id !== id);
    state.rssCache.items = state.rssCache.items.filter((item) => item.sourceId !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

export async function toggleRssSource(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.rssSources.find((src) => src.id === id);
    if (!target) return state;
    target.enabled = !target.enabled;
    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function dismissRssArticle(articleUrl) {
  return await runSerialized(async () => {
    const state = await loadState();
    const cleanUrl = sanitizeHttpUrl(articleUrl, false);
    if (!cleanUrl) return state;

    if (!state.rssCache.dismissedUrls.includes(cleanUrl)) {
      state.rssCache.dismissedUrls.push(cleanUrl);
    }
    state.rssCache.items = state.rssCache.items.filter((item) => item.url !== cleanUrl);
    return await saveState(state);
  });
}

export async function updateRssCache(items, fetchedAt) {
  return await runSerialized(async () => {
    const state = await loadState();
    const dismissedSet = new Set(state.rssCache.dismissedUrls);
    const cleanedItems = [];

    for (const rawItem of items || []) {
      const cleanUrl = sanitizeHttpUrl(rawItem?.url, false);
      if (!cleanUrl || dismissedSet.has(cleanUrl)) continue;
      const title = typeof rawItem?.title === 'string' ? rawItem.title.trim() : '';
      if (!title) continue;
      const sourceName = typeof rawItem.sourceName === 'string' && rawItem.sourceName.trim()
        ? rawItem.sourceName.trim()
        : extractDomain(cleanUrl);
      const summary = typeof rawItem.summary === 'string' ? rawItem.summary.trim() : '';
      cleanedItems.push({
        id: typeof rawItem.id === 'string' && rawItem.id ? rawItem.id : generateId('rssitem'),
        sourceId: typeof rawItem.sourceId === 'string' ? rawItem.sourceId : '',
        sourceName,
        title,
        url: cleanUrl,
        summary,
        keyPoints: normalizeKeyPoints(rawItem.keyPoints),
        sources: normalizeSourcesList(rawItem.sources, cleanUrl, sourceName, false),
        author: typeof rawItem.author === 'string' && rawItem.author.trim() ? rawItem.author.trim() : null,
        categories: normalizeTags(rawItem.categories),
        publishedAt: typeof rawItem.publishedAt === 'string' ? rawItem.publishedAt : new Date().toISOString(),
        estReadMins: Number.isFinite(rawItem.estReadMins) && rawItem.estReadMins > 0
          ? Math.round(rawItem.estReadMins)
          : estimateReadMinutes(`${title} ${summary}`, cleanUrl)
      });
    }

    state.rssCache.items = cleanedItems;
    state.rssCache.fetchedAt = typeof fetchedAt === 'string' && !Number.isNaN(Date.parse(fetchedAt))
      ? fetchedAt
      : null;

    return await saveState(state, { bumpUpdatedAt: false });
  });
}

// ---------------------------------------------------------------------------
// Preferences, Sync Settings & JSON Import/Export
// ---------------------------------------------------------------------------

export async function updatePreferences(patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!patch || typeof patch !== 'object') return state;

    if (typeof patch.userName === 'string') {
      state.userName = patch.userName.trim();
    }
    if (typeof patch.onboardingCompleted === 'boolean') {
      state.onboardingCompleted = patch.onboardingCompleted;
    }
    if (typeof patch.focusTheme === 'string' && patch.focusTheme.trim()) {
      state.focusTheme = patch.focusTheme.trim();
    }
    if (patch.digestConfig && typeof patch.digestConfig === 'object') {
      if (typeof patch.digestConfig.title === 'string' && patch.digestConfig.title.trim()) {
        state.digestConfig.title = patch.digestConfig.title.trim().slice(0, 60);
      }
      if (typeof patch.digestConfig.subtitle === 'string' && patch.digestConfig.subtitle.trim()) {
        state.digestConfig.subtitle = patch.digestConfig.subtitle.trim().slice(0, 80);
      }
      if (patch.digestConfig.feedUrl !== undefined) {
        state.digestConfig.feedUrl = sanitizeHttpUrl(patch.digestConfig.feedUrl, false) || '';
      }
    }

    const validMoods = new Set(['auto', 'morning', 'deep-work', 'evening']);
    const validSchemes = new Set(['auto', 'light', 'dark']);

    if (validMoods.has(patch.moodOverride)) state.wellness.moodOverride = patch.moodOverride;
    if (validSchemes.has(patch.colorScheme)) state.wellness.colorScheme = patch.colorScheme;
    if (typeof patch.focusMode === 'boolean') state.wellness.focusMode = patch.focusMode;
    if (typeof patch.rssCollapsed === 'boolean') state.wellness.rssCollapsed = patch.rssCollapsed;
    if (typeof patch.slackExpanded === 'boolean') state.wellness.slackExpanded = patch.slackExpanded;
    if (typeof patch.slackPanelCollapsed === 'boolean') state.wellness.slackPanelCollapsed = patch.slackPanelCollapsed;
    if (Number.isFinite(patch.breaksToday) && patch.breaksToday >= 0) {
      state.wellness.breaksToday = Math.floor(patch.breaksToday);
    }
    if (patch.lastBreakAt === null || typeof patch.lastBreakAt === 'string') {
      state.wellness.lastBreakAt = patch.lastBreakAt;
    }
    if (Number.isFinite(patch.promptIndex) && patch.promptIndex >= 0) {
      state.wellness.promptIndex = Math.floor(patch.promptIndex);
    }
    if (typeof patch.activeMinutesStart === 'string' && !Number.isNaN(Date.parse(patch.activeMinutesStart))) {
      state.wellness.activeMinutesStart = patch.activeMinutesStart;
    }

    return await saveState(state);
  });
}

/**
 * Update Daily Digest widget title, subtitle, and optional custom JSON feed URL.
 * @param {{ title?: string, subtitle?: string, feedUrl?: string }} config
 */
export async function updateDigestConfig(config = {}) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!config || typeof config !== 'object') return state;

    if (config.title !== undefined) {
      const cleanTitle = typeof config.title === 'string' ? config.title.trim() : '';
      state.digestConfig.title = cleanTitle ? cleanTitle.slice(0, 60) : 'Daily Digest';
    }
    if (config.subtitle !== undefined) {
      const cleanSubtitle = typeof config.subtitle === 'string' ? config.subtitle.trim() : '';
      state.digestConfig.subtitle = cleanSubtitle ? cleanSubtitle.slice(0, 80) : 'Team & Project Pulse';
    }
    if (config.feedUrl !== undefined) {
      const rawUrl = typeof config.feedUrl === 'string' ? config.feedUrl.trim() : '';
      if (!rawUrl) {
        state.digestConfig.feedUrl = '';
      } else {
        const cleanUrl = sanitizeHttpUrl(rawUrl, false);
        if (!cleanUrl) {
          throw new Error('Enter a valid http(s):// Digest JSON URL');
        }
        state.digestConfig.feedUrl = cleanUrl;
      }
    }

    return await saveState(state);
  });
}

/**
 * Apply a workspace starter preset (`'ai-web'` or `'minimal'`) and optional onboarding settings.
 * @param {'ai-web' | 'minimal'} presetId
 * @param {{ userName?: string, weather?: any, includeDigestWidget?: boolean, markOnboardingComplete?: boolean }} [options]
 */
export async function applyStarterPreset(presetId = 'ai-web', options = {}) {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();
    const defaults = createDefaultState();

    if (presetId === 'minimal') {
      const idsToTombstone = [
        ...state.objectives.map((i) => i.id),
        ...state.todos.map((i) => i.id),
        ...(state.slackDigest?.items || []).map((i) => i.id),
        ...state.bookmarks.map((i) => i.id),
        ...state.rssSources.map((i) => i.id),
        ...defaults.objectives.map((i) => i.id),
        ...defaults.todos.map((i) => i.id),
        ...defaults.slackDigest.items.map((i) => i.id),
        ...defaults.bookmarks.map((i) => i.id),
        ...DEFAULT_RSS_SOURCES.map((i) => i.id)
      ];
      for (const id of idsToTombstone) {
        if (id) state.tombstones[id] = nowIso;
      }
      state.objectives = [];
      state.todos = [];
      state.slackDigest.items = [];
      state.bookmarks = [];
      state.rssSources = [];
      state.rssCache = { fetchedAt: null, items: [], dismissedUrls: state.rssCache?.dismissedUrls || [] };
    } else {
      const seedIds = [
        ...defaults.objectives.map((i) => i.id),
        ...defaults.todos.map((i) => i.id),
        ...defaults.slackDigest.items.map((i) => i.id),
        ...defaults.bookmarks.map((i) => i.id),
        ...DEFAULT_RSS_SOURCES.map((i) => i.id)
      ];
      for (const id of seedIds) {
        delete state.tombstones[id];
      }

      const mergeMissingSeeds = (currentList, seedList, keyFn = (x) => x.id) => {
        const existingKeys = new Set(currentList.map(keyFn));
        const additions = seedList.filter((seed) => !existingKeys.has(keyFn(seed))).map((seed) => cloneValue(seed));
        return [...currentList, ...additions];
      };

      state.objectives = mergeMissingSeeds(state.objectives, defaults.objectives);
      state.todos = mergeMissingSeeds(state.todos, defaults.todos);
      state.slackDigest.items = mergeMissingSeeds(state.slackDigest.items || [], defaults.slackDigest.items);
      state.bookmarks = mergeMissingSeeds(state.bookmarks, defaults.bookmarks, (b) => b.url);
      state.rssSources = mergeMissingSeeds(state.rssSources, DEFAULT_RSS_SOURCES, (s) => s.xmlUrl);
      state.rssCache.fetchedAt = null;
    }

    if (typeof options?.userName === 'string') {
      state.userName = options.userName.trim();
    }

    if (options?.weather && typeof options.weather === 'object') {
      const w = state.widgets.weather;
      const lat = Number(options.weather.latitude);
      const lon = Number(options.weather.longitude);
      if (typeof options.weather.locationName === 'string' && options.weather.locationName.trim()) {
        w.locationName = options.weather.locationName.trim();
      }
      if (typeof options.weather.country === 'string') {
        w.country = options.weather.country.trim();
      }
      if (Number.isFinite(lat) && lat >= -90 && lat <= 90) {
        w.latitude = lat;
      }
      if (Number.isFinite(lon) && lon >= -180 && lon <= 180) {
        w.longitude = lon;
      }
      if (typeof options.weather.timezone === 'string' && options.weather.timezone.trim()) {
        w.timezone = options.weather.timezone.trim();
      }
      w.cache = null;
      w.updatedAt = nowIso;
    }

    if (typeof options?.includeDigestWidget === 'boolean') {
      const hasSlack = isWidgetActive(state, 'slack');
      if (options.includeDigestWidget && !hasSlack) {
        state.layout.zones.right.push('slack');
        delete state.tombstones['widget:slack'];
        state.layout.updatedAt = nowIso;
      } else if (!options.includeDigestWidget && hasSlack) {
        for (const zone of WIDGET_ZONES) {
          state.layout.zones[zone] = (state.layout.zones[zone] || []).filter((id) => id !== 'slack');
        }
        state.tombstones['widget:slack'] = nowIso;
        state.layout.updatedAt = nowIso;
      }
    }

    if (options?.markOnboardingComplete === true) {
      state.onboardingCompleted = true;
    }

    return await saveState(state);
  });
}

/**
 * Switch RSS sources to a starter pack (`'ai-web'` restores defaults, `'minimal'` clears all).
 * @param {'ai-web' | 'minimal'} packId
 */
export async function applyRssPresetPack(packId = 'ai-web') {
  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();

    if (packId === 'minimal') {
      for (const src of state.rssSources) {
        if (src?.id) state.tombstones[src.id] = nowIso;
      }
      for (const preset of DEFAULT_RSS_SOURCES) {
        state.tombstones[preset.id] = nowIso;
      }
      state.rssSources = [];
      state.rssCache = {
        fetchedAt: null,
        items: [],
        dismissedUrls: state.rssCache?.dismissedUrls || []
      };
      return await saveState(state);
    }

    const existingIds = new Set(state.rssSources.map((s) => s.id));
    const existingUrls = new Set(state.rssSources.map((s) => s.xmlUrl));
    const restored = [];
    for (const preset of DEFAULT_RSS_SOURCES) {
      delete state.tombstones[preset.id];
      if (!existingIds.has(preset.id) && !existingUrls.has(preset.xmlUrl)) {
        restored.push(cloneValue(preset));
      }
    }
    state.rssSources = [...restored, ...state.rssSources];
    state.rssCache.fetchedAt = null;
    return await saveState(state);
  });
}

function escapeXmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXmlAttr(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

/**
 * Export configured RSS sources as standard OPML 2.0 XML.
 * @param {Array<{ name?: string, xmlUrl?: string, siteUrl?: string, category?: string }>} sources
 * @returns {string}
 */
export function exportRssSourcesOpml(sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const outlines = [];
  for (const src of list) {
    const cleanXml = sanitizeHttpUrl(src?.xmlUrl, false);
    if (!cleanXml) continue;
    const title = escapeXmlAttr(src?.name || extractDomain(cleanXml) || 'Feed');
    const cleanSite = sanitizeHttpUrl(src?.siteUrl, false) || new URL(cleanXml).origin;
    const category = escapeXmlAttr(src?.category || 'general');
    outlines.push(
      `      <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeXmlAttr(cleanXml)}" htmlUrl="${escapeXmlAttr(cleanSite)}" category="${category}" />`
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Calm Morning Gateway RSS Subscriptions</title>',
    '  </head>',
    '  <body>',
    '    <outline text="Feeds" title="Feeds">',
    ...outlines,
    '    </outline>',
    '  </body>',
    '</opml>',
    ''
  ].join('\n');
}

/**
 * Parse OPML 2.0 XML or JSON feed lists purely in JS (no DOMParser dependency).
 * Rejects non-http/https feed URLs and deduplicates by normalized xmlUrl.
 * @param {string} rawText
 * @returns {Array<{ name: string, xmlUrl: string, siteUrl: string, category: string }>}
 */
export function parseRssSourcesOpmlOrJson(rawText) {
  if (typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const parsedFeeds = [];
  const seenUrls = new Set();

  const pushCandidate = (candidate) => {
    const cleanXml = sanitizeHttpUrl(candidate?.xmlUrl || candidate?.url || candidate?.feedUrl, false);
    if (!cleanXml || seenUrls.has(cleanXml)) return;
    seenUrls.add(cleanXml);
    const cleanSite = sanitizeHttpUrl(candidate?.siteUrl || candidate?.htmlUrl, false) || new URL(cleanXml).origin;
    const rawName = typeof candidate?.name === 'string' && candidate.name.trim()
      ? candidate.name.trim()
      : (typeof candidate?.title === 'string' && candidate.title.trim() ? candidate.title.trim() : '');
    const rawCat = typeof candidate?.category === 'string' && candidate.category.trim()
      ? candidate.category.trim().split(',')[0].trim().toLowerCase()
      : 'general';
    parsedFeeds.push({
      name: rawName || extractDomain(cleanXml) || 'Custom Feed',
      xmlUrl: cleanXml,
      siteUrl: cleanSite,
      category: rawCat || 'general'
    });
  };

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      const list = Array.isArray(json)
        ? json
        : (Array.isArray(json?.rssSources) ? json.rssSources : (Array.isArray(json?.sources) ? json.sources : []));
      for (const item of list) {
        if (item && typeof item === 'object') {
          pushCandidate(item);
        }
      }
      return parsedFeeds;
    } catch {
      return [];
    }
  }

  const tagRegex = /<\/?outline\b[^>]*>/gi;
  const folderStack = [];
  let match = tagRegex.exec(trimmed);
  while (match !== null) {
    const tag = match[0];
    if (/^<\/outline/i.test(tag)) {
      if (folderStack.length > 0) folderStack.pop();
      match = tagRegex.exec(trimmed);
      continue;
    }

    const isSelfClosing = /\/>\s*$/.test(tag);
    const attrs = {};
    const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch = attrRegex.exec(tag);
    while (attrMatch !== null) {
      const key = attrMatch[1].toLowerCase();
      const rawVal = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] || '');
      attrs[key] = decodeXmlAttr(rawVal).trim();
      attrMatch = attrRegex.exec(tag);
    }

    const xmlUrl = attrs.xmlurl || attrs.url || '';
    if (xmlUrl) {
      const stackCat = [...folderStack].reverse().find((c) => c && c !== 'feeds' && c !== 'subscriptions') || '';
      pushCandidate({
        name: attrs.title || attrs.text || '',
        xmlUrl,
        siteUrl: attrs.htmlurl || attrs.siteurl || '',
        category: attrs.category || stackCat || 'general'
      });
    } else if (!isSelfClosing) {
      const folderName = (attrs.category || attrs.title || attrs.text || '').toLowerCase();
      folderStack.push(folderName);
    }

    match = tagRegex.exec(trimmed);
  }

  return parsedFeeds;
}

/**
 * Import RSS/Atom feeds from OPML XML or JSON text (`mode: 'merge' | 'replace'`).
 * @param {string} opmlOrJsonText
 * @param {{ mode?: 'merge' | 'replace' }} [options]
 */
export async function importRssSourcesOpml(opmlOrJsonText, options = { mode: 'merge' }) {
  const mode = options?.mode === 'replace' ? 'replace' : 'merge';
  const parsed = parseRssSourcesOpmlOrJson(opmlOrJsonText);
  if (parsed.length === 0) {
    throw new Error('No valid http(s):// RSS or Atom feeds found in OPML/JSON input');
  }

  return await runSerialized(async () => {
    const state = await loadState();
    const nowIso = new Date().toISOString();

    if (mode === 'replace') {
      for (const oldSrc of state.rssSources) {
        if (oldSrc?.id) state.tombstones[oldSrc.id] = nowIso;
      }
      state.rssSources = [];
      state.rssCache = {
        fetchedAt: null,
        items: [],
        dismissedUrls: state.rssCache?.dismissedUrls || []
      };
    }

    const existingUrls = new Set(state.rssSources.map((s) => s.xmlUrl));
    let importedCount = 0;
    let skippedCount = 0;

    for (const feed of parsed) {
      if (existingUrls.has(feed.xmlUrl)) {
        skippedCount += 1;
        continue;
      }
      existingUrls.add(feed.xmlUrl);
      state.rssSources.push({
        id: generateId('rss'),
        name: feed.name,
        xmlUrl: feed.xmlUrl,
        siteUrl: feed.siteUrl,
        category: feed.category || 'general',
        enabled: true,
        updatedAt: nowIso
      });
      importedCount += 1;
    }

    state.rssCache.fetchedAt = null;
    const saved = await saveState(state);
    return {
      importedCount,
      skippedCount,
      totalCount: saved.rssSources.length,
      state: saved
    };
  });
}

export async function saveSyncCredentials(creds) {
  return await runSerialized(async () => {
    const state = await loadState();
    const gistId = typeof creds?.gistId === 'string' ? creds.gistId.trim() : '';
    const githubPat = typeof creds?.githubPat === 'string' ? creds.githubPat.trim() : '';

    state.sync.gistId = gistId;
    state.sync.githubPat = githubPat;
    if (!githubPat) {
      state.sync.lastSyncStatus = 'local-only';
      state.sync.lastSyncError = null;
    }

    await storageSet({
      [CREDENTIALS_KEY]: { gistId, githubPat }
    });

    return await saveState(state, { bumpUpdatedAt: false, persistCredentials: true });
  });
}

export async function updateSyncMetadata(meta) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!meta || typeof meta !== 'object') return state;

    const validStatuses = new Set(['local-only', 'synced', 'syncing', 'error']);
    if (meta.lastSyncedAt !== undefined) state.sync.lastSyncedAt = meta.lastSyncedAt;
    if (validStatuses.has(meta.lastSyncStatus)) state.sync.lastSyncStatus = meta.lastSyncStatus;
    if (meta.lastSyncError !== undefined) state.sync.lastSyncError = meta.lastSyncError;
    if (typeof meta.gistId === 'string') {
      state.sync.gistId = meta.gistId.trim();
      await storageSet({
        [CREDENTIALS_KEY]: {
          gistId: state.sync.gistId,
          githubPat: state.sync.githubPat || ''
        }
      });
    }

    return await saveState(state, { bumpUpdatedAt: false, persistCredentials: Boolean(state.sync.githubPat) });
  });
}

export async function importFullStateJson(jsonStringOrObj) {
  return await runSerialized(async () => {
    const current = await loadState();
    let parsed;
    if (typeof jsonStringOrObj === 'string') {
      parsed = JSON.parse(jsonStringOrObj);
    } else if (jsonStringOrObj && typeof jsonStringOrObj === 'object') {
      parsed = jsonStringOrObj;
    } else {
      throw new Error('Invalid Gateway state payload');
    }

    if (!parsed || typeof parsed !== 'object' || Number(parsed.schemaVersion) !== 1) {
      throw new Error('Unsupported or invalid GatewayState schemaVersion');
    }

    const next = normalizeState(parsed);
    // Preserve local credentials if backup JSON stripped them.
    if (!next.sync.githubPat && current.sync.githubPat) {
      next.sync.githubPat = current.sync.githubPat;
    }
    if (!next.sync.gistId && current.sync.gistId) {
      next.sync.gistId = current.sync.gistId;
    }

    return await saveState(next, { bumpUpdatedAt: true, persistCredentials: Boolean(next.sync.githubPat) });
  });
}

/**
 * Serialize GatewayState into clean JSON with githubPat strictly stripped.
 * @param {any} state
 * @returns {string}
 */
export function exportCleanStateJson(state) {
  const normalized = normalizeState(state || getStateSnapshot());
  normalized.sync.githubPat = '';
  return JSON.stringify(normalized, null, 2);
}

/**
 * Compute a deterministic short ID for external digest items lacking an explicit `id`.
 * @param {string} rawKey
 * @returns {string}
 */
function deterministicDigestId(rawKey) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawKey.length; i += 1) {
    hash ^= rawKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `slack_ext_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Hydrate Daily Digest & action items from a user-configured HTTPS Digest JSON URL
 * or the optional unpacked local bundle (`./data/latest-sync.json`).
 * Fails silently when absent on Chrome Web Store installs and honors user tombstones.
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<{ synced: boolean, state: any }>}
 */
export async function syncFromLocalBundle(fetchImpl = globalThis.fetch) {
  const preState = await loadState();
  if (typeof fetchImpl !== 'function') {
    return { synced: false, state: preState };
  }

  const customFeedUrl = sanitizeHttpUrl(preState.digestConfig?.feedUrl || '', false);
  let bundleUrl = customFeedUrl || './data/latest-sync.json';
  if (!customFeedUrl && typeof globalThis.chrome?.runtime?.getURL === 'function') {
    bundleUrl = globalThis.chrome.runtime.getURL('data/latest-sync.json');
  }

  let rawBundle;
  try {
    const res = await fetchImpl(bundleUrl, { cache: 'no-store' });
    if (!res.ok) {
      return { synced: false, state: preState };
    }
    rawBundle = await res.json();
  } catch {
    return { synced: false, state: preState };
  }

  if (!rawBundle || typeof rawBundle !== 'object') {
    return { synced: false, state: preState };
  }

  // Support both full GatewayState JSON ({ slackDigest: {...} }) and lightweight Digest JSON ({ date?, deliveredAt?, items: [...] })
  let bundlePayload = rawBundle;
  if (!rawBundle.slackDigest && Array.isArray(rawBundle.items)) {
    const digestDate = typeof rawBundle.date === 'string' && rawBundle.date.trim()
      ? rawBundle.date.trim()
      : preState.activeDate;
    bundlePayload = {
      schemaVersion: 1,
      slackDigest: {
        date: digestDate,
        deliveredAt: typeof rawBundle.deliveredAt === 'string' && rawBundle.deliveredAt.trim()
          ? rawBundle.deliveredAt.trim()
          : '09:00 UTC',
        items: rawBundle.items.map((item, idx) => {
          if (!item || typeof item !== 'object') return item;
          if (typeof item.id === 'string' && item.id.trim()) return item;
          const seedKey = `${digestDate}|${item.channel || '#general'}|${item.headline || item.summary || idx}`;
          return { ...item, id: deterministicDigestId(seedKey) };
        })
      },
      todos: Array.isArray(rawBundle.todos) ? rawBundle.todos : []
    };
  }

  if (!bundlePayload.slackDigest) {
    return { synced: false, state: preState };
  }

  return await runSerialized(async () => {
    const state = await loadState();
    const normalizedBundle = normalizeState(bundlePayload);
    const incomingItems = (normalizedBundle.slackDigest?.items || []).filter(
      (item) => item && item.id && !state.tombstones[item.id]
    );

    if (incomingItems.length === 0) {
      return { synced: false, state };
    }

    // Replace default seed placeholders once real digest items arrive,
    // while keeping user-created slack_* items and honoring tombstones.
    const nonSeedLocal = (state.slackDigest?.items || []).filter(
      (item) => item && !String(item.id).startsWith('slack_seed_') && !state.tombstones[item.id]
    );
    const mergedDigestItems = mergeEntityList(nonSeedLocal, incomingItems, state.tombstones);

    let changed = false;
    const prevDigestJson = JSON.stringify(state.slackDigest);
    state.slackDigest = {
      date: normalizedBundle.slackDigest.date || state.slackDigest.date,
      deliveredAt: normalizedBundle.slackDigest.deliveredAt || '09:00 UTC',
      items: mergedDigestItems
    };
    if (JSON.stringify(state.slackDigest) !== prevDigestJson) {
      changed = true;
    }

    const existingTodoIds = new Set(state.todos.map((t) => t.id));
    for (const bundleTodo of normalizedBundle.todos || []) {
      if (!bundleTodo?.id || !String(bundleTodo.id).startsWith('todo_slack_')) continue;
      if (state.tombstones[bundleTodo.id] || existingTodoIds.has(bundleTodo.id)) continue;
      state.todos.unshift(bundleTodo);
      existingTodoIds.add(bundleTodo.id);
      changed = true;
    }

    if (!changed) {
      return { synced: false, state };
    }

    const saved = await saveState(state, { bumpUpdatedAt: false });
    return { synced: true, state: saved };
  });
}

// ---------------------------------------------------------------------------
// Slack Feed Collapse/Expand Slice Helper (Default Collapsed to 10 Items)
// ---------------------------------------------------------------------------

/**
 * Compute visible Slack Digest items & overflow metadata (collapsed to 10 items by default).
 * @param {any[]} items
 * @param {any} [wellness]
 * @param {number} [limit=SLACK_COLLAPSED_LIMIT]
 */
export function getVisibleSlackDigestSlice(items, wellness = {}, limit = SLACK_COLLAPSED_LIMIT) {
  const list = Array.isArray(items) ? items : [];
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : SLACK_COLLAPSED_LIMIT;
  const isPanelCollapsed = Boolean(wellness?.slackPanelCollapsed);
  const isExpanded = Boolean(wellness?.slackExpanded);

  if (isPanelCollapsed) {
    return {
      visibleItems: [],
      totalCount: list.length,
      hiddenCount: list.length,
      hasOverflow: list.length > safeLimit,
      isExpanded,
      isPanelCollapsed: true,
      limit: safeLimit
    };
  }

  const hasOverflow = list.length > safeLimit;
  const visibleItems = (!hasOverflow || isExpanded) ? list : list.slice(0, safeLimit);
  return {
    visibleItems,
    totalCount: list.length,
    hiddenCount: Math.max(0, list.length - visibleItems.length),
    hasOverflow,
    isExpanded,
    isPanelCollapsed: false,
    limit: safeLimit
  };
}

// ---------------------------------------------------------------------------
// Widget Store & Full-Page Layout Rearrangement Actions
// ---------------------------------------------------------------------------

/**
 * Return ordered list of all currently active widget IDs across `top`, `left`, `right`, `bottom`.
 * @param {any} state
 * @returns {string[]}
 */
export function getActiveWidgetIds(state) {
  const zones = state?.layout?.zones || DEFAULT_LAYOUT_ZONES;
  const out = [];
  for (const zone of WIDGET_ZONES) {
    for (const id of zones[zone] || []) {
      if (VALID_WIDGET_IDS.has(id) && !out.includes(id)) {
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Check whether `widgetId` is currently placed on the dashboard.
 * @param {any} state
 * @param {string} widgetId
 * @returns {boolean}
 */
export function isWidgetActive(state, widgetId) {
  return getActiveWidgetIds(state).includes(widgetId);
}

/**
 * Add any widget from `WIDGET_CATALOG` onto the dashboard.
 * @param {string} widgetId
 * @param {'top' | 'left' | 'right' | 'bottom' | null} [preferredZone=null]
 */
export async function addWidgetToLayout(widgetId, preferredZone = null) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!VALID_WIDGET_IDS.has(widgetId)) {
      throw new Error(`Unknown widget ID: ${widgetId}`);
    }
    if (isWidgetActive(state, widgetId)) {
      return state;
    }

    const catalogEntry = WIDGET_CATALOG.find((w) => w.id === widgetId);
    const targetZone = WIDGET_ZONES.includes(preferredZone)
      ? preferredZone
      : (catalogEntry?.defaultZone || 'right');

    state.layout.zones[targetZone].push(widgetId);
    delete state.tombstones[`widget:${widgetId}`];
    state.layout.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

/**
 * Remove a widget from the active dashboard layout (preserving its stored data so re-adding restores it).
 * @param {string} widgetId
 */
export async function removeWidgetFromLayout(widgetId) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!VALID_WIDGET_IDS.has(widgetId)) return state;

    let removed = false;
    for (const zone of WIDGET_ZONES) {
      const next = (state.layout.zones[zone] || []).filter((id) => id !== widgetId);
      if (next.length !== (state.layout.zones[zone] || []).length) {
        removed = true;
      }
      state.layout.zones[zone] = next;
    }

    if (removed) {
      const nowIso = new Date().toISOString();
      state.tombstones[`widget:${widgetId}`] = nowIso;
      state.layout.updatedAt = nowIso;
      return await saveState(state);
    }
    return state;
  });
}

/**
 * Move `widgetId` to `targetZone` at `targetIndex` (supports within-zone & cross-zone drag-and-drop).
 * @param {string} widgetId
 * @param {'top' | 'left' | 'right' | 'bottom'} targetZone
 * @param {number} [targetIndex=-1]
 */
export async function moveWidgetInLayout(widgetId, targetZone, targetIndex = -1) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!VALID_WIDGET_IDS.has(widgetId) || !WIDGET_ZONES.includes(targetZone)) {
      return state;
    }

    for (const zone of WIDGET_ZONES) {
      state.layout.zones[zone] = (state.layout.zones[zone] || []).filter((id) => id !== widgetId);
    }

    const dest = state.layout.zones[targetZone];
    const insertAt = Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex <= dest.length
      ? targetIndex
      : dest.length;
    dest.splice(insertAt, 0, widgetId);

    delete state.tombstones[`widget:${widgetId}`];
    state.layout.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

/**
 * Nudge `widgetId` one step (`up`, `down`, `left`, `right`) for keyboard & button reordering.
 * @param {string} widgetId
 * @param {'up' | 'down' | 'left' | 'right'} direction
 */
export async function nudgeWidgetInLayout(widgetId, direction) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!VALID_WIDGET_IDS.has(widgetId)) return state;

    let currentZone = null;
    let currentIdx = -1;
    for (const zone of WIDGET_ZONES) {
      const idx = (state.layout.zones[zone] || []).indexOf(widgetId);
      if (idx >= 0) {
        currentZone = zone;
        currentIdx = idx;
        break;
      }
    }
    if (!currentZone) return state;

    const list = state.layout.zones[currentZone];
    if (direction === 'up') {
      if (currentIdx > 0) {
        list.splice(currentIdx, 1);
        list.splice(currentIdx - 1, 0, widgetId);
      } else if (currentZone === 'left' || currentZone === 'right') {
        list.splice(currentIdx, 1);
        state.layout.zones.top.push(widgetId);
      } else if (currentZone === 'bottom') {
        list.splice(currentIdx, 1);
        state.layout.zones.left.push(widgetId);
      } else {
        return state;
      }
    } else if (direction === 'down') {
      if (currentIdx < list.length - 1) {
        list.splice(currentIdx, 1);
        list.splice(currentIdx + 1, 0, widgetId);
      } else if (currentZone === 'top') {
        list.splice(currentIdx, 1);
        state.layout.zones.left.unshift(widgetId);
      } else if (currentZone === 'left' || currentZone === 'right') {
        list.splice(currentIdx, 1);
        state.layout.zones.bottom.unshift(widgetId);
      } else {
        return state;
      }
    } else if (direction === 'left') {
      if (currentZone === 'right') {
        list.splice(currentIdx, 1);
        const destIdx = Math.min(currentIdx, state.layout.zones.left.length);
        state.layout.zones.left.splice(destIdx, 0, widgetId);
      } else if (currentZone === 'top' || currentZone === 'bottom') {
        list.splice(currentIdx, 1);
        state.layout.zones.left.push(widgetId);
      } else {
        return state;
      }
    } else if (direction === 'right') {
      if (currentZone === 'left') {
        list.splice(currentIdx, 1);
        const destIdx = Math.min(currentIdx, state.layout.zones.right.length);
        state.layout.zones.right.splice(destIdx, 0, widgetId);
      } else if (currentZone === 'top' || currentZone === 'bottom') {
        list.splice(currentIdx, 1);
        state.layout.zones.right.push(widgetId);
      } else {
        return state;
      }
    } else {
      return state;
    }

    state.layout.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

/**
 * Toggle interactive Layout Edit Mode (`📐 Customize Layout`).
 * @param {boolean} enabled
 */
export async function setLayoutEditMode(enabled) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.layout.editMode = Boolean(enabled);
    return await saveState(state, { bumpUpdatedAt: false });
  });
}

/**
 * Reset dashboard zones and order back to canonical defaults while keeping all user data intact.
 */
export async function resetDashboardLayout() {
  return await runSerialized(async () => {
    const state = await loadState();
    state.layout.zones = cloneValue(DEFAULT_LAYOUT_ZONES);
    state.layout.updatedAt = new Date().toISOString();
    for (const key of Object.keys(state.tombstones)) {
      if (key.startsWith('widget:')) {
        delete state.tombstones[key];
      }
    }
    return await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// Weather & Utility Widgets State Mutations
// ---------------------------------------------------------------------------

export async function updateWeatherSettings(patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!patch || typeof patch !== 'object') return state;
    const w = state.widgets.weather;
    let coordsChanged = false;

    if (typeof patch.locationName === 'string' && patch.locationName.trim()) {
      w.locationName = patch.locationName.trim();
    }
    if (typeof patch.country === 'string') {
      w.country = patch.country.trim();
    }
    if (patch.latitude !== undefined && Number.isFinite(Number(patch.latitude))) {
      const nextLat = Number(patch.latitude);
      if (Math.abs(nextLat - w.latitude) > 0.001) coordsChanged = true;
      w.latitude = nextLat;
    }
    if (patch.longitude !== undefined && Number.isFinite(Number(patch.longitude))) {
      const nextLon = Number(patch.longitude);
      if (Math.abs(nextLon - w.longitude) > 0.001) coordsChanged = true;
      w.longitude = nextLon;
    }
    if (typeof patch.timezone === 'string' && patch.timezone.trim()) {
      w.timezone = patch.timezone.trim();
    }
    if (patch.unit === 'celsius' || patch.unit === 'fahrenheit') {
      w.unit = patch.unit;
    }
    if (coordsChanged) {
      w.cache = null;
    }
    w.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function updateWeatherCache(snapshot) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!snapshot || typeof snapshot !== 'object') return state;
    state.widgets.weather.cache = cloneValue(snapshot);
    return await saveState(state, { bumpUpdatedAt: false });
  });
}

export async function updatePomodoroSettings(patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!patch || typeof patch !== 'object') return state;
    const p = state.widgets.pomodoro;
    if (Number.isFinite(Number(patch.workMins)) && Number(patch.workMins) >= 1) {
      p.workMins = Math.min(120, Math.round(Number(patch.workMins)));
    }
    if (Number.isFinite(Number(patch.breakMins)) && Number(patch.breakMins) >= 1) {
      p.breakMins = Math.min(60, Math.round(Number(patch.breakMins)));
    }
    if (Number.isFinite(Number(patch.completedSessions)) && Number(patch.completedSessions) >= 0) {
      p.completedSessions = Math.floor(Number(patch.completedSessions));
    }
    p.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function addWorldClock({ label, timeZone }) {
  return await runSerialized(async () => {
    const state = await loadState();
    const tz = typeof timeZone === 'string' ? timeZone.trim() : '';
    if (!tz) throw new Error('Valid IANA timeZone is required');
    // Verify Intl accepts this timezone
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());

    const nowIso = new Date().toISOString();
    const entry = {
      id: generateId('wc'),
      label: typeof label === 'string' && label.trim() ? label.trim() : tz,
      timeZone: tz,
      updatedAt: nowIso
    };
    state.widgets.worldClock.clocks.push(entry);
    await saveState(state);
    return cloneValue(entry);
  });
}

export async function removeWorldClock(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.widgets.worldClock.clocks = state.widgets.worldClock.clocks.filter((c) => c.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

export async function updateScratchpad(text) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.widgets.scratchpad.text = typeof text === 'string' ? text : '';
    state.widgets.scratchpad.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function addLaunchpadLink({ label, url, icon = '🔗' }) {
  return await runSerialized(async () => {
    const state = await loadState();
    const cleanUrl = sanitizeHttpUrl(url, true);
    if (!cleanUrl) {
      throw new Error('Enter a valid http(s):// or obsidian:// URL');
    }
    const nowIso = new Date().toISOString();
    const entry = {
      id: generateId('lp'),
      label: typeof label === 'string' && label.trim() ? label.trim() : (extractDomain(cleanUrl) || 'Shortcut'),
      url: cleanUrl,
      icon: typeof icon === 'string' && icon.trim() ? icon.trim().slice(0, 4) : '🔗',
      updatedAt: nowIso
    };
    state.widgets.launchpad.links.push(entry);
    await saveState(state);
    return cloneValue(entry);
  });
}

export async function removeLaunchpadLink(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.widgets.launchpad.links = state.widgets.launchpad.links.filter((l) => l.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

export async function addHabitItem(label) {
  return await runSerialized(async () => {
    const state = await loadState();
    const clean = typeof label === 'string' ? label.trim() : '';
    if (!clean) throw new Error('Habit label is required');
    const nowIso = new Date().toISOString();
    const entry = {
      id: generateId('hb'),
      label: clean,
      completedDates: [],
      updatedAt: nowIso
    };
    state.widgets.habits.items.push(entry);
    await saveState(state);
    return cloneValue(entry);
  });
}

export async function toggleHabitForDate(id, dateStr = formatLocalDate(new Date())) {
  return await runSerialized(async () => {
    const state = await loadState();
    const target = state.widgets.habits.items.find((h) => h.id === id);
    if (!target) return state;
    const set = new Set(target.completedDates || []);
    if (set.has(dateStr)) {
      set.delete(dateStr);
    } else {
      set.add(dateStr);
    }
    target.completedDates = Array.from(set).sort().slice(-60);
    target.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function removeHabitItem(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.widgets.habits.items = state.widgets.habits.items.filter((h) => h.id !== id);
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    return await saveState(state);
  });
}

// ---------------------------------------------------------------------------
// Daily-Switching Circadian Nerdy Background Actions
// ---------------------------------------------------------------------------

export async function updateBackgroundSettings(patch) {
  return await runSerialized(async () => {
    const state = await loadState();
    if (!patch || typeof patch !== 'object') return state;
    const merged = normalizeBackgroundBlock(
      { ...state.background, ...patch, updatedAt: new Date().toISOString() },
      state.background
    );
    state.background = merged;
    return await saveState(state);
  });
}

export async function shuffleDailyBackground() {
  return await runSerialized(async () => {
    const state = await loadState();
    state.background.shuffleNonce = (Number(state.background.shuffleNonce) || 0) + 1;
    if (state.background.mode === 'off' || state.background.mode === 'pinned') {
      state.background.mode = 'daily-random';
    }
    state.background.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}

export async function addCustomBackgroundImage({ name, url, isPixelArt = false }) {
  return await runSerialized(async () => {
    const state = await loadState();
    const cleanUrl = sanitizeHttpUrl(url, false);
    if (!cleanUrl) {
      throw new Error('Enter a valid http(s):// image URL');
    }
    const existing = state.background.customImages.find((img) => img.url === cleanUrl);
    if (existing) return cloneValue(existing);

    const nowIso = new Date().toISOString();
    const entry = {
      id: generateId('bgcustom'),
      name: typeof name === 'string' && name.trim() ? name.trim() : (extractDomain(cleanUrl) || 'Custom Wallpaper'),
      category: 'custom',
      isPixelArt: Boolean(isPixelArt),
      url: cleanUrl,
      updatedAt: nowIso
    };
    state.background.customImages.push(entry);
    state.background.updatedAt = nowIso;
    await saveState(state);
    return cloneValue(entry);
  });
}

export async function removeCustomBackgroundImage(id) {
  return await runSerialized(async () => {
    const state = await loadState();
    state.background.customImages = state.background.customImages.filter((img) => img.id !== id);
    if (state.background.pinnedId === id) {
      state.background.pinnedId = 'pixel-cyber-bonsai';
    }
    if (typeof id === 'string' && id) {
      state.tombstones[id] = new Date().toISOString();
    }
    state.background.updatedAt = new Date().toISOString();
    return await saveState(state);
  });
}
