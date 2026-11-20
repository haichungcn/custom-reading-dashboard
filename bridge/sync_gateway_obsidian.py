#!/usr/bin/env python3
"""Calm Morning Gateway — Generic Markdown-to-Obsidian & Private GitHub Gist Bridge.

Stdlib-only Python 3.9+ bridge that:
1. Parses Daily Digest Markdown files (`YYYY-MM-DD*.md`) into `GatewayState v1`.
2. Merges checkbox edits from `Daily/YYYY-MM-DD.md` when newer than local state.
3. Performs conflict-safe two-way sync with a Private GitHub Gist (`gateway-state.json`)
   without ever serializing Personal Access Tokens into state JSON or Gist payloads.
4. Atomically exports `Daily/YYYY-MM-DD.md` and `Reading/Bookmarks.md` to Obsidian.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

GIST_FILENAME = "gateway-state.json"
GITHUB_API_HOST = "api.github.com"
GITHUB_API_VERSION = "2022-11-28"
DEFAULT_CONFIG_PATH = "~/.calm-gateway/config.json"
DEFAULT_STATE_FILE = "~/.calm-gateway/gateway-state.json"
DEFAULT_GITHUB_PAT_ENV = "CALM_GATEWAY_GITHUB_PAT"
DEFAULT_DELIVERED_AT = "09:00 UTC"
GIST_ID_RE = re.compile(r"^[a-fA-F0-9]{8,64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

CHANNEL_HEADING_RE = re.compile(r"^#{2,4}\s+.*?(#[a-zA-Z0-9][a-zA-Z0-9_-]*)\b")
BULLET_RE = re.compile(r"^(?:[-*+]|\d+\.)\s+(.+)$")
INLINE_CHANNEL_RE = re.compile(
    r"^(?:\*\*(#[a-zA-Z0-9][a-zA-Z0-9_-]*)\*\*|\[(#[a-zA-Z0-9][a-zA-Z0-9_-]*)\])\s*[:\-—]?\s*"
)
BADGE_RE = re.compile(r"^\[([A-Za-z][A-Za-z0-9 _-]{1,24})\]\s*")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
BARE_URL_RE = re.compile(r"(?:https?|obsidian)://[^\s<>()]+")
CHECKBOX_RE = re.compile(r"^\s*-\s*\[([ xX])\]\s+(.+?)\s*$")
TAG_RE = re.compile(r"(?:^|\s)#([a-zA-Z0-9][a-zA-Z0-9_-]*)")

ALLOWED_SCHEMES = {"http", "https", "obsidian"}


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format with Z suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def local_today_str() -> str:
    """Return local YYYY-MM-DD date string."""
    return datetime.now().strftime("%Y-%m-%d")


def parse_iso_timestamp(value: Any) -> float | None:
    """Parse an ISO-8601 string into epoch seconds, or None if invalid."""
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def max_iso_timestamp(a: str | None, b: str | None, fallback: str = "") -> str:
    """Return the newer of two ISO-8601 timestamps."""
    ta = parse_iso_timestamp(a)
    tb = parse_iso_timestamp(b)
    if ta is not None and tb is not None:
        return a if ta >= tb else b  # type: ignore[return-value]
    if ta is not None:
        return str(a)
    if tb is not None:
        return str(b)
    return fallback


def sanitize_url(raw_url: Any, allow_obsidian: bool = True) -> str | None:
    """Validate external URLs strictly against http:, https:, and optional obsidian:."""
    if not isinstance(raw_url, str):
        return None
    candidate = raw_url.strip().rstrip(".,;:")
    if not candidate or any(ch.isspace() for ch in candidate):
        return None
    try:
        parsed = urllib.parse.urlparse(candidate)
    except ValueError:
        return None

    scheme = parsed.scheme.lower()
    allowed = ALLOWED_SCHEMES if allow_obsidian else {"http", "https"}
    if scheme not in allowed:
        return None
    if scheme in {"http", "https"} and not parsed.netloc:
        return None
    if scheme == "obsidian" and not (parsed.netloc or parsed.path):
        return None
    return candidate


def extract_domain(url: str) -> str:
    """Extract clean hostname without leading www. from URL."""
    try:
        host = urllib.parse.urlparse(url).hostname or ""
    except ValueError:
        return ""
    if host.lower().startswith("www."):
        host = host[4:]
    return host.lower()


def validate_gist_id(gist_id: Any) -> str:
    """Validate GitHub Gist ID strictly against 8-64 hex characters."""
    if not isinstance(gist_id, str):
        raise ValueError("Invalid GitHub Gist ID: expected 8-64 hex characters.")
    cleaned = gist_id.strip()
    if not GIST_ID_RE.fullmatch(cleaned):
        raise ValueError("Invalid GitHub Gist ID: expected 8-64 hex characters.")
    return cleaned


def validate_date_str(date_str: Any, fallback: str | None = None) -> str:
    """Validate YYYY-MM-DD date string to prevent path traversal."""
    if isinstance(date_str, str) and DATE_RE.fullmatch(date_str.strip()):
        return date_str.strip()
    if fallback and DATE_RE.fullmatch(fallback):
        return fallback
    return local_today_str()


def deterministic_id(prefix: str, *parts: str) -> str:
    """Create a deterministic short SHA-256 ID from normalized parts."""
    joined = "|".join(p.strip().lower() for p in parts)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def normalize_tags(raw_tags: Any) -> list[str]:
    """Normalize a list of tags into unique lowercase tokens without '#'."""
    if not isinstance(raw_tags, list):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in raw_tags:
        if not isinstance(item, str):
            continue
        cleaned = item.strip().lstrip("#").lower()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result


def _deep_copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def create_default_state(active_date: str | None = None, user_name: str = "") -> dict[str, Any]:
    """Create a baseline GatewayState v1 dictionary."""
    today = validate_date_str(active_date)
    yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    now_iso = utc_now_iso()
    clean_user = user_name.strip() if isinstance(user_name, str) else ""
    return {
        "schemaVersion": 1,
        "updatedAt": now_iso,
        "activeDate": today,
        "userName": clean_user,
        "onboardingCompleted": False,
        "focusTheme": "Clarity over volume.",
        "digestConfig": {
            "title": "Daily Digest",
            "subtitle": "Team & Project Pulse",
            "feedUrl": "",
        },
        "objectives": [],
        "todos": [],
        "archivedLog": [],
        "slackDigest": {
            "date": yesterday,
            "deliveredAt": DEFAULT_DELIVERED_AT,
            "items": [],
        },
        "bookmarks": [],
        "rssSources": [],
        "rssCache": {
            "fetchedAt": None,
            "items": [],
            "dismissedUrls": [],
        },
        "wellness": {
            "moodOverride": "auto",
            "colorScheme": "auto",
            "focusMode": False,
            "rssCollapsed": False,
            "slackExpanded": False,
            "slackPanelCollapsed": False,
            "breaksToday": 0,
            "lastBreakAt": None,
            "promptIndex": 0,
            "activeMinutesStart": now_iso,
        },
        "sync": {
            "gistId": "",
            "githubPat": "",
            "lastSyncedAt": None,
            "lastSyncStatus": "local-only",
            "lastSyncError": None,
        },
        "tombstones": {},
    }


def normalize_state(raw_state: Any) -> dict[str, Any]:
    """Normalize arbitrary decoded JSON into a valid GatewayState v1 dict (PAT stripped)."""
    base = create_default_state()
    if not isinstance(raw_state, dict):
        return base

    state = _deep_copy_json(base)
    state["schemaVersion"] = 1
    if isinstance(raw_state.get("contentVersion"), (int, float)):
        state["contentVersion"] = int(raw_state["contentVersion"])
    state["updatedAt"] = (
        raw_state["updatedAt"]
        if parse_iso_timestamp(raw_state.get("updatedAt")) is not None
        else base["updatedAt"]
    )
    state["activeDate"] = validate_date_str(raw_state.get("activeDate"), base["activeDate"])
    if isinstance(raw_state.get("userName"), str):
        state["userName"] = raw_state["userName"].strip()
    if isinstance(raw_state.get("onboardingCompleted"), bool):
        state["onboardingCompleted"] = raw_state["onboardingCompleted"]
    if isinstance(raw_state.get("focusTheme"), str) and raw_state["focusTheme"].strip():
        state["focusTheme"] = raw_state["focusTheme"].strip()

    raw_digest_cfg = raw_state.get("digestConfig")
    if isinstance(raw_digest_cfg, dict):
        cfg_title = (
            raw_digest_cfg["title"].strip()[:60]
            if isinstance(raw_digest_cfg.get("title"), str) and raw_digest_cfg["title"].strip()
            else base["digestConfig"]["title"]
        )
        cfg_sub = (
            raw_digest_cfg["subtitle"].strip()[:80]
            if isinstance(raw_digest_cfg.get("subtitle"), str) and raw_digest_cfg["subtitle"].strip()
            else base["digestConfig"]["subtitle"]
        )
        cfg_url = sanitize_url(raw_digest_cfg.get("feedUrl"), allow_obsidian=False) or ""
        state["digestConfig"] = {
            "title": cfg_title,
            "subtitle": cfg_sub,
            "feedUrl": cfg_url,
        }

    for key in ("objectives", "todos", "archivedLog", "bookmarks", "rssSources"):
        val = raw_state.get(key)
        state[key] = [_deep_copy_json(x) for x in val if isinstance(x, dict)] if isinstance(val, list) else []

    raw_digest = raw_state.get("slackDigest")
    if isinstance(raw_digest, dict):
        state["slackDigest"] = {
            "date": validate_date_str(raw_digest.get("date"), state["activeDate"]),
            "deliveredAt": (
                raw_digest["deliveredAt"].strip()
                if isinstance(raw_digest.get("deliveredAt"), str) and raw_digest["deliveredAt"].strip()
                else DEFAULT_DELIVERED_AT
            ),
            "items": [
                _deep_copy_json(x)
                for x in (raw_digest.get("items") or [])
                if isinstance(x, dict)
            ],
        }

    raw_cache = raw_state.get("rssCache")
    if isinstance(raw_cache, dict):
        state["rssCache"] = {
            "fetchedAt": raw_cache.get("fetchedAt") if isinstance(raw_cache.get("fetchedAt"), str) else None,
            "items": [_deep_copy_json(x) for x in (raw_cache.get("items") or []) if isinstance(x, dict)],
            "dismissedUrls": [
                str(u) for u in (raw_cache.get("dismissedUrls") or []) if isinstance(u, str)
            ],
        }

    raw_wellness = raw_state.get("wellness")
    if isinstance(raw_wellness, dict):
        merged_wellness = dict(base["wellness"])
        for k in merged_wellness:
            if k in raw_wellness and raw_wellness[k] is not None:
                merged_wellness[k] = raw_wellness[k]
        state["wellness"] = merged_wellness

    for optional_block in ("layout", "widgets", "background"):
        if isinstance(raw_state.get(optional_block), dict):
            state[optional_block] = _deep_copy_json(raw_state[optional_block])

    raw_sync = raw_state.get("sync")
    if isinstance(raw_sync, dict):
        gist_val = ""
        if isinstance(raw_sync.get("gistId"), str) and raw_sync["gistId"].strip():
            try:
                gist_val = validate_gist_id(raw_sync["gistId"])
            except ValueError:
                gist_val = ""
        state["sync"] = {
            "gistId": gist_val,
            "githubPat": "",  # Strictly strip PAT from serialized/persisted state
            "lastSyncedAt": raw_sync.get("lastSyncedAt") if isinstance(raw_sync.get("lastSyncedAt"), str) else None,
            "lastSyncStatus": raw_sync.get("lastSyncStatus") if raw_sync.get("lastSyncStatus") in {"local-only", "synced", "syncing", "error"} else "local-only",
            "lastSyncError": raw_sync.get("lastSyncError") if isinstance(raw_sync.get("lastSyncError"), str) else None,
        }

    raw_tombstones = raw_state.get("tombstones")
    if isinstance(raw_tombstones, dict):
        state["tombstones"] = {
            str(k): str(v)
            for k, v in raw_tombstones.items()
            if isinstance(k, str) and k and isinstance(v, str) and parse_iso_timestamp(v) is not None
        }

    return state


def export_clean_state_json(state: dict[str, Any]) -> str:
    """Serialize GatewayState v1 JSON with sync.githubPat strictly cleared."""
    clean = normalize_state(state)
    clean["sync"]["githubPat"] = ""
    return json.dumps(clean, indent=2, ensure_ascii=False)


def _item_timestamp(item: dict[str, Any]) -> str:
    return str(item.get("updatedAt") or item.get("createdAt") or item.get("addedAt") or "")


def _merge_entity_list(
    local_items: list[dict[str, Any]],
    remote_items: list[dict[str, Any]],
    tombstones: dict[str, str],
) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}

    def consider(item: dict[str, Any]) -> None:
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            return
        item_ts_str = _item_timestamp(item)
        item_ts = parse_iso_timestamp(item_ts_str)
        tomb_ts_str = tombstones.get(item_id)
        if tomb_ts_str:
            tomb_ts = parse_iso_timestamp(tomb_ts_str)
            if item_ts is None or (tomb_ts is not None and item_ts <= tomb_ts):
                return

        existing = by_id.get(item_id)
        if existing is None:
            by_id[item_id] = dict(item)
            return

        existing_ts = parse_iso_timestamp(_item_timestamp(existing))
        if item_ts is not None and (existing_ts is None or item_ts > existing_ts):
            by_id[item_id] = dict(item)

    for item in local_items:
        consider(item)
    for item in remote_items:
        consider(item)

    return list(by_id.values())


def _pick_newer_block(local_block: Any, remote_block: Any) -> dict[str, Any] | None:
    has_local = isinstance(local_block, dict)
    has_remote = isinstance(remote_block, dict)
    if not has_local and not has_remote:
        return None
    if has_local and not has_remote:
        return _deep_copy_json(local_block)
    if has_remote and not has_local:
        return _deep_copy_json(remote_block)
    l_ts = parse_iso_timestamp(local_block.get("updatedAt"))
    r_ts = parse_iso_timestamp(remote_block.get("updatedAt"))
    if r_ts is not None and (l_ts is None or r_ts > l_ts):
        return _deep_copy_json(remote_block)
    return _deep_copy_json(local_block)


def merge_states(local_state: dict[str, Any], remote_state: dict[str, Any] | None) -> dict[str, Any]:
    """Conflict-safe two-way merge honoring tombstones and per-entity updatedAt."""
    local = normalize_state(local_state)
    if not isinstance(remote_state, dict):
        return local
    remote = normalize_state(remote_state)

    merged_tombstones = dict(local["tombstones"])
    for item_id, remote_ts in remote["tombstones"].items():
        if item_id not in merged_tombstones:
            merged_tombstones[item_id] = remote_ts
        else:
            merged_tombstones[item_id] = max_iso_timestamp(merged_tombstones[item_id], remote_ts, remote_ts)

    local_top = parse_iso_timestamp(local["updatedAt"])
    remote_top = parse_iso_timestamp(remote["updatedAt"])
    remote_is_newer = remote_top is not None and (local_top is None or remote_top > local_top)
    newer = remote if remote_is_newer else local

    archived_by_id: dict[str, dict[str, Any]] = {}
    for entry in [*local["archivedLog"], *remote["archivedLog"]]:
        eid = entry.get("id")
        if not isinstance(eid, str) or not eid:
            continue
        prev = archived_by_id.get(eid)
        if prev is None:
            archived_by_id[eid] = dict(entry)
        else:
            e_ts = parse_iso_timestamp(entry.get("completedAt"))
            p_ts = parse_iso_timestamp(prev.get("completedAt"))
            if e_ts is not None and (p_ts is None or e_ts > p_ts):
                archived_by_id[eid] = dict(entry)

    dismissed_urls = list(
        dict.fromkeys([*local["rssCache"]["dismissedUrls"], *remote["rssCache"]["dismissedUrls"]])
    )
    dismissed_set = set(dismissed_urls)
    local_cache_ts = parse_iso_timestamp(local["rssCache"].get("fetchedAt"))
    remote_cache_ts = parse_iso_timestamp(remote["rssCache"].get("fetchedAt"))
    use_remote_cache = remote_cache_ts is not None and (
        local_cache_ts is None or remote_cache_ts > local_cache_ts
    )
    chosen_cache = remote["rssCache"] if use_remote_cache else local["rssCache"]
    filtered_cache_items = [
        dict(item)
        for item in chosen_cache.get("items", [])
        if isinstance(item, dict) and item.get("url") not in dismissed_set
    ]

    use_remote_digest_meta = remote["slackDigest"]["date"] > local["slackDigest"]["date"] or (
        remote["slackDigest"]["date"] == local["slackDigest"]["date"] and remote_is_newer
    )

    last_synced = max_iso_timestamp(
        local["sync"].get("lastSyncedAt"),
        remote["sync"].get("lastSyncedAt"),
        "",
    )

    merged: dict[str, Any] = {
        "schemaVersion": 1,
        "updatedAt": max_iso_timestamp(local["updatedAt"], remote["updatedAt"], utc_now_iso()),
        "activeDate": newer["activeDate"],
        "userName": newer["userName"] or local["userName"],
        "onboardingCompleted": bool(local.get("onboardingCompleted") or remote.get("onboardingCompleted")),
        "focusTheme": newer["focusTheme"] or local["focusTheme"],
        "digestConfig": _deep_copy_json(newer["digestConfig"]),
        "objectives": _merge_entity_list(local["objectives"], remote["objectives"], merged_tombstones),
        "todos": _merge_entity_list(local["todos"], remote["todos"], merged_tombstones),
        "archivedLog": list(archived_by_id.values()),
        "slackDigest": {
            "date": remote["slackDigest"]["date"] if use_remote_digest_meta else local["slackDigest"]["date"],
            "deliveredAt": (
                remote["slackDigest"]["deliveredAt"]
                if use_remote_digest_meta
                else local["slackDigest"]["deliveredAt"]
            ),
            "items": _merge_entity_list(
                local["slackDigest"]["items"],
                remote["slackDigest"]["items"],
                merged_tombstones,
            ),
        },
        "bookmarks": _merge_entity_list(local["bookmarks"], remote["bookmarks"], merged_tombstones),
        "rssSources": _merge_entity_list(local["rssSources"], remote["rssSources"], merged_tombstones),
        "rssCache": {
            "fetchedAt": chosen_cache.get("fetchedAt"),
            "items": filtered_cache_items,
            "dismissedUrls": dismissed_urls,
        },
        "wellness": dict(newer["wellness"]),
        "sync": {
            "gistId": local["sync"]["gistId"] or remote["sync"]["gistId"] or "",
            "githubPat": "",
            "lastSyncedAt": last_synced or None,
            "lastSyncStatus": local["sync"].get("lastSyncStatus") or "local-only",
            "lastSyncError": local["sync"].get("lastSyncError"),
        },
        "tombstones": merged_tombstones,
    }

    if "contentVersion" in local or "contentVersion" in remote:
        merged["contentVersion"] = max(
            int(local.get("contentVersion") or 1),
            int(remote.get("contentVersion") or 1),
        )

    merged_layout = _pick_newer_block(local.get("layout"), remote.get("layout"))
    if merged_layout is not None:
        merged["layout"] = merged_layout

    local_widgets = local.get("widgets") if isinstance(local.get("widgets"), dict) else {}
    remote_widgets = remote.get("widgets") if isinstance(remote.get("widgets"), dict) else {}
    if local_widgets or remote_widgets:
        merged_widgets: dict[str, Any] = {}
        for scalar_key in ("weather", "pomodoro", "scratchpad"):
            chosen_sub = _pick_newer_block(local_widgets.get(scalar_key), remote_widgets.get(scalar_key))
            if chosen_sub is not None:
                merged_widgets[scalar_key] = chosen_sub
        if "worldClock" in local_widgets or "worldClock" in remote_widgets:
            l_clocks = (local_widgets.get("worldClock") or {}).get("clocks") or []
            r_clocks = (remote_widgets.get("worldClock") or {}).get("clocks") or []
            merged_widgets["worldClock"] = {
                "clocks": _merge_entity_list(l_clocks, r_clocks, merged_tombstones)
            }
        if "launchpad" in local_widgets or "launchpad" in remote_widgets:
            l_links = (local_widgets.get("launchpad") or {}).get("links") or []
            r_links = (remote_widgets.get("launchpad") or {}).get("links") or []
            merged_widgets["launchpad"] = {
                "links": _merge_entity_list(l_links, r_links, merged_tombstones)
            }
        if "habits" in local_widgets or "habits" in remote_widgets:
            l_habits = (local_widgets.get("habits") or {}).get("items") or []
            r_habits = (remote_widgets.get("habits") or {}).get("items") or []
            merged_widgets["habits"] = {
                "items": _merge_entity_list(l_habits, r_habits, merged_tombstones)
            }
        merged["widgets"] = merged_widgets

    merged_bg = _pick_newer_block(local.get("background"), remote.get("background"))
    if merged_bg is not None:
        l_imgs = (local.get("background") or {}).get("customImages") or []
        r_imgs = (remote.get("background") or {}).get("customImages") or []
        merged_bg["customImages"] = _merge_entity_list(l_imgs, r_imgs, merged_tombstones)
        merged["background"] = merged_bg

    return merged


def _extract_links_and_clean_text(
    text: str,
    *,
    vault_name: str = "",
    vault_prefix: str = "",
) -> tuple[str, str | None, list[dict[str, str]]]:
    """Extract all safe Markdown/Obsidian/bare links as sources[] and return cleaned text + primary URL."""
    found_sources: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    def add_src(url_val: str | None, label_val: str) -> None:
        if not url_val or url_val in seen_urls:
            return
        seen_urls.add(url_val)
        clean_lbl = label_val.strip().rstrip("↗").strip() or extract_domain(url_val) or "Source"
        found_sources.append({"label": clean_lbl, "url": url_val, "kind": "reference"})

    # 1. Convert Obsidian wikilinks [[../Inbox/Topic|Full Breakdown]] -> obsidian://open?...
    wikilink_re = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
    clean_vault = vault_name.strip()
    clean_prefix = vault_prefix.strip().strip("/")

    def replace_wikilink(match: re.Match[str]) -> str:
        raw_target = match.group(1).strip().lstrip("./")
        while raw_target.startswith("../"):
            raw_target = raw_target[3:]
        label = (match.group(2) or raw_target.split("/")[-1]).strip()
        if raw_target.lower() in {"home", "../home"} or "previous" in label.lower():
            return ""
        if clean_prefix and not raw_target.startswith(f"{clean_prefix}/"):
            vault_rel = f"{clean_prefix}/{raw_target}"
        else:
            vault_rel = raw_target
        encoded_file = urllib.parse.quote(vault_rel)
        if clean_vault:
            obs_url = f"obsidian://open?vault={urllib.parse.quote(clean_vault)}&file={encoded_file}"
        else:
            obs_url = f"obsidian://open?file={encoded_file}"
        add_src(obs_url, f"Obsidian: {label}")
        return ""

    working = wikilink_re.sub(replace_wikilink, text)

    # 2. Extract standard Markdown links [Label](https://...)
    def replace_md_link(match: re.Match[str]) -> str:
        label = match.group(1).strip()
        raw_target = match.group(2).strip()
        if raw_target.startswith("file:///"):
            # Local scratch detail markdown fallback -> keep readable label only
            return ""
        candidate = sanitize_url(raw_target, allow_obsidian=True)
        if candidate:
            add_src(candidate, label)
            if label.lower().rstrip(" ↗") in {"slack", "source", "link", "thread", "mr", "obsidian", "open", "full breakdown"}:
                return ""
        return label

    working = MD_LINK_RE.sub(replace_md_link, working)

    # 3. Extract bare URLs
    def replace_bare_url(match: re.Match[str]) -> str:
        candidate = sanitize_url(match.group(0), allow_obsidian=True)
        if candidate:
            add_src(candidate, extract_domain(candidate) or "Source")
        return ""

    working = BARE_URL_RE.sub(replace_bare_url, working)
    working = re.sub(r"\(\s*\)|\[\s*\]", "", working)
    working = re.sub(r"(?:\s*·\s*)+$", "", working)
    working = re.sub(r"\s{2,}", " ", working).strip(" —-·:\t")

    # Prefer Slack permalink as primary URL if present, otherwise first extracted URL
    primary_url: str | None = None
    for src in found_sources:
        if "slack.com/" in src["url"]:
            primary_url = src["url"]
            src["kind"] = "primary"
            break
    if primary_url is None and found_sources:
        primary_url = found_sources[0]["url"]
        found_sources[0]["kind"] = "primary"

    return working, primary_url, found_sources


def _extract_first_valid_url_and_clean_text(text: str) -> tuple[str, str | None]:
    """Extract first safe http/https/obsidian URL from markdown links or bare URLs."""
    cleaned, primary_url, _ = _extract_links_and_clean_text(text)
    return cleaned, primary_url


def _split_headline_and_summary(text: str) -> tuple[str, str]:
    """Split digest bullet body into concise headline and summary."""
    # Antigravity daily-slack-digest pattern: **Bold Title** (`#channel` ...): Summary
    bold_lead = re.match(r"^(?:[🔴🟡🟢]\s*)?\*\*([^*]+)\*\*\s*(.*)$", text)
    if bold_lead:
        head = bold_lead.group(1).strip()
        tail = bold_lead.group(2).strip().lstrip(":—–- ").strip()
        if head:
            return head, tail

    for sep in (" — ", " – ", " - ", ": "):
        if sep in text:
            head, tail = text.split(sep, 1)
            head = head.strip().strip("*")
            tail = tail.strip()
            if head and tail:
                return head, tail
    return text.strip().strip("*"), ""


def parse_slack_digest_markdown(
    md_text: str,
    fallback_date: str | None = None,
    *,
    vault_name: str = "",
    vault_prefix: str = "",
) -> dict[str, Any]:
    """Parse Obsidian callout & channel-grouped Daily Digest Markdown into SlackDigest payload.

    Supports BOTH:
    1. Callout & priority section digests:
       `> [!todo]+`, `> [!danger]+ P0`, `> [!warning]+ P1`, `> [!info]- P2`, `## P0`, `## P1`, `## P2`
       with backticked `(#channel)` / `(DM:Name)` / `(GroupDM:...)` locators, permalinks,
       and `[[../Inbox/...|Full Breakdown]]` Obsidian wikilinks (skipping `- [x]` archived items).
    2. Classic channel headings (`## #frontend`) and inline prefixes (`**#frontend**` / `[#frontend]`).
    """
    digest_date = validate_date_str(fallback_date)
    delivered_at = DEFAULT_DELIVERED_AT
    lines = md_text.splitlines()

    callout_header_re = re.compile(r"^\[!(todo|danger|warning|info)\][+-]?\s*(.*)$", re.IGNORECASE)
    priority_heading_re = re.compile(r"^#{2,4}\s+(TODO List|P0|P1|P2)\b(.*)$", re.IGNORECASE)
    backtick_channel_re = re.compile(r"`(#[a-zA-Z0-9][a-zA-Z0-9_-]*|(?:Group)?DM:[^`]+)`")

    in_frontmatter = False
    for idx, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if idx == 0 and stripped == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if stripped == "---":
                in_frontmatter = False
                continue
            date_m = re.match(r"^date:\s*['\"]?(\d{4}-\d{2}-\d{2})['\"]?", stripped)
            if date_m:
                digest_date = date_m.group(1)
            deliv_m = re.match(r"^delivered_at:\s*['\"]?([^'\"]+)['\"]?", stripped)
            if deliv_m:
                delivered_at = deliv_m.group(1).strip()
            continue

        if stripped.startswith("# "):
            h_date = re.search(r"(\d{4}-\d{2}-\d{2})", stripped)
            if h_date:
                digest_date = h_date.group(1)
        time_m = re.search(r"\b(\d{1,2}:\d{2}\s*(?:UTC|GMT|PST|EST|CET|ICT|SGT|JST))\b", stripped)
        if time_m and idx < 12:
            delivered_at = time_m.group(1).strip()

    items: list[dict[str, Any]] = []
    action_todos: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    current_channel: str | None = None
    current_section_badge: str | None = None
    in_todo_section = False
    in_frontmatter = False

    for idx, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if idx == 0 and stripped == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if stripped == "---":
                in_frontmatter = False
            continue

        # Unwrap Obsidian blockquote prefix (`> `)
        is_blockquote = stripped.startswith(">")
        unquoted = re.sub(r"^(?:>\s*)+", "", stripped).strip() if is_blockquote else stripped
        if not unquoted or unquoted == "---":
            continue

        callout_m = callout_header_re.match(unquoted)
        if callout_m:
            kind = callout_m.group(1).lower()
            title_rest = callout_m.group(2)
            in_todo_section = kind == "todo"
            if kind == "todo":
                current_section_badge = "Action Needed"
            elif kind == "danger" or "p0" in title_rest.lower():
                current_section_badge = "P0 Urgent"
            elif kind == "warning" or "p1" in title_rest.lower():
                current_section_badge = "P1 Priority & Decisions"
            else:
                current_section_badge = "P2 FYI"
            current_channel = None
            continue

        prio_m = priority_heading_re.match(unquoted)
        if prio_m:
            sec = prio_m.group(1).upper()
            in_todo_section = sec.startswith("TODO")
            if in_todo_section:
                current_section_badge = "Action Needed"
            elif sec == "P0":
                current_section_badge = "P0 Urgent"
            elif sec == "P1":
                current_section_badge = "P1 Priority & Decisions"
            else:
                current_section_badge = "P2 FYI"
            current_channel = None
            continue

        heading_match = CHANNEL_HEADING_RE.match(unquoted)
        if heading_match:
            current_channel = heading_match.group(1).lower()
            in_todo_section = False
            continue

        if unquoted.startswith("#"):
            if not re.search(r"#[a-zA-Z0-9][a-zA-Z0-9_-]*", unquoted):
                current_channel = None
            continue

        # Handle indented continuation line (non-bullet) for previous item
        if not is_blockquote and raw_line.startswith(("  ", "\t")) and not BULLET_RE.match(unquoted) and items:
            cont_text, cont_url, cont_sources = _extract_links_and_clean_text(
                unquoted,
                vault_name=vault_name,
                vault_prefix=vault_prefix,
            )
            prev = items[-1]
            if cont_url and not prev["url"]:
                prev["url"] = cont_url
            if cont_sources:
                existing_urls = {s["url"] for s in prev.get("sources", [])}
                for cs in cont_sources:
                    if cs["url"] not in existing_urls:
                        prev.setdefault("sources", []).append(cs)
            if cont_text:
                prev["summary"] = f"{prev['summary']} {cont_text}".strip() if prev["summary"] else cont_text
            continue

        bullet_match = BULLET_RE.match(unquoted)
        if not bullet_match:
            continue

        body = bullet_match.group(1).strip()

        # Check interactive Obsidian checkbox (`[ ]` vs `[x]`)
        checkbox_m = re.match(r"^\[([ xX])\]\s+(.+)$", body)
        if checkbox_m:
            if checkbox_m.group(1).lower() == "x":
                # Already acknowledged/archived in Obsidian!
                continue
            body = checkbox_m.group(2).strip()

        # Skip pure group-header bullets that have sub-bullets and end with `:` with no description
        if body.endswith(":") and "http" not in body and "[[" not in body:
            ch_in_group = backtick_channel_re.search(body)
            if ch_in_group and ch_in_group.group(1).startswith("#"):
                current_channel = ch_in_group.group(1).lower()
            continue

        channel = current_channel

        inline_ch = INLINE_CHANNEL_RE.match(body)
        if inline_ch:
            channel = (inline_ch.group(1) or inline_ch.group(2)).lower()
            body = body[inline_ch.end() :].strip()

        if not channel:
            bt_ch = backtick_channel_re.search(body)
            if bt_ch:
                raw_loc = bt_ch.group(1).strip()
                if raw_loc.startswith("#"):
                    channel = raw_loc.lower()
                elif raw_loc.lower().startswith("groupdm:"):
                    channel = "#group-dm"
                elif raw_loc.lower().startswith("dm:"):
                    dm_person = raw_loc.split(":", 1)[1].strip().split()[0].lower()
                    channel = f"#dm-{dm_person}" if dm_person else "#direct-message"

        if not channel and (current_section_badge or in_todo_section):
            channel = "#general"

        if not channel:
            continue

        badge: str | None = current_section_badge
        badge_match = BADGE_RE.match(body)
        if badge_match:
            badge = badge_match.group(1).strip()
            body = body[badge_match.end() :].strip()
        elif "**Decision**:" in body or "**Decision**" in body:
            badge = "Decision"

        cleaned_body, item_url, item_sources = _extract_links_and_clean_text(
            body,
            vault_name=vault_name,
            vault_prefix=vault_prefix,
        )
        if not cleaned_body:
            continue

        headline, summary = _split_headline_and_summary(cleaned_body)
        if not headline:
            continue

        item_id = deterministic_id("slack", digest_date, channel, headline)
        ts = f"{digest_date}T09:00:00.000Z"

        if in_todo_section:
            action_todos.append(
                {
                    "id": deterministic_id("todo_slack", digest_date, headline),
                    "text": f"{headline}: {summary}" if summary else headline,
                    "completed": False,
                    "tags": [channel.lstrip("#"), "slack-digest"],
                    "sourceUrl": item_url,
                    "sourceLabel": channel,
                    "context": summary or headline,
                    "keyPoints": [],
                    "sources": item_sources,
                    "createdAt": ts,
                    "completedAt": None,
                    "updatedAt": ts,
                }
            )
            # Do not duplicate [!todo]+ items if they also appear in P0/P1 below, unless unique
            continue

        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)

        items.append(
            {
                "id": item_id,
                "channel": channel,
                "badge": badge,
                "headline": headline,
                "summary": summary,
                "context": summary,
                "keyPoints": [],
                "url": item_url,
                "sources": item_sources,
                "createdAt": ts,
                "updatedAt": ts,
            }
        )

    return {
        "date": digest_date,
        "deliveredAt": delivered_at,
        "items": items,
        "actionTodos": action_todos,
    }


def find_latest_digest_file(digests_dir: Path) -> Path | None:
    """Find the most recent YYYY-MM-DD*.md digest file in digests_dir."""
    if not digests_dir.is_dir():
        return None
    candidates: list[tuple[str, str, Path]] = []
    for entry in digests_dir.iterdir():
        if not entry.is_file() or entry.suffix.lower() != ".md":
            continue
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", entry.name)
        if match:
            candidates.append((match.group(1), entry.name, entry))
    if not candidates:
        return None
    candidates.sort(key=lambda tup: (tup[0], tup[1]), reverse=True)
    return candidates[0][2]


def _normalize_todo_topic(text: str) -> str:
    """Normalize a TODO headline/text by stripping priority emojis, markdown, and `(cont.)` suffixes."""
    head = text.split(":", 1)[0] if ":" in text else text
    head = re.sub(r"^[🔴🟡🟢\s*]+", "", head).strip().strip("*")
    head = re.sub(r"\s*\(cont\.?\)\s*$", "", head, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", head).strip().lower()


def merge_slack_digest_into_state(state: dict[str, Any], parsed_digest: dict[str, Any]) -> dict[str, Any]:
    """Merge parsed Slack Digest items into state while honoring tombstones."""
    next_state = normalize_state(state)
    tombstones = next_state["tombstones"]
    digest_date = validate_date_str(parsed_digest.get("date"), next_state["activeDate"])
    current_date = next_state["slackDigest"]["date"]

    valid_new_items: list[dict[str, Any]] = []
    for item in parsed_digest.get("items", []):
        if not isinstance(item, dict) or not item.get("id"):
            continue
        item_id = str(item["id"])
        if item_id in tombstones:
            # Never resurrect tombstoned digest items
            continue
        valid_new_items.append(dict(item))

    if digest_date > current_date or not next_state["slackDigest"]["items"]:
        next_state["slackDigest"] = {
            "date": digest_date,
            "deliveredAt": parsed_digest.get("deliveredAt") or DEFAULT_DELIVERED_AT,
            "items": valid_new_items,
        }
        next_state["updatedAt"] = utc_now_iso()
    elif digest_date == current_date:
        existing_items = list(next_state["slackDigest"]["items"])
        existing_ids = {str(x.get("id")) for x in existing_items if x.get("id")}
        added = False
        for item in valid_new_items:
            if item["id"] not in existing_ids:
                existing_items.append(item)
                existing_ids.add(item["id"])
                added = True
        if added:
            next_state["slackDigest"]["items"] = existing_items
            next_state["slackDigest"]["deliveredAt"] = (
                parsed_digest.get("deliveredAt") or next_state["slackDigest"]["deliveredAt"]
            )
            next_state["updatedAt"] = utc_now_iso()

    # Merge unchecked [!todo]+ action items from Antigravity Daily Slack Digest,
    # unifying repeat/(cont.) TODOs across days by normalized topic or sourceUrl.
    existing_todo_ids = {str(t.get("id")) for t in next_state["todos"] if t.get("id")}
    slack_todo_by_topic: dict[str, dict[str, Any]] = {}
    slack_todo_by_url: dict[str, dict[str, Any]] = {}
    for t in next_state["todos"]:
        if not str(t.get("id") or "").startswith("todo_slack_"):
            continue
        topic = _normalize_todo_topic(str(t.get("text") or ""))
        if topic:
            slack_todo_by_topic[topic] = t
        if t.get("sourceUrl"):
            slack_todo_by_url[str(t["sourceUrl"])] = t

    for action_todo in parsed_digest.get("actionTodos", []):
        if not isinstance(action_todo, dict) or not action_todo.get("id"):
            continue
        tid = str(action_todo["id"])
        if tid in tombstones or tid in existing_todo_ids:
            continue

        topic = _normalize_todo_topic(str(action_todo.get("text") or ""))
        src_url = str(action_todo.get("sourceUrl") or "")
        existing_match = slack_todo_by_topic.get(topic) or (slack_todo_by_url.get(src_url) if src_url else None)
        if existing_match is not None:
            if not existing_match.get("completed"):
                for field in ("text", "tags", "sourceUrl", "sourceLabel", "context", "sources", "updatedAt"):
                    if field in action_todo:
                        existing_match[field] = action_todo[field]
                next_state["updatedAt"] = utc_now_iso()
            continue

        new_todo = dict(action_todo)
        next_state["todos"].append(new_todo)
        existing_todo_ids.add(tid)
        if topic:
            slack_todo_by_topic[topic] = new_todo
        if src_url:
            slack_todo_by_url[src_url] = new_todo
        next_state["updatedAt"] = utc_now_iso()

    return next_state


def _clean_markdown_task_text(raw_text: str) -> tuple[str, list[str], str | None, str | None]:
    """Extract clean text, #tags, and optional first safe URL + label from a Markdown task line."""
    url_label: str | None = None
    found_url: str | None = None

    def replace_link(match: re.Match[str]) -> str:
        nonlocal found_url, url_label
        label = match.group(1).strip()
        candidate = sanitize_url(match.group(2), allow_obsidian=True)
        if candidate and found_url is None:
            found_url = candidate
            url_label = label
            return ""
        return label

    without_links = MD_LINK_RE.sub(replace_link, raw_text)
    without_bare, bare_url = _extract_first_valid_url_and_clean_text(without_links)
    if found_url is None and bare_url is not None:
        found_url = bare_url
        url_label = extract_domain(bare_url) or None

    tags = normalize_tags(TAG_RE.findall(without_bare))
    clean_text = TAG_RE.sub("", without_bare)
    clean_text = re.sub(r"\(\s*\)", "", clean_text)
    clean_text = re.sub(r"\s{2,}", " ", clean_text).strip(" —-:\t")
    return clean_text, tags, found_url, url_label


def merge_daily_markdown_into_state(
    state: dict[str, Any],
    daily_md_path: Path,
) -> tuple[dict[str, Any], bool]:
    """Merge checkbox toggles/additions from Obsidian Daily note if newer than state.updatedAt."""
    if not daily_md_path.is_file():
        return state, False

    state_ts = parse_iso_timestamp(state.get("updatedAt"))
    md_mtime = daily_md_path.stat().st_mtime
    if state_ts is not None and md_mtime <= state_ts:
        return state, False

    md_text = daily_md_path.read_text(encoding="utf-8")
    md_ts_iso = datetime.fromtimestamp(md_mtime, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    next_state = normalize_state(state)
    tombstones = next_state["tombstones"]
    active_date = next_state["activeDate"]

    section = ""
    changed = False

    obj_by_title = {
        str(o.get("title", "")).strip().lower(): o
        for o in next_state["objectives"]
        if isinstance(o, dict) and o.get("title")
    }
    todo_by_text = {
        str(t.get("text", "")).strip().lower(): t
        for t in next_state["todos"]
        if isinstance(t, dict) and t.get("text")
    }

    for line in md_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            lower = stripped.lower()
            if "objective" in lower or "big 3" in lower:
                section = "objectives"
            elif "todo" in lower or "tactical" in lower:
                section = "todos"
            else:
                section = "other"
            continue

        if section not in {"objectives", "todos"}:
            continue

        cb = CHECKBOX_RE.match(line)
        if not cb:
            continue

        is_done = cb.group(1).lower() == "x"
        clean_text, tags, url, url_label = _clean_markdown_task_text(cb.group(2))
        if not clean_text:
            continue

        key = clean_text.lower()
        if section == "objectives":
            existing = obj_by_title.get(key)
            if existing is not None:
                if bool(existing.get("completed")) != is_done:
                    existing["completed"] = is_done
                    existing["updatedAt"] = md_ts_iso
                    changed = True
            else:
                new_id = deterministic_id("obj_md", active_date, clean_text)
                if new_id not in tombstones:
                    item = {
                        "id": new_id,
                        "title": clean_text,
                        "url": url,
                        "urlLabel": url_label,
                        "completed": is_done,
                        "createdAt": md_ts_iso,
                        "updatedAt": md_ts_iso,
                    }
                    next_state["objectives"].append(item)
                    obj_by_title[key] = item
                    changed = True
        elif section == "todos":
            existing = todo_by_text.get(key)
            if existing is not None:
                if bool(existing.get("completed")) != is_done:
                    existing["completed"] = is_done
                    existing["completedAt"] = md_ts_iso if is_done else None
                    existing["updatedAt"] = md_ts_iso
                    changed = True
            else:
                new_id = deterministic_id("todo_md", active_date, clean_text)
                if new_id not in tombstones:
                    item = {
                        "id": new_id,
                        "text": clean_text,
                        "completed": is_done,
                        "tags": tags,
                        "sourceUrl": url,
                        "sourceLabel": url_label,
                        "createdAt": md_ts_iso,
                        "completedAt": md_ts_iso if is_done else None,
                        "updatedAt": md_ts_iso,
                    }
                    next_state["todos"].append(item)
                    todo_by_text[key] = item
                    changed = True

    if changed:
        next_state["updatedAt"] = max_iso_timestamp(next_state["updatedAt"], md_ts_iso, md_ts_iso)
    return next_state, changed


def render_daily_markdown(state: dict[str, Any]) -> str:
    """Render clean Obsidian Daily/YYYY-MM-DD.md note from GatewayState."""
    active_date = validate_date_str(state.get("activeDate"))
    focus_theme = str(state.get("focusTheme") or "Clarity over volume.").replace('"', '\\"')
    breaks_taken = int(state.get("wellness", {}).get("breaksToday") or 0)

    lines = [
        "---",
        f"date: {active_date}",
        f'focus_theme: "{focus_theme}"',
        f"breaks_taken: {breaks_taken}",
        "---",
        "",
        f"# Calm Morning Gateway — {active_date}",
        "",
        "## 🎯 Today's Objectives (Big 3)",
    ]

    objectives = state.get("objectives", [])
    if not objectives:
        lines.append("- [ ] Define today's primary outcome")
    else:
        for obj in objectives:
            mark = "x" if obj.get("completed") else " "
            title = str(obj.get("title") or "").strip()
            safe_url = sanitize_url(obj.get("url"), allow_obsidian=True)
            if safe_url:
                label = str(obj.get("urlLabel") or extract_domain(safe_url) or "Link").strip()
                lines.append(f"- [{mark}] {title} ([{label}]({safe_url}))")
            else:
                lines.append(f"- [{mark}] {title}")

    lines.extend(["", "## ✅ Tactical TODOs"])
    todos = state.get("todos", [])
    if not todos:
        lines.append("- _No tactical TODOs yet._")
    else:
        for todo in todos:
            mark = "x" if todo.get("completed") else " "
            text = str(todo.get("text") or "").strip()
            tags = " ".join(f"#{t}" for t in normalize_tags(todo.get("tags")))
            safe_url = sanitize_url(todo.get("sourceUrl"), allow_obsidian=True)
            suffix_parts: list[str] = []
            if tags:
                suffix_parts.append(tags)
            if safe_url:
                label = str(todo.get("sourceLabel") or extract_domain(safe_url) or "Link").strip()
                suffix_parts.append(f"[{label}]({safe_url})")
            suffix = f" {' '.join(suffix_parts)}" if suffix_parts else ""
            lines.append(f"- [{mark}] {text}{suffix}")

    digest = state.get("slackDigest", {})
    digest_date = validate_date_str(digest.get("date"), active_date)
    delivered_at = str(digest.get("deliveredAt") or DEFAULT_DELIVERED_AT)
    lines.extend(["", f"## 💬 Daily Digest Summary ({digest_date} · {delivered_at})"])

    digest_items = digest.get("items", [])
    if not digest_items:
        lines.append("- _No Slack digest updates._")
    else:
        for item in digest_items:
            channel = str(item.get("channel") or "#general").strip()
            if not channel.startswith("#"):
                channel = f"#{channel}"
            badge = f"[{item['badge']}] " if item.get("badge") else ""
            headline = str(item.get("headline") or "").strip()
            summary = str(item.get("summary") or "").strip()
            safe_url = sanitize_url(item.get("url"), allow_obsidian=True)
            summary_part = f" — {summary}" if summary else ""
            link_part = f" ([Slack]({safe_url}))" if safe_url else ""
            lines.append(f"- **{channel}** {badge}{headline}{summary_part}{link_part}")

    lines.append("")
    return "\n".join(lines)


def render_bookmarks_markdown(state: dict[str, Any]) -> str:
    """Render clean Obsidian Reading/Bookmarks.md grouped into Inbox and Archived."""
    bookmarks = [b for b in state.get("bookmarks", []) if isinstance(b, dict)]
    inbox = [b for b in bookmarks if b.get("status", "inbox") != "archived"]
    archived = [b for b in bookmarks if b.get("status") == "archived"]

    # Sort pinned first, then most recently added
    inbox.sort(key=lambda b: (not bool(b.get("pinned")), b.get("addedAt") or ""), reverse=False)
    archived.sort(key=lambda b: b.get("updatedAt") or b.get("addedAt") or "", reverse=True)

    def format_bookmark(bm: dict[str, Any]) -> str:
        safe_url = sanitize_url(bm.get("url"), allow_obsidian=True)
        title = str(bm.get("title") or bm.get("domain") or "Saved Link").strip()
        domain = str(bm.get("domain") or (extract_domain(safe_url) if safe_url else "")).strip()
        mins = int(bm.get("estReadMins") or 5)
        tags = " ".join(f"#{t}" for t in normalize_tags(bm.get("tags")))
        star = "★ " if bm.get("pinned") else ""
        link_str = f"[{title}]({safe_url})" if safe_url else title
        meta_parts = [p for p in [domain, f"{mins}m read", tags] if p]
        meta_str = f" — {' · '.join(meta_parts)}" if meta_parts else ""
        return f"- {star}{link_str}{meta_str}"

    lines = [
        "# Calm Gateway — Reading Queue & Bookmarks",
        "",
        "## 📥 Reading Queue (Inbox)",
    ]
    if not inbox:
        lines.append("- _Reading queue is clear._")
    else:
        lines.extend(format_bookmark(b) for b in inbox)

    lines.extend(["", "## 📚 Archived / Read"])
    if not archived:
        lines.append("- _No archived links yet._")
    else:
        lines.extend(format_bookmark(b) for b in archived)

    lines.append("")
    return "\n".join(lines)


def atomic_write_text(target: Path, content: str) -> None:
    """Atomically write UTF-8 text to target using NamedTemporaryFile + os.replace."""
    resolved_target = target.expanduser().resolve()
    resolved_target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(resolved_target.parent),
            prefix=".tmp_",
            suffix=".tmp",
            delete=False,
        ) as handle:
            tmp_path = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, str(resolved_target))
    except BaseException:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def _github_gist_request(
    method: str,
    gist_id: str,
    github_pat: str,
    payload: dict[str, Any] | None = None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """Perform a strictly validated HTTPS request against api.github.com/gists/{gist_id}."""
    clean_gist_id = validate_gist_id(gist_id)
    clean_pat = github_pat.strip()
    if not clean_pat or any(ch in clean_pat for ch in "\r\n"):
        raise ValueError("Valid GitHub PAT is required for Gist sync.")

    url = f"https://{GITHUB_API_HOST}/gists/{clean_gist_id}"
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != GITHUB_API_HOST
        or not parsed.path.startswith("/gists/")
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("Refused non-GitHub Gist HTTPS URL.")

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {clean_pat}",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "calm-gateway-obsidian-bridge/1.0",
    }
    body_bytes: bytes | None = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
    with opener(request, timeout=15) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def pull_gist_state(
    gist_id: str,
    github_pat: str,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any] | None:
    """Pull remote gateway-state.json from Private GitHub Gist."""
    data = _github_gist_request("GET", gist_id, github_pat, opener=opener)
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, dict):
        return None
    file_entry = files.get(GIST_FILENAME)
    if not isinstance(file_entry, dict) or not isinstance(file_entry.get("content"), str):
        return None
    parsed = json.loads(file_entry["content"])
    return normalize_state(parsed) if isinstance(parsed, dict) else None


def push_gist_state(
    gist_id: str,
    github_pat: str,
    state: dict[str, Any],
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> None:
    """Push sanitized gateway-state.json (without githubPat) to Private GitHub Gist."""
    clean_json = export_clean_state_json(state)
    payload = {
        "files": {
            GIST_FILENAME: {
                "content": clean_json,
            }
        }
    }
    _github_gist_request("PATCH", gist_id, github_pat, payload=payload, opener=opener)


def safe_vault_target(vault_dir: Path, relative_parts: tuple[str, ...]) -> Path:
    """Resolve an Obsidian vault output path and assert containment within vault_dir."""
    resolved_vault = vault_dir.expanduser().resolve()
    candidate = resolved_vault.joinpath(*relative_parts).resolve()
    if not candidate.is_relative_to(resolved_vault):
        raise ValueError(f"Refused path escaping vault root: {candidate}")
    return candidate


def build_starter_config_template() -> dict[str, Any]:
    """Return a neutral starter ~/.calm-gateway/config.json template."""
    return {
        "userName": "",
        "stateFile": DEFAULT_STATE_FILE,
        "digestsDir": "",
        "vaultDir": "",
        "vaultName": "",
        "vaultPrefix": "",
        "bundleOut": "",
        "gistId": "",
        "githubPatEnv": DEFAULT_GITHUB_PAT_ENV,
    }


def load_bridge_config(config_path: Path | None = None, *, strict: bool = False) -> dict[str, Any]:
    """Load optional JSON configuration from ~/.calm-gateway/config.json or explicit path."""
    target = (config_path or Path(DEFAULT_CONFIG_PATH)).expanduser().resolve()
    if not target.is_file():
        if strict:
            raise FileNotFoundError(f"Bridge config file not found: {target}")
        return {}
    raw = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Bridge config must be a JSON object: {target}")
    return raw


def init_config_file(config_path: Path, *, force: bool = False) -> Path:
    """Write a starter JSON config file safely with 0600 permissions."""
    resolved = config_path.expanduser().resolve()
    if resolved.exists() and not force:
        raise FileExistsError(f"Config file already exists: {resolved} (pass --force to overwrite)")
    content = json.dumps(build_starter_config_template(), indent=2, ensure_ascii=False) + "\n"
    atomic_write_text(resolved, content)
    os.chmod(resolved, 0o600)
    return resolved


def run_sync(
    *,
    state_file: Path,
    digests_dir: Path | None = None,
    vault_dir: Path | None = None,
    bundle_out: Path | None = None,
    gist_id: str | None = None,
    github_pat: str | None = None,
    user_name: str | None = None,
    vault_name: str = "",
    vault_prefix: str = "",
    dry_run: bool = False,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    """Execute one end-to-end Digest -> State -> Gist -> Obsidian sync cycle."""
    resolved_state_file = state_file.expanduser().resolve()
    if resolved_state_file.is_file():
        raw = json.loads(resolved_state_file.read_text(encoding="utf-8"))
        state = normalize_state(raw)
    else:
        state = create_default_state(user_name=user_name or "")

    if isinstance(user_name, str) and user_name.strip() and not state.get("userName"):
        state["userName"] = user_name.strip()

    clean_gist_id = ""
    if gist_id and gist_id.strip():
        clean_gist_id = validate_gist_id(gist_id)
        state["sync"]["gistId"] = clean_gist_id
    elif state["sync"].get("gistId"):
        clean_gist_id = validate_gist_id(state["sync"]["gistId"])

    latest_digest_path: Path | None = None
    parsed_digest_count = 0
    if digests_dir is not None:
        resolved_digests = digests_dir.expanduser().resolve()
        latest_digest_path = find_latest_digest_file(resolved_digests)
        if latest_digest_path is not None:
            digest_text = latest_digest_path.read_text(encoding="utf-8")
            name_date_m = re.match(r"^(\d{4}-\d{2}-\d{2})", latest_digest_path.name)
            fallback = name_date_m.group(1) if name_date_m else state["activeDate"]
            parsed_digest = parse_slack_digest_markdown(
                digest_text,
                fallback_date=fallback,
                vault_name=vault_name,
                vault_prefix=vault_prefix,
            )
            parsed_digest_count = len(parsed_digest["items"])
            state = merge_slack_digest_into_state(state, parsed_digest)

    daily_path: Path | None = None
    bookmarks_path: Path | None = None
    daily_md_merged = False
    if vault_dir is not None:
        active_date = validate_date_str(state.get("activeDate"))
        daily_path = safe_vault_target(vault_dir, ("Daily", f"{active_date}.md"))
        bookmarks_path = safe_vault_target(vault_dir, ("Reading", "Bookmarks.md"))
        state, daily_md_merged = merge_daily_markdown_into_state(state, daily_path)

    gist_synced = False
    if not dry_run and clean_gist_id and github_pat and github_pat.strip():
        remote_state = pull_gist_state(clean_gist_id, github_pat, opener=opener)
        if remote_state is not None:
            state = merge_states(state, remote_state)
        now_iso = utc_now_iso()
        state["sync"]["gistId"] = clean_gist_id
        state["sync"]["githubPat"] = ""
        state["sync"]["lastSyncedAt"] = now_iso
        state["sync"]["lastSyncStatus"] = "synced"
        state["sync"]["lastSyncError"] = None
        push_gist_state(clean_gist_id, github_pat, state, opener=opener)
        gist_synced = True

    resolved_bundle = bundle_out.expanduser().resolve() if bundle_out is not None else None
    if not dry_run:
        clean_json = export_clean_state_json(state) + "\n"
        atomic_write_text(resolved_state_file, clean_json)
        if resolved_bundle is not None:
            atomic_write_text(resolved_bundle, clean_json)
        if daily_path is not None:
            atomic_write_text(daily_path, render_daily_markdown(state))
        if bookmarks_path is not None:
            atomic_write_text(bookmarks_path, render_bookmarks_markdown(state))

    return {
        "dryRun": dry_run,
        "stateFile": str(resolved_state_file),
        "bundleOut": str(resolved_bundle) if resolved_bundle else None,
        "activeDate": state["activeDate"],
        "digestFile": str(latest_digest_path) if latest_digest_path else None,
        "parsedDigestItems": parsed_digest_count,
        "slackDigestItemsInState": len(state["slackDigest"]["items"]),
        "objectivesCount": len(state["objectives"]),
        "todosCount": len(state["todos"]),
        "bookmarksCount": len(state["bookmarks"]),
        "dailyMarkdownMerged": daily_md_merged,
        "dailyNoteExport": str(daily_path) if daily_path else None,
        "bookmarksExport": str(bookmarks_path) if bookmarks_path else None,
        "gistSynced": gist_synced,
    }


def resolve_runtime_options(
    args: argparse.Namespace,
    env: Mapping[str, str] = os.environ,
) -> dict[str, Any]:
    """Resolve bridge options with precedence: CLI flags > Env vars > Config file > Neutral defaults."""
    explicit_cfg = args.config or env.get("CALM_GATEWAY_CONFIG")
    cfg_path = Path(explicit_cfg) if explicit_cfg else Path(DEFAULT_CONFIG_PATH)
    cfg = load_bridge_config(cfg_path, strict=bool(explicit_cfg))

    def pick_str(cli_val: str | None, env_key: str, cfg_key: str, default: str = "") -> str:
        if cli_val is not None:
            return cli_val.strip()
        if env_key in env:
            return env[env_key].strip()
        raw_cfg = cfg.get(cfg_key)
        if isinstance(raw_cfg, str):
            return raw_cfg.strip()
        return default

    state_file_str = pick_str(args.state_file, "CALM_GATEWAY_STATE_FILE", "stateFile", DEFAULT_STATE_FILE)
    if not state_file_str:
        state_file_str = DEFAULT_STATE_FILE

    digests_dir_str = pick_str(args.digests_dir, "CALM_GATEWAY_DIGESTS_DIR", "digestsDir", "")
    vault_dir_str = pick_str(args.vault_dir, "CALM_GATEWAY_VAULT_DIR", "vaultDir", "")
    vault_name = pick_str(args.vault_name, "CALM_GATEWAY_VAULT_NAME", "vaultName", "")
    vault_prefix = pick_str(args.vault_prefix, "CALM_GATEWAY_VAULT_PREFIX", "vaultPrefix", "")
    bundle_out_str = pick_str(args.bundle_out, "CALM_GATEWAY_BUNDLE_OUT", "bundleOut", "")
    gist_id_str = pick_str(args.gist_id, "CALM_GATEWAY_GIST_ID", "gistId", "")
    pat_env_name = pick_str(args.github_pat_env, "CALM_GATEWAY_GITHUB_PAT_ENV", "githubPatEnv", DEFAULT_GITHUB_PAT_ENV)
    if not pat_env_name:
        pat_env_name = DEFAULT_GITHUB_PAT_ENV
    user_name = pick_str(args.user_name, "CALM_GATEWAY_USER_NAME", "userName", "")

    return {
        "config_path": cfg_path,
        "user_name": user_name,
        "state_file": Path(state_file_str),
        "digests_dir": Path(digests_dir_str) if digests_dir_str else None,
        "vault_dir": Path(vault_dir_str) if vault_dir_str else None,
        "vault_name": vault_name,
        "vault_prefix": vault_prefix,
        "bundle_out": Path(bundle_out_str) if bundle_out_str else None,
        "gist_id": gist_id_str or None,
        "github_pat_env": pat_env_name,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    """Create CLI argument parser matching contracts.md §5."""
    parser = argparse.ArgumentParser(
        description="Sync Calm Morning Gateway state with Digest Markdown, Obsidian Vault, and Private GitHub Gist."
    )
    parser.add_argument(
        "--config",
        default=None,
        help=f"Path to JSON config file (default: {DEFAULT_CONFIG_PATH}, or CALM_GATEWAY_CONFIG env).",
    )
    parser.add_argument(
        "--init-config",
        action="store_true",
        help=f"Create a starter config template at --config / {DEFAULT_CONFIG_PATH} and exit.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow overwriting an existing config file when used with --init-config.",
    )
    parser.add_argument(
        "--user-name",
        default=None,
        help="Optional display name used only when initializing a new state file.",
    )
    parser.add_argument(
        "--state-file",
        default=None,
        help=f"Path to local GatewayState v1 JSON mirror (default: {DEFAULT_STATE_FILE}).",
    )
    parser.add_argument(
        "--digests-dir",
        default=None,
        help="Directory containing Daily Digest Markdown files (YYYY-MM-DD*.md).",
    )
    parser.add_argument(
        "--vault-dir",
        default=None,
        help="Obsidian vault root for Daily/YYYY-MM-DD.md and Reading/Bookmarks.md exports.",
    )
    parser.add_argument(
        "--vault-name",
        default=None,
        help="Optional Obsidian vault name used in obsidian:// wikilink URIs.",
    )
    parser.add_argument(
        "--vault-prefix",
        default=None,
        help="Optional relative subfolder prefix inside Obsidian vault for wikilinks.",
    )
    parser.add_argument(
        "--bundle-out",
        default=None,
        help="Optional local JSON bundle path for unpacked extension hydration (e.g. data/latest-sync.json).",
    )
    parser.add_argument(
        "--gist-id",
        default=None,
        help="Optional GitHub Gist ID (8-64 hex chars) for two-way sync.",
    )
    parser.add_argument(
        "--github-pat-env",
        default=None,
        help=f"Environment variable name storing GitHub PAT (default: {DEFAULT_GITHUB_PAT_ENV}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print summary JSON without writing files or making network calls.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.init_config:
        explicit_cfg = args.config or os.environ.get("CALM_GATEWAY_CONFIG")
        target_cfg = Path(explicit_cfg) if explicit_cfg else Path(DEFAULT_CONFIG_PATH)
        try:
            created = init_config_file(target_cfg, force=bool(args.force))
        except (OSError, FileExistsError, ValueError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
            return 1
        print(json.dumps({"ok": True, "configFile": str(created)}, indent=2))
        return 0

    pat_value = ""
    try:
        opts = resolve_runtime_options(args)
        pat_value = os.environ.get(opts["github_pat_env"], "")
        summary = run_sync(
            state_file=opts["state_file"],
            digests_dir=opts["digests_dir"],
            vault_dir=opts["vault_dir"],
            bundle_out=opts["bundle_out"],
            gist_id=opts["gist_id"],
            github_pat=pat_value,
            user_name=opts["user_name"],
            vault_name=opts["vault_name"],
            vault_prefix=opts["vault_prefix"],
            dry_run=bool(args.dry_run),
        )
    except (ValueError, OSError, FileNotFoundError, json.JSONDecodeError, urllib.error.URLError) as exc:
        err_msg = str(exc)
        if pat_value and pat_value in err_msg:
            err_msg = err_msg.replace(pat_value, "[REDACTED]")
        print(json.dumps({"ok": False, "error": err_msg}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps({"ok": True, **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
