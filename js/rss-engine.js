/**
 * Calm Morning Gateway — Zero-Dependency RSS 2.0, Atom 1.0 & HTML Blog Engine (`js/rss-engine.js`)
 *
 * Uses a deterministic pure-JS XML/HTML scanner (no `DOMParser` dependency) so it runs
 * identically across Browser Windows, Chrome MV3 Service Workers, Safari PWA, and Node.js.
 * Extracts rich context summaries, bullet takeaways, authors, categories, and cited sources.
 */

import {
  createDefaultState,
  estimateReadMinutes,
  extractDomain,
  loadState,
  normalizeSourcesList,
  sanitizeHttpUrl,
  updateRssCache
} from './store.js';

export const RSS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS_PER_FEED = 12;
const MAX_TOTAL_CACHED_ITEMS = 80;
const MAX_SUMMARY_CHARS = 640;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™'
};

/**
 * Compute a deterministic short hex hash (FNV-1a 32-bit) for stable article IDs.
 * @param {string} input
 * @returns {string}
 */
function hashString(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Unwrap `<![CDATA[ ... ]]>` sections linearly without backtracking regexes.
 * @param {string} raw
 * @returns {string}
 */
function unwrapCdata(raw) {
  let out = '';
  let pos = 0;
  while (pos < raw.length) {
    const start = raw.indexOf('<![CDATA[', pos);
    if (start === -1) {
      out += raw.slice(pos);
      break;
    }
    out += raw.slice(pos, start);
    const end = raw.indexOf(']]>', start + 9);
    if (end === -1) {
      out += raw.slice(start + 9);
      break;
    }
    out += raw.slice(start + 9, end);
    pos = end + 3;
  }
  return out;
}

/**
 * Decode common named, decimal, and hex XML/HTML entities in a single pass.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text || '';
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (full, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return full;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return full;
    }
    const lower = entity.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : full;
  });
}

/**
 * Clean extracted XML/HTML text: unwrap CDATA, decode entity-encoded HTML, strip tags, collapse whitespace.
 * @param {string} raw
 * @returns {string}
 */
function cleanXmlText(raw) {
  if (typeof raw !== 'string') return '';
  const noCdata = unwrapCdata(raw);
  // Decode once first in case HTML tags inside <description> were entity-escaped (&lt;p&gt;)
  const decodedOnce = decodeEntities(noCdata);
  const noScripts = decodedOnce
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const noTags = noScripts.replace(/<[^>]*>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

/**
 * Truncate prose cleanly at sentence or word boundary.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncateProse(text, maxLen = MAX_SUMMARY_CHARS) {
  if (!text || text.length <= maxLen) return text || '';
  const slice = text.slice(0, maxLen);
  const lastPeriod = slice.lastIndexOf('. ');
  if (lastPeriod >= maxLen * 0.55) {
    return `${slice.slice(0, lastPeriod + 1)}`;
  }
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > 40 ? `${slice.slice(0, lastSpace)}…` : `${slice}…`;
}

/**
 * Parse key="value" or key='value' attributes from an XML/HTML opening tag header.
 * @param {string} attrText
 * @returns {Record<string, string>}
 */
function parseAttributes(attrText) {
  const attrs = {};
  if (!attrText) return attrs;
  const regex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = regex.exec(attrText);
  while (match !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : (match[3] || '');
    attrs[key] = decodeEntities(val).trim();
    match = regex.exec(attrText);
  }
  return attrs;
}

/**
 * Extract occurrences of `<tagName ...>inner</tagName>` or self-closing `<tagName .../>`
 * using deterministic linear scanning (zero ReDoS risk).
 * @param {string} xml
 * @param {string} tagName
 * @returns {Array<{ attrs: Record<string, string>, inner: string }>}
 */
function extractTagOccurrences(xml, tagName) {
  const results = [];
  const lowerXml = xml.toLowerCase();
  const openPrefix = `<${tagName.toLowerCase()}`;
  const closeTag = `</${tagName.toLowerCase()}>`;
  let pos = 0;

  while (pos < lowerXml.length) {
    const start = lowerXml.indexOf(openPrefix, pos);
    if (start === -1) break;

    const boundaryChar = lowerXml[start + openPrefix.length];
    if (
      boundaryChar !== '>'
      && boundaryChar !== '/'
      && boundaryChar !== ' '
      && boundaryChar !== '\t'
      && boundaryChar !== '\n'
      && boundaryChar !== '\r'
    ) {
      pos = start + openPrefix.length;
      continue;
    }

    const openEnd = xml.indexOf('>', start);
    if (openEnd === -1) break;

    const isSelfClosing = xml[openEnd - 1] === '/';
    const attrSliceEnd = isSelfClosing ? openEnd - 1 : openEnd;
    const attrSlice = xml.slice(start + openPrefix.length, attrSliceEnd);
    const attrs = parseAttributes(attrSlice);

    if (isSelfClosing) {
      results.push({ attrs, inner: '' });
      pos = openEnd + 1;
      continue;
    }

    const closeIdx = lowerXml.indexOf(closeTag, openEnd + 1);
    if (closeIdx === -1) break;

    results.push({
      attrs,
      inner: xml.slice(openEnd + 1, closeIdx)
    });
    pos = closeIdx + closeTag.length;
  }

  return results;
}

/**
 * Extract first non-empty cleaned text for any of the candidate tag names.
 * @param {string} block
 * @param {string[]} tagNames
 * @returns {string}
 */
function extractFirstTagText(block, tagNames) {
  for (const tagName of tagNames) {
    const matches = extractTagOccurrences(block, tagName);
    for (const match of matches) {
      const cleaned = cleanXmlText(match.inner);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

/**
 * Extract raw inner HTML/CDATA from the richest content tag available.
 * @param {string} block
 * @returns {string}
 */
function extractRawRichHtml(block) {
  for (const tagName of ['content:encoded', 'content', 'description', 'summary']) {
    const matches = extractTagOccurrences(block, tagName);
    for (const match of matches) {
      const unwrapped = decodeEntities(unwrapCdata(match.inner || '')).trim();
      if (unwrapped) return unwrapped;
    }
  }
  return '';
}

/**
 * Extract bullet takeaways (`<li>`) or key sentences from rich feed HTML.
 * @param {string} richHtml
 * @param {string} cleanSummary
 * @returns {string[]}
 */
function extractKeyPointsFromHtml(richHtml, cleanSummary) {
  const points = [];
  if (richHtml) {
    const liMatches = extractTagOccurrences(richHtml, 'li');
    for (const li of liMatches) {
      const text = cleanXmlText(li.inner);
      if (text.length >= 24 && text.length <= 220 && points.length < 4) {
        points.push(text);
      }
    }
  }
  if (points.length >= 2) return points;

  if (cleanSummary && cleanSummary.length >= 120) {
    const sentences = cleanSummary
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 35 && s.length <= 220);
    for (const sentence of sentences.slice(0, 3)) {
      if (!points.includes(sentence)) points.push(sentence);
    }
  }
  return points.slice(0, 3);
}

/**
 * Extract cited `<a href="...">` links from feed body HTML as secondary reference sources.
 * @param {string} richHtml
 * @param {string} primaryUrl
 * @param {string} primarySourceName
 * @param {string | null} siteUrl
 * @returns {Array<{ label: string, url: string, kind: string }>}
 */
function extractCitedSources(richHtml, primaryUrl, primarySourceName, siteUrl = null) {
  const candidates = [];
  if (richHtml) {
    const anchors = extractTagOccurrences(richHtml, 'a');
    for (const anchor of anchors) {
      if (candidates.length >= 4) break;
      const href = anchor.attrs.href;
      if (!href) continue;
      let resolved = href;
      try {
        resolved = new URL(href, primaryUrl).href;
      } catch {
        continue;
      }
      const cleanHref = sanitizeHttpUrl(resolved, false);
      if (!cleanHref || cleanHref === primaryUrl) continue;
      const anchorLabel = cleanXmlText(anchor.inner);
      if (anchorLabel.toLowerCase() === 'read more' || anchorLabel.toLowerCase() === 'continue reading') {
        continue;
      }
      candidates.push({
        label: anchorLabel && anchorLabel.length <= 72 ? anchorLabel : (extractDomain(cleanHref) || 'Reference'),
        url: cleanHref,
        kind: 'cited'
      });
    }
  }
  if (siteUrl) {
    const cleanSite = sanitizeHttpUrl(siteUrl, false);
    if (cleanSite && cleanSite !== primaryUrl) {
      candidates.push({
        label: `${primarySourceName} Index`,
        url: cleanSite,
        kind: 'publication'
      });
    }
  }
  return normalizeSourcesList(candidates, primaryUrl, `${primarySourceName} — Full Article`, false);
}

/**
 * Extract categories / topic tags from `<category>` elements.
 * @param {string} block
 * @returns {string[]}
 */
function extractCategories(block) {
  const tags = [];
  const matches = extractTagOccurrences(block, 'category');
  for (const match of matches) {
    const raw = match.attrs.term || match.attrs.label || cleanXmlText(match.inner);
    if (!raw) continue;
    const norm = raw.trim().toLowerCase().replace(/^#+/, '').slice(0, 28);
    if (norm && !tags.includes(norm) && tags.length < 4) {
      tags.push(norm);
    }
  }
  return tags;
}

/**
 * Extract author name from RSS `<dc:creator>`/`<author>` or Atom `<author><name>`.
 * @param {string} block
 * @returns {string | null}
 */
function extractAuthor(block) {
  const dcCreator = extractFirstTagText(block, ['dc:creator']);
  if (dcCreator) return dcCreator.slice(0, 80);

  const authorBlocks = extractTagOccurrences(block, 'author');
  for (const ab of authorBlocks) {
    const nestedName = extractFirstTagText(ab.inner, ['name']);
    if (nestedName) return nestedName.slice(0, 80);
    const plain = cleanXmlText(ab.inner);
    if (plain) return plain.slice(0, 80);
  }
  return null;
}

/**
 * Extract and validate article URL from RSS 2.0 `<link>`/`<guid>` or Atom 1.0 `<link href="..."/>`.
 * @param {string} block
 * @returns {string | null}
 */
function extractItemUrl(block) {
  const linkTags = extractTagOccurrences(block, 'link');
  let bestHref = null;
  let bestScore = -1;

  for (const tag of linkTags) {
    const rel = (tag.attrs.rel || '').toLowerCase();
    const type = (tag.attrs.type || '').toLowerCase();

    if (tag.attrs.href) {
      if (rel === 'self' || rel === 'enclosure' || rel === 'hub' || rel === 'icon') {
        continue;
      }
      const validHref = sanitizeHttpUrl(tag.attrs.href, false);
      if (validHref) {
        let score = 1;
        if (!rel || rel === 'alternate') {
          score = !type || type.includes('html') ? 4 : 3;
        }
        if (score > bestScore) {
          bestScore = score;
          bestHref = validHref;
        }
      }
    }

    const innerText = cleanXmlText(tag.inner);
    if (innerText) {
      const validInner = sanitizeHttpUrl(innerText, false);
      if (validInner && 3 > bestScore) {
        bestScore = 3;
        bestHref = validInner;
      }
    }
  }

  if (bestHref) return bestHref;

  const guidTags = extractTagOccurrences(block, 'guid');
  for (const guid of guidTags) {
    if ((guid.attrs.ispermalink || '').toLowerCase() === 'false') continue;
    const candidate = cleanXmlText(guid.inner);
    const valid = sanitizeHttpUrl(candidate, false);
    if (valid) return valid;
  }

  return null;
}

/**
 * Normalize a feed date string to ISO-8601 UTC.
 * @param {string} rawDate
 * @param {string} fallbackIso
 * @returns {string}
 */
function normalizeFeedDate(rawDate, fallbackIso) {
  if (!rawDate) return fallbackIso;
  const parsed = Date.parse(rawDate);
  if (Number.isNaN(parsed)) return fallbackIso;
  return new Date(parsed).toISOString();
}

/**
 * Parse HTML blog index pages (such as `https://antigravity.google/blog`) when XML RSS is unavailable.
 * Scans `<article>` cards and `/blog/<slug>` anchors safely without `DOMParser`.
 * @param {string} htmlText
 * @param {{ id?: string, name?: string, xmlUrl?: string, siteUrl?: string }} [source]
 * @returns {any[]}
 */
export function parseBlogHtml(htmlText, source = {}) {
  if (typeof htmlText !== 'string' || htmlText.trim() === '') return [];
  const baseUrl = sanitizeHttpUrl(source?.siteUrl || source?.xmlUrl || '', false);
  if (!baseUrl) return [];

  const sourceId = typeof source?.id === 'string' ? source.id : '';
  const sourceName = typeof source?.name === 'string' && source.name.trim()
    ? source.name.trim()
    : extractDomain(baseUrl) || 'Blog';
  const fallbackIso = new Date().toISOString();

  const parsed = [];
  const seenUrls = new Set();

  const anchors = extractTagOccurrences(htmlText, 'a');
  for (const anchor of anchors) {
    if (parsed.length >= MAX_ITEMS_PER_FEED) break;
    const rawHref = anchor.attrs.href;
    if (!rawHref) continue;

    let resolved;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    const cleanUrl = sanitizeHttpUrl(resolved.href, false);
    if (!cleanUrl || cleanUrl === baseUrl || seenUrls.has(cleanUrl)) continue;

    // Require blog/news/engineering post slug depth so nav links are ignored.
    const pathParts = resolved.pathname.split('/').filter(Boolean);
    const isPostPath = pathParts.length >= 2 && (
      resolved.pathname.includes('/blog/')
      || resolved.pathname.includes('/engineering/')
      || resolved.pathname.includes('/news/')
      || resolved.pathname.includes('/index/')
    );
    if (!isPostPath) continue;

    const headingTitle = extractFirstTagText(anchor.inner, ['h1', 'h2', 'h3', 'h4']);
    const fallbackTitle = cleanXmlText(anchor.inner);
    const title = headingTitle || (fallbackTitle.length <= 140 ? fallbackTitle : '');
    if (!title || title.length < 12) continue;

    const paragraphSummary = extractFirstTagText(anchor.inner, ['p']);
    const summary = truncateProse(
      paragraphSummary || `Published on ${sourceName}. Open to read the full technical write-up and release notes.`
    );
    const timeTags = extractTagOccurrences(anchor.inner, 'time');
    const rawDate = timeTags[0]?.attrs?.datetime || cleanXmlText(timeTags[0]?.inner || '');
    const publishedAt = normalizeFeedDate(rawDate, fallbackIso);

    seenUrls.add(cleanUrl);
    parsed.push({
      id: `rssitem_${hashString(`${sourceId}|${cleanUrl}`)}`,
      sourceId,
      sourceName,
      title,
      url: cleanUrl,
      summary,
      keyPoints: extractKeyPointsFromHtml(anchor.inner, summary),
      sources: extractCitedSources('', cleanUrl, sourceName, baseUrl),
      author: sourceName,
      categories: source?.category ? [String(source.category).toLowerCase()] : [],
      publishedAt,
      estReadMins: estimateReadMinutes(`${title} ${summary}`, cleanUrl)
    });
  }

  return parsed;
}

/**
 * Parse RSS 2.0 (`<item>`), Atom 1.0 (`<entry>`), or fallback HTML blog index into rich RssArticleItem[].
 * Works cleanly in Node.js, Browser Windows, and MV3 Service Workers without `DOMParser`.
 * @param {string} xmlText
 * @param {{ id?: string, name?: string, siteUrl?: string, xmlUrl?: string, category?: string }} [source]
 * @returns {any[]}
 */
export function parseFeedXml(xmlText, source = {}) {
  if (typeof xmlText !== 'string' || xmlText.trim() === '') {
    return [];
  }

  const rssItems = extractTagOccurrences(xmlText, 'item');
  const atomEntries = rssItems.length > 0 ? [] : extractTagOccurrences(xmlText, 'entry');
  const rawBlocks = rssItems.length > 0 ? rssItems : atomEntries;

  if (rawBlocks.length === 0) {
    if (/<html\b|<body\b|<article\b/i.test(xmlText)) {
      return parseBlogHtml(xmlText, source);
    }
    return [];
  }

  const fallbackIso = new Date().toISOString();
  const sourceId = typeof source?.id === 'string' ? source.id : '';
  const sourceName = typeof source?.name === 'string' && source.name.trim()
    ? source.name.trim()
    : '';
  const siteUrl = sanitizeHttpUrl(source?.siteUrl || '', false);

  const parsed = [];
  const seenUrls = new Set();

  for (const block of rawBlocks) {
    if (parsed.length >= MAX_ITEMS_PER_FEED) break;

    const title = extractFirstTagText(block.inner, ['title']);
    const url = extractItemUrl(block.inner);
    if (!title || !url || seenUrls.has(url)) continue;

    seenUrls.add(url);
    const rawDate = extractFirstTagText(block.inner, ['pubDate', 'published', 'updated', 'dc:date']);
    const publishedAt = normalizeFeedDate(rawDate, fallbackIso);
    const resolvedSourceName = sourceName || extractDomain(url) || 'Feed';

    const richHtml = extractRawRichHtml(block.inner);
    const descText = extractFirstTagText(block.inner, ['description', 'summary', 'content:encoded', 'content']);
    const summary = truncateProse(
      descText || `Latest engineering post from ${resolvedSourceName}. Click to inspect sources or read in a new tab.`
    );
    const keyPoints = extractKeyPointsFromHtml(richHtml, summary);
    const sources = extractCitedSources(richHtml, url, resolvedSourceName, siteUrl);
    const author = extractAuthor(block.inner);
    const categories = extractCategories(block.inner);

    parsed.push({
      id: `rssitem_${hashString(`${sourceId}|${url}`)}`,
      sourceId,
      sourceName: resolvedSourceName,
      title,
      url,
      summary,
      keyPoints,
      sources,
      author,
      categories,
      publishedAt,
      estReadMins: estimateReadMinutes(`${title} ${summary}`, url)
    });
  }

  parsed.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return parsed;
}

/**
 * Rich curated catalog across Antigravity, Gemini, DeepMind, Claude, OpenAI/ChatGPT,
 * Daily.dev, Web.dev, Chrome Developers, and Smashing Magazine.
 */
const CURATED_CATALOG = [
  // --- Google Antigravity ---
  {
    id: 'rss_curated_antigravity_1',
    sourceId: 'rss_antigravity',
    sourceName: 'Google Antigravity',
    title: 'Multi-Agent Orchestration & Gemini 4 Model Tiers in Google Antigravity',
    url: 'https://antigravity.google/blog',
    summary: 'How Google Antigravity pairs high-reasoning coordinator models with fast parallel execution subagents, isolated workspaces, skills, and state-bound verification gates.',
    keyPoints: [
      'Route complex contract & architecture seams to high-reasoning models while delegating bounded implementation to fast workers.',
      'Enforce explicit file write ownership and watchdog timers across multi-wave agent workflows.',
      'Extend workspace capabilities cleanly via SKILL.md packages and MCP servers.'
    ],
    sources: [
      { label: 'Google Antigravity Blog', url: 'https://antigravity.google/blog', kind: 'primary' },
      { label: 'Google Antigravity Docs & Releases', url: 'https://antigravity.google', kind: 'reference' }
    ],
    author: 'Google Antigravity Team',
    categories: ['antigravity', 'agents', 'orchestration'],
    publishedAt: '2026-11-19T16:00:00.000Z',
    estReadMins: 7
  },
  {
    id: 'rss_curated_antigravity_2',
    sourceId: 'rss_antigravity',
    sourceName: 'Google Antigravity',
    title: 'Google Antigravity 2.0, CLI, and Managed Agent SDK Architecture',
    url: 'https://antigravity.google',
    summary: 'Deep dive into Antigravity 2.0’s agent-first command surface, terminal CLI (`agy`), Remote Control sessions, and custom SDK workflows for engineering teams.',
    keyPoints: [
      'Unified desktop command center, terminal CLI, and browser verification loop.',
      'Portable plugins bundling skills, rules, subagents, and MCP servers as one unit.'
    ],
    sources: [
      { label: 'Google Antigravity Platform', url: 'https://antigravity.google', kind: 'primary' },
      { label: 'Google Antigravity Blog', url: 'https://antigravity.google/blog', kind: 'publication' }
    ],
    author: 'Google Antigravity Team',
    categories: ['antigravity', 'cli', 'sdk'],
    publishedAt: '2026-11-18T15:30:00.000Z',
    estReadMins: 6
  },

  // --- Google Gemini & DeepMind ---
  {
    id: 'rss_curated_gemini_1',
    sourceId: 'rss_gemini',
    sourceName: 'Google Gemini Blog',
    title: 'Gemini for Developers: Long-Context Reasoning, Deep Think & Agentic Tool Use',
    url: 'https://blog.google/products/gemini/',
    summary: 'Exploring how Gemini combines million-token repository comprehension, configurable thinking budgets, and native multimodal tool execution for software engineering.',
    keyPoints: [
      'Million-token context window enables whole-codebase contract verification without lossy chunking.',
      'Adaptive thinking budgets match latency and cost to task complexity.',
      'Native computer-use and structured JSON outputs power reliable automation.'
    ],
    sources: [
      { label: 'Google Gemini Official Blog', url: 'https://blog.google/products/gemini/', kind: 'primary' },
      { label: 'Google AI Technology Blog', url: 'https://blog.google/technology/ai/', kind: 'reference' },
      { label: 'Google AI for Developers Docs', url: 'https://ai.google.dev/', kind: 'spec' }
    ],
    author: 'Google Gemini Team',
    categories: ['gemini', 'ai', 'reasoning'],
    publishedAt: '2026-11-19T14:20:00.000Z',
    estReadMins: 6
  },
  {
    id: 'rss_curated_deepmind_1',
    sourceId: 'rss_deepmind',
    sourceName: 'Google DeepMind',
    title: 'Frontier Reasoning, Code Verification, and Multi-Agent Research at DeepMind',
    url: 'https://deepmind.google/discover/blog/',
    summary: 'Research insights from Google DeepMind on scaling test-time reasoning, formal verification loops, and collaborative specialist agents for science and systems engineering.',
    keyPoints: [
      'Combining search and self-verification sharply reduces subtle logic bugs on multi-file tasks.',
      'Adversarial verifier passes catch boundary regressions before integration.'
    ],
    sources: [
      { label: 'Google DeepMind Blog', url: 'https://deepmind.google/discover/blog/', kind: 'primary' },
      { label: 'Google Research Blog', url: 'https://research.google/blog/', kind: 'reference' }
    ],
    author: 'Google DeepMind Research',
    categories: ['gemini', 'deepmind', 'research'],
    publishedAt: '2026-11-18T13:00:00.000Z',
    estReadMins: 8
  },

  // --- Claude / Anthropic ---
  {
    id: 'rss_curated_claude_eng_1',
    sourceId: 'rss_claude_eng',
    sourceName: 'Claude Engineering',
    title: 'Building Effective Agents & Context-Clean Harnesses with Claude',
    url: 'https://www.anthropic.com/engineering',
    summary: 'Anthropic Engineering shares battle-tested patterns for agentic coding harnesses, subagent context isolation, memory consolidation, and tool interface ergonomics.',
    keyPoints: [
      'Start with simple, transparent control loops and add multi-agent delegation only where parallel or high-context boundaries justify it.',
      'Design tool schemas and error messages from the agent’s perspective to prevent retry thrashing.',
      'Persist verified architectural decisions across compactions rather than raw transcript dumps.'
    ],
    sources: [
      { label: 'Anthropic Engineering Blog', url: 'https://www.anthropic.com/engineering', kind: 'primary' },
      { label: 'Claude Documentation', url: 'https://docs.anthropic.com/', kind: 'spec' },
      { label: 'Community XML Mirror (Olshansk)', url: 'https://github.com/Olshansk/rss-feeds', kind: 'reference' }
    ],
    author: 'Anthropic Engineering',
    categories: ['claude', 'agents', 'architecture'],
    publishedAt: '2026-11-19T12:15:00.000Z',
    estReadMins: 8
  },
  {
    id: 'rss_curated_claude_news_1',
    sourceId: 'rss_claude_news',
    sourceName: 'Claude & Anthropic News',
    title: 'Claude Model Updates, Extended Thinking, and Enterprise Developer Workflows',
    url: 'https://www.anthropic.com/news',
    summary: 'Latest announcements from Anthropic covering frontier Claude coding & reasoning performance, Model Context Protocol (MCP) ecosystems, and safe autonomous execution.',
    keyPoints: [
      'Model Context Protocol (MCP) standardizes secure local & remote tool integrations.',
      'Extended thinking improves root-cause debugging across large polyglot repositories.'
    ],
    sources: [
      { label: 'Anthropic Newsroom', url: 'https://www.anthropic.com/news', kind: 'primary' },
      { label: 'Model Context Protocol Spec', url: 'https://modelcontextprotocol.io/', kind: 'reference' }
    ],
    author: 'Anthropic',
    categories: ['claude', 'mcp', 'models'],
    publishedAt: '2026-11-18T10:30:00.000Z',
    estReadMins: 5
  },

  // --- OpenAI & ChatGPT ---
  {
    id: 'rss_curated_openai_1',
    sourceId: 'rss_openai',
    sourceName: 'OpenAI & ChatGPT',
    title: 'The Responses API, Codex Agents, and Production Reasoning Workflows',
    url: 'https://openai.com/news/',
    summary: 'OpenAI’s engineering and product updates on ChatGPT, autonomous repo-scale coding with Codex, encrypted reasoning state reuse, and native tool orchestration.',
    keyPoints: [
      'Unified Responses API streamlines stateful tool-calling loops and multimodal inputs.',
      'Parallel background coding threads accelerate test generation, migrations, and PR triage.',
      'Zero Data Retention (ZDR) encrypted reasoning tokens preserve privacy across multi-turn steps.'
    ],
    sources: [
      { label: 'OpenAI Official News', url: 'https://openai.com/news/', kind: 'primary' },
      { label: 'OpenAI RSS Feed', url: 'https://openai.com/news/rss.xml', kind: 'reference' },
      { label: 'OpenAI Developer Platform', url: 'https://platform.openai.com/docs/', kind: 'spec' }
    ],
    author: 'OpenAI',
    categories: ['chatgpt', 'codex', 'agents'],
    publishedAt: '2026-11-19T11:00:00.000Z',
    estReadMins: 7
  },

  // --- Daily.dev, Web.dev, Chrome Developers & Smashing Magazine ---
  {
    id: 'rss_curated_dailydev_1',
    sourceId: 'rss_dailydev',
    sourceName: 'Daily.dev',
    title: 'Designing Resilient Edge Gateways with Predictable Latency Budgets',
    url: 'https://web.dev/articles/optimize-ttfb',
    summary: 'Practical architectural patterns for keeping edge Time to First Byte (TTFB) fast and predictable using stale-while-revalidate caching, connection coalescing, and origin timeouts.',
    keyPoints: [
      'Measure Server-Timing headers per upstream hop to isolate origin vs CDN delays.',
      'Pair short fresh TTLs with generous stale-while-revalidate windows during rollouts.'
    ],
    sources: [
      { label: 'Web.dev — Optimize TTFB', url: 'https://web.dev/articles/optimize-ttfb', kind: 'primary' },
      { label: 'Daily.dev Community', url: 'https://app.daily.dev', kind: 'publication' }
    ],
    author: 'Web Performance Working Group',
    categories: ['engineering', 'performance'],
    publishedAt: '2026-11-19T06:30:00.000Z',
    estReadMins: 8
  },
  {
    id: 'rss_curated_webdev_1',
    sourceId: 'rss_webdev',
    sourceName: 'Web.dev',
    title: 'CSS Anchor Positioning and Popover API Without Layout Thrash',
    url: 'https://web.dev/articles/anchor-positioning',
    summary: 'Build responsive menus, rich context cards, and tooltips anchored declaratively in CSS with automatic viewport flip fallbacks and zero main-thread scroll overhead.',
    keyPoints: [
      'Replaces runtime JS bounding-box polling with compositor-friendly CSS rules.',
      'Combines seamlessly with native <dialog> and [popover] top-layer semantics.'
    ],
    sources: [
      { label: 'Web.dev — CSS Anchor Positioning', url: 'https://web.dev/articles/anchor-positioning', kind: 'primary' },
      { label: 'MDN CSS Anchor Positioning', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning', kind: 'spec' }
    ],
    author: 'Chrome Web.dev',
    categories: ['web', 'css', 'ui'],
    publishedAt: '2026-11-19T05:00:00.000Z',
    estReadMins: 8
  },
  {
    id: 'rss_curated_chrome_1',
    sourceId: 'rss_chromedevs',
    sourceName: 'Chrome Developers',
    title: 'Smooth Page Navigation with Cross-Document View Transitions & MV3 Patterns',
    url: 'https://developer.chrome.com/docs/web-platform/view-transitions',
    summary: 'How modern web apps and Manifest V3 Chrome extensions achieve instant perceived responsiveness using View Transitions, Side Panels, and ephemeral Service Workers.',
    keyPoints: [
      'Use @view-transition { navigation: auto; } with prefers-reduced-motion respect.',
      'Persist all extension state in chrome.storage.local rather than service worker globals.'
    ],
    sources: [
      { label: 'Chrome View Transitions Guide', url: 'https://developer.chrome.com/docs/web-platform/view-transitions', kind: 'primary' },
      { label: 'Chrome Side Panel API Reference', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel', kind: 'spec' }
    ],
    author: 'Chrome Developers',
    categories: ['chrome', 'extensions', 'ux'],
    publishedAt: '2026-11-19T04:00:00.000Z',
    estReadMins: 6
  },
  {
    id: 'rss_curated_smashing_1',
    sourceId: 'rss_smashing',
    sourceName: 'Smashing Magazine',
    title: 'Calm Typography, Circadian Color Tokens, and Accessible Native Dialogs',
    url: 'https://www.smashingmagazine.com/2024/05/modern-css-layouts/',
    summary: 'Designing low-cortisol engineering workspaces with warm editorial typography, zero layout shift (CLS = 0) CSS Grids, and keyboard-first <dialog> modals.',
    keyPoints: [
      'Avoid harsh pure-black-on-white contrast; favor warm paper surfaces and espresso ink.',
      'Reserve explicit min-heights on async panels so incoming feeds never shift click targets.'
    ],
    sources: [
      { label: 'Smashing Magazine — Modern CSS Layouts', url: 'https://www.smashingmagazine.com/2024/05/modern-css-layouts/', kind: 'primary' },
      { label: 'Smashing Magazine Front-End Index', url: 'https://www.smashingmagazine.com', kind: 'publication' }
    ],
    author: 'Smashing Magazine',
    categories: ['frontend', 'design-systems', 'a11y'],
    publishedAt: '2026-11-18T11:30:00.000Z',
    estReadMins: 8
  }
];

/**
 * Return curated fallback articles aligned with enabled RSS sources when offline or blocked.
 * @param {Array<{ id: string, name: string, enabled?: boolean }>} [sources]
 * @returns {any[]}
 */
export function getCuratedFallbackArticles(sources) {
  const sourceList = Array.isArray(sources) ? sources : createDefaultState().rssSources;
  const enabledSources = sourceList.filter((src) => src && src.enabled !== false);
  if (enabledSources.length === 0) {
    return [];
  }

  const enabledIds = new Set(enabledSources.map((src) => src.id));
  const enabledNames = new Set(enabledSources.map((src) => (src.name || '').toLowerCase()));

  const matched = CURATED_CATALOG.filter(
    (item) => enabledIds.has(item.sourceId) || enabledNames.has(item.sourceName.toLowerCase())
  );

  const selected = matched.length > 0 ? matched : CURATED_CATALOG.slice(0, 6);
  return selected
    .map((item) => {
      const safeUrl = sanitizeHttpUrl(item.url, false);
      if (!safeUrl) return null;
      return {
        ...item,
        url: safeUrl,
        sources: normalizeSourcesList(item.sources, safeUrl, item.sourceName, false)
      };
    })
    .filter(Boolean);
}

/**
 * Fetch and parse a single RSS/Atom/HTML source safely with a timeout,
 * falling back to curated items for that source if unreachable or SPA-rendered.
 * @param {{ id: string, name: string, xmlUrl: string, siteUrl?: string, category?: string }} source
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<{ items: any[], fromLive: boolean }>}
 */
async function fetchSingleSource(source, fetchImpl) {
  const cleanFeedUrl = sanitizeHttpUrl(source?.xmlUrl, false);
  if (!cleanFeedUrl) {
    return { items: getCuratedFallbackArticles([source]), fromLive: false };
  }

  const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
  const timerId = controller
    ? globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetchImpl(cleanFeedUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5'
      },
      signal: controller ? controller.signal : undefined
    });
    if (response.ok) {
      const bodyText = await response.text();
      const parsed = parseFeedXml(bodyText, source);
      if (parsed.length > 0) {
        return { items: parsed, fromLive: true };
      }
    }
  } catch {
    // Fall through to per-source curated fallback below.
  } finally {
    if (timerId !== null) {
      globalThis.clearTimeout(timerId);
    }
  }

  const perSourceFallback = CURATED_CATALOG.filter((item) => item.sourceId === source.id);
  return { items: perSourceFallback, fromLive: false };
}

/**
 * Refresh RSS feeds (respecting 30-minute TTL unless `force: true`),
 * filter dismissed URLs, and ensure every enabled source has rich, non-dry items.
 * @param {{ force?: boolean, fetchImpl?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ items: any[], fromCache: boolean, usedFallback: boolean }>}
 */
export async function refreshRssFeeds(options = { force: false, fetchImpl: globalThis.fetch }) {
  const { force = false, fetchImpl = globalThis.fetch } = options || {};
  const state = await loadState();

  const dismissedSet = new Set(state.rssCache?.dismissedUrls || []);
  const enabledSources = (state.rssSources || []).filter((src) => src.enabled !== false);
  const enabledIds = new Set(enabledSources.map((src) => src.id));

  if (!force && state.rssCache?.fetchedAt && Array.isArray(state.rssCache.items)) {
    const fetchedMs = Date.parse(state.rssCache.fetchedAt);
    const ageMs = Date.now() - fetchedMs;
    if (!Number.isNaN(ageMs) && ageMs >= 0 && ageMs < RSS_CACHE_TTL_MS) {
      const validCached = state.rssCache.items.filter(
        (item) => item && !dismissedSet.has(item.url) && (!item.sourceId || enabledIds.has(item.sourceId))
      );
      if (validCached.length > 0) {
        return { items: validCached, fromCache: true, usedFallback: false };
      }
    }
  }

  if (enabledSources.length === 0) {
    await updateRssCache([], new Date().toISOString());
    return { items: [], fromCache: false, usedFallback: false };
  }

  let anyLiveSucceeded = false;
  const combinedItems = [];

  if (typeof fetchImpl === 'function') {
    const results = await Promise.all(
      enabledSources.map((source) => fetchSingleSource(source, fetchImpl))
    );
    const seenKeys = new Set();
    for (const res of results) {
      if (res.fromLive) anyLiveSucceeded = true;
      for (const item of res.items) {
        if (!item || dismissedSet.has(item.url)) continue;
        const dedupKey = `${item.sourceId}|${item.url}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);
        combinedItems.push(item);
      }
    }
  }

  if (combinedItems.length > 0) {
    combinedItems.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const bounded = combinedItems.slice(0, MAX_TOTAL_CACHED_ITEMS);
    await updateRssCache(bounded, anyLiveSucceeded ? new Date().toISOString() : null);
    return { items: bounded, fromCache: false, usedFallback: !anyLiveSucceeded };
  }

  const fallbackItems = getCuratedFallbackArticles(enabledSources).filter(
    (item) => !dismissedSet.has(item.url)
  );
  await updateRssCache(fallbackItems, null);
  return { items: fallbackItems, fromCache: false, usedFallback: true };
}
