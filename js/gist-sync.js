/**
 * Calm Morning Gateway — Conflict-Safe Private GitHub Gist Sync (`js/gist-sync.js`)
 *
 * Implements two-way synchronization against `https://api.github.com/gists` using
 * `gateway-state.json` while keeping Personal Access Tokens strictly local-only.
 */

import {
  exportCleanStateJson,
  loadState,
  mergeStates,
  sanitizeHttpUrl,
  saveState,
  updateSyncMetadata
} from './store.js';

export const GIST_FILENAME = 'gateway-state.json';

const GITHUB_API_BASE = 'https://api.github.com/gists';
const GITHUB_API_VERSION = '2022-11-28';
const GIST_ID_PATTERN = /^[a-f0-9]{8,64}$/i;

/**
 * Validate GitHub Gist ID strictly to prevent SSRF or path traversal.
 * @param {string} gistId
 * @returns {string}
 */
function assertValidGistId(gistId) {
  const trimmed = typeof gistId === 'string' ? gistId.trim() : '';
  if (!GIST_ID_PATTERN.test(trimmed)) {
    throw new Error('Invalid GitHub Gist ID format. Expected 8-64 hex characters.');
  }
  return trimmed;
}

/**
 * Validate GitHub Personal Access Token without exposing it.
 * @param {string} githubPat
 * @returns {string}
 */
function assertValidPat(githubPat) {
  const trimmed = typeof githubPat === 'string' ? githubPat.trim() : '';
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error('Valid GitHub Personal Access Token is required.');
  }
  return trimmed;
}

/**
 * Ensure a fetch implementation is available.
 * @param {typeof globalThis.fetch} fetchImpl
 */
function assertFetchImpl(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is unavailable in this environment.');
  }
}

/**
 * Scrub any accidental occurrence of the PAT from error strings.
 * @param {string} message
 * @param {string} token
 * @returns {string}
 */
function redactToken(message, token) {
  const raw = typeof message === 'string' && message ? message : 'GitHub Gist sync error';
  if (!token) return raw;
  return raw.split(token).join('[REDACTED]');
}

/**
 * Build standard GitHub REST API headers.
 * @param {string} githubPat
 * @param {boolean} [includeJsonContentType=false]
 * @returns {Record<string, string>}
 */
function buildGitHubHeaders(githubPat, includeJsonContentType = false) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubPat}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION
  };
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/**
 * Parse a safe error message from a failed GitHub API response.
 * @param {Response} response
 * @param {string} operation
 * @param {string} token
 * @returns {Promise<string>}
 */
async function buildApiErrorMessage(response, operation, token) {
  let detail = '';
  try {
    const bodyText = await response.text();
    if (bodyText) {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed?.message === 'string') {
        detail = parsed.message;
      }
    }
  } catch {
    detail = '';
  }

  if (response.status === 401 || response.status === 403) {
    return redactToken(`GitHub authorization failed (${response.status}). Verify PAT gist scope.`, token);
  }
  if (response.status === 404) {
    return redactToken(`GitHub Gist not found (404) during ${operation}.`, token);
  }
  const suffix = detail ? `: ${detail}` : '';
  return redactToken(`GitHub ${operation} failed (${response.status})${suffix}`, token);
}

/**
 * Serialize GatewayState into JSON for Gist upload, strictly stripping githubPat.
 * @param {any} state
 * @returns {string}
 */
export function serializeStateForGist(state) {
  return exportCleanStateJson(state);
}

/**
 * Create a new secret (private) GitHub Gist storing `gateway-state.json`.
 * @param {string} githubPat
 * @param {any} initialState
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<{ gistId: string, htmlUrl: string, updatedAt: string }>}
 */
export async function createPrivateGist(githubPat, initialState, fetchImpl = globalThis.fetch) {
  const cleanPat = assertValidPat(githubPat);
  assertFetchImpl(fetchImpl);

  const payload = {
    description: 'Calm Morning Gateway — Synced State',
    public: false,
    files: {
      [GIST_FILENAME]: {
        content: serializeStateForGist(initialState)
      }
    }
  };

  let response;
  try {
    response = await fetchImpl(GITHUB_API_BASE, {
      method: 'POST',
      headers: buildGitHubHeaders(cleanPat, true),
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(redactToken(`Network error creating Gist: ${err?.message || 'request failed'}`, cleanPat));
  }

  if (!response.ok) {
    const msg = await buildApiErrorMessage(response, 'create', cleanPat);
    throw new Error(msg);
  }

  const data = await response.json();
  const gistId = assertValidGistId(data?.id);
  const htmlUrl = sanitizeHttpUrl(data?.html_url, false) || '';
  const updatedAt = typeof data?.updated_at === 'string' ? data.updated_at : new Date().toISOString();

  return { gistId, htmlUrl, updatedAt };
}

/**
 * Pull remote `gateway-state.json` from a GitHub Gist.
 * @param {string} gistId
 * @param {string} githubPat
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<{ remoteState: any | null, etag?: string }>}
 */
export async function pullFromGist(gistId, githubPat, fetchImpl = globalThis.fetch) {
  const cleanGistId = assertValidGistId(gistId);
  const cleanPat = assertValidPat(githubPat);
  assertFetchImpl(fetchImpl);

  const url = `${GITHUB_API_BASE}/${cleanGistId}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: buildGitHubHeaders(cleanPat, false)
    });
  } catch (err) {
    throw new Error(redactToken(`Network error pulling Gist: ${err?.message || 'request failed'}`, cleanPat));
  }

  if (!response.ok) {
    const msg = await buildApiErrorMessage(response, 'pull', cleanPat);
    throw new Error(msg);
  }

  const etag = response.headers?.get?.('etag') || undefined;
  const data = await response.json();
  const fileEntry = data?.files?.[GIST_FILENAME];

  if (!fileEntry) {
    return { remoteState: null, etag };
  }

  let content = typeof fileEntry.content === 'string' ? fileEntry.content : '';
  if (fileEntry.truncated && typeof fileEntry.raw_url === 'string') {
    const rawUrl = sanitizeHttpUrl(fileEntry.raw_url, false);
    if (rawUrl) {
      const parsedRaw = new URL(rawUrl);
      if (parsedRaw.protocol === 'https:' && parsedRaw.hostname === 'gist.githubusercontent.com') {
        const rawRes = await fetchImpl(parsedRaw.href, { method: 'GET' });
        if (rawRes.ok) {
          content = await rawRes.text();
        }
      }
    }
  }

  if (!content.trim()) {
    return { remoteState: null, etag };
  }

  let remoteState;
  try {
    remoteState = JSON.parse(content);
  } catch {
    throw new Error(`Remote Gist file "${GIST_FILENAME}" contains invalid JSON.`);
  }

  if (remoteState && typeof remoteState === 'object' && remoteState.sync && typeof remoteState.sync === 'object') {
    remoteState.sync.githubPat = '';
  }

  return { remoteState, etag };
}

/**
 * Push clean serialized GatewayState to an existing GitHub Gist.
 * @param {string} gistId
 * @param {string} githubPat
 * @param {any} state
 * @param {typeof globalThis.fetch} [fetchImpl]
 * @returns {Promise<{ syncedAt: string }>}
 */
export async function pushToGist(gistId, githubPat, state, fetchImpl = globalThis.fetch) {
  const cleanGistId = assertValidGistId(gistId);
  const cleanPat = assertValidPat(githubPat);
  assertFetchImpl(fetchImpl);

  const url = `${GITHUB_API_BASE}/${cleanGistId}`;
  const payload = {
    files: {
      [GIST_FILENAME]: {
        content: serializeStateForGist(state)
      }
    }
  };

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'PATCH',
      headers: buildGitHubHeaders(cleanPat, true),
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(redactToken(`Network error pushing Gist: ${err?.message || 'request failed'}`, cleanPat));
  }

  if (!response.ok) {
    const msg = await buildApiErrorMessage(response, 'push', cleanPat);
    throw new Error(msg);
  }

  const data = await response.json();
  const syncedAt = typeof data?.updated_at === 'string' ? data.updated_at : new Date().toISOString();
  return { syncedAt };
}

/**
 * Execute full two-way conflict-safe sync with GitHub Gist.
 * Auto-creates a secret Gist when githubPat is configured and gistId is empty.
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ status: 'local-only' | 'synced' | 'error', state: any, error?: string }>}
 */
export async function syncWithGist(options = { fetchImpl: globalThis.fetch }) {
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  const localState = await loadState();
  const githubPat = (localState.sync?.githubPat || '').trim();

  if (!githubPat) {
    const cleanLocal = localState.sync?.lastSyncStatus !== 'local-only' || localState.sync?.lastSyncError
      ? await updateSyncMetadata({ lastSyncStatus: 'local-only', lastSyncError: null })
      : localState;
    return { status: 'local-only', state: cleanLocal };
  }

  await updateSyncMetadata({ lastSyncStatus: 'syncing', lastSyncError: null });

  try {
    const existingGistId = (localState.sync?.gistId || '').trim();

    if (!existingGistId) {
      const created = await createPrivateGist(githubPat, localState, fetchImpl);
      const updatedState = await updateSyncMetadata({
        gistId: created.gistId,
        lastSyncedAt: created.updatedAt,
        lastSyncStatus: 'synced',
        lastSyncError: null
      });
      return { status: 'synced', state: updatedState };
    }

    const { remoteState } = await pullFromGist(existingGistId, githubPat, fetchImpl);
    const merged = remoteState ? mergeStates(localState, remoteState) : localState;
    merged.sync.gistId = existingGistId;
    merged.sync.githubPat = githubPat;

    await saveState(merged, { bumpUpdatedAt: false, persistCredentials: true });
    const { syncedAt } = await pushToGist(existingGistId, githubPat, merged, fetchImpl);

    const finalState = await updateSyncMetadata({
      gistId: existingGistId,
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'synced',
      lastSyncError: null
    });
    return { status: 'synced', state: finalState };
  } catch (err) {
    const safeError = redactToken(err?.message || 'GitHub Gist sync failed', githubPat);
    const errState = await updateSyncMetadata({
      lastSyncStatus: 'error',
      lastSyncError: safeError
    });
    return { status: 'error', state: errState, error: safeError };
  }
}
