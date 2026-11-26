#!/usr/bin/env python3
"""Unit tests for Custom Reading Dashboard Slack-to-Obsidian & Gist Bridge."""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

BRIDGE_DIR = Path(__file__).resolve().parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

import sync_gateway_obsidian as bridge  # noqa: E402


REALISTIC_TEAM_DIGEST = """---
date: 2026-11-18
delivered_at: 18:00 UTC
---

# Daily Team Digest — 2026-11-18 (18:00 UTC)

## #frontend
- [Decision] SSO auth proxy migration — Agreed to move internal admin sessions behind SSO proxy by Friday ([Slack](https://team.slack.com/archives/C01WEB/p1700001)).
- [Action Needed] Review CSP header rollout: Verify frame-ancestors policy on staging [MR !814](https://gitlab.example.com/web/gateway/-/merge_requests/814)

### #release-train
- [Release] v2.14 cut completed — Canary traffic shifted to 25% with zero elevated 5xx errors https://gitlab.example.com/platform/release/-/tags/v2.14.0

## #team-engineering
- **#team-engineering** [Incident] WAF 504 RCA published — Upstream keepalive timeout mismatch identified and patched ([Obsidian](obsidian://open?vault=Brain&file=RCA-WAF-504)).
- [Action Needed] Ignore unsafe link test — Verify link sanitizer rejects [bad](javascript:alert(1)).
"""


class _MockHttpResponse:
    """Minimal context-manager HTTP response mock for urllib opener tests."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_MockHttpResponse":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class TestSlackDigestParser(unittest.TestCase):
    """Tests for parse_slack_digest_markdown."""

    def test_parses_realistic_digest_with_badges_and_links(self) -> None:
        parsed = bridge.parse_slack_digest_markdown(REALISTIC_TEAM_DIGEST, fallback_date="2026-11-18")
        self.assertEqual(parsed["date"], "2026-11-18")
        self.assertEqual(parsed["deliveredAt"], "18:00 UTC")
        items = parsed["items"]
        self.assertEqual(len(items), 5)

        sso = items[0]
        self.assertEqual(sso["channel"], "#frontend")
        self.assertEqual(sso["badge"], "Decision")
        self.assertEqual(sso["headline"], "SSO auth proxy migration")
        self.assertIn("SSO proxy", sso["summary"])
        self.assertEqual(sso["url"], "https://team.slack.com/archives/C01WEB/p1700001")
        self.assertTrue(sso["id"].startswith("slack_"))

        csp = items[1]
        self.assertEqual(csp["channel"], "#frontend")
        self.assertEqual(csp["badge"], "Action Needed")
        self.assertEqual(
            csp["url"],
            "https://gitlab.example.com/web/gateway/-/merge_requests/814",
        )

        release = items[2]
        self.assertEqual(release["channel"], "#release-train")
        self.assertEqual(release["badge"], "Release")
        self.assertEqual(release["headline"], "v2.14 cut completed")
        self.assertEqual(
            release["url"],
            "https://gitlab.example.com/platform/release/-/tags/v2.14.0",
        )

        waf = items[3]
        self.assertEqual(waf["channel"], "#team-engineering")
        self.assertEqual(waf["badge"], "Incident")
        self.assertEqual(waf["headline"], "WAF 504 RCA published")
        self.assertEqual(waf["url"], "obsidian://open?vault=Brain&file=RCA-WAF-504")

        unsafe = items[4]
        self.assertIsNone(unsafe["url"])

    def test_supports_inline_channel_bullets_without_heading(self) -> None:
        md = "- [#frontend] [Decision] Lock Q4 budget — Finalized tooling allocation https://web.dev/blog"
        parsed = bridge.parse_slack_digest_markdown(md, fallback_date="2026-11-19")
        self.assertEqual(len(parsed["items"]), 1)
        self.assertEqual(parsed["items"][0]["channel"], "#frontend")
        self.assertEqual(parsed["items"][0]["badge"], "Decision")
        self.assertEqual(parsed["items"][0]["url"], "https://web.dev/blog")


class TestIdempotencyAndTombstones(unittest.TestCase):
    """Tests for deterministic IDs, idempotent re-sync, and tombstone enforcement."""

    def test_idempotent_resync_and_tombstone_preservation(self) -> None:
        parsed = bridge.parse_slack_digest_markdown(REALISTIC_TEAM_DIGEST, fallback_date="2026-11-18")
        state = bridge.create_default_state(active_date="2026-11-19")
        state["slackDigest"]["date"] = "2026-11-17"

        first = bridge.merge_slack_digest_into_state(state, parsed)
        self.assertEqual(len(first["slackDigest"]["items"]), 5)

        # User clicks [x] to delete the first Slack digest item
        deleted_item = first["slackDigest"]["items"][0]
        deleted_id = deleted_item["id"]
        first["slackDigest"]["items"] = first["slackDigest"]["items"][1:]
        first["tombstones"][deleted_id] = "2026-11-19T08:00:00.000Z"

        # Re-parsing and merging the exact same digest must NOT resurrect the deleted item
        second = bridge.merge_slack_digest_into_state(first, parsed)
        remaining_ids = [item["id"] for item in second["slackDigest"]["items"]]
        self.assertNotIn(deleted_id, remaining_ids)
        self.assertEqual(len(remaining_ids), 4)

        # Re-running again remains idempotent (still 4 items, no duplicates)
        third = bridge.merge_slack_digest_into_state(second, parsed)
        self.assertEqual(len(third["slackDigest"]["items"]), 4)


class TestTwoWayMergeAndGistSecurity(unittest.TestCase):
    """Tests for Daily Markdown merge, mocked Gist sync, and security invariants."""

    def test_invalid_gist_id_raises_value_error(self) -> None:
        for bad_id in ("", "short", "../etc/passwd", "https://evil.com/gist", "zzzz12345678"):
            with self.assertRaises(ValueError):
                bridge.validate_gist_id(bad_id)

    def test_two_way_merge_daily_md_and_mocked_gist(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            state_file = root / "gateway-state.json"
            vault_dir = root / "Vault"
            daily_file = vault_dir / "Daily" / "2026-11-19.md"
            daily_file.parent.mkdir(parents=True, exist_ok=True)

            local_state = bridge.create_default_state(active_date="2026-11-19")
            local_state["updatedAt"] = "2026-11-19T07:00:00.000Z"
            local_state["objectives"] = [
                {
                    "id": "obj_1",
                    "title": "Finalize Frontend Q4 Architecture RFC",
                    "url": "https://gitlab.example.com/rfc",
                    "urlLabel": "RFC",
                    "completed": False,
                    "createdAt": "2026-11-19T06:00:00.000Z",
                    "updatedAt": "2026-11-19T06:00:00.000Z",
                }
            ]
            local_state["todos"] = [
                {
                    "id": "todo_1",
                    "text": "Audit WAF keepalive timeouts",
                    "completed": False,
                    "tags": ["team-engineering"],
                    "sourceUrl": None,
                    "sourceLabel": None,
                    "createdAt": "2026-11-19T06:00:00.000Z",
                    "completedAt": None,
                    "updatedAt": "2026-11-19T06:00:00.000Z",
                },
                {
                    "id": "todo_deleted_remote",
                    "text": "Old stale task",
                    "completed": False,
                    "tags": [],
                    "sourceUrl": None,
                    "sourceLabel": None,
                    "createdAt": "2026-11-19T06:00:00.000Z",
                    "completedAt": None,
                    "updatedAt": "2026-11-19T06:00:00.000Z",
                },
            ]
            local_state["sync"]["githubPat"] = "ghp_secret_must_never_leak"
            state_file.write_text(bridge.export_clean_state_json(local_state), encoding="utf-8")

            # User edits Daily/2026-11-19.md in Obsidian later than state.updatedAt
            daily_file.write_text(
                "\n".join(
                    [
                        "---",
                        "date: 2026-11-19",
                        'focus_theme: "Clarity over volume."',
                        "breaks_taken: 1",
                        "---",
                        "",
                        "## 🎯 Today's Objectives (Big 3)",
                        "- [x] Finalize Frontend Q4 Architecture RFC ([RFC](https://gitlab.example.com/rfc))",
                        "",
                        "## ✅ Tactical TODOs",
                        "- [x] Audit WAF keepalive timeouts #team-engineering",
                        "- [ ] Prepare release checklist #release-train",
                    ]
                ),
                encoding="utf-8",
            )
            future_epoch = 1900000000.0  # strictly newer than 2026-11-19T07:00:00Z
            os.utime(daily_file, (future_epoch, future_epoch))

            # Remote Gist has a new bookmark from iPhone and tombstoned todo_deleted_remote
            remote_state = bridge.create_default_state(active_date="2026-11-19")
            remote_state["updatedAt"] = "2026-11-19T07:30:00.000Z"
            remote_state["bookmarks"] = [
                {
                    "id": "bm_ios_1",
                    "url": "https://web.dev/articles/view-transitions",
                    "title": "View Transitions API",
                    "domain": "web.dev",
                    "tags": ["web"],
                    "status": "inbox",
                    "pinned": True,
                    "estReadMins": 6,
                    "addedAt": "2026-11-19T07:25:00.000Z",
                    "updatedAt": "2026-11-19T07:25:00.000Z",
                }
            ]
            remote_state["tombstones"] = {
                "todo_deleted_remote": "2026-11-19T07:20:00.000Z",
            }

            captured_requests: list[dict[str, Any]] = []

            def fake_opener(request: Any, timeout: int = 15) -> _MockHttpResponse:
                captured_requests.append(
                    {
                        "url": request.full_url,
                        "method": request.get_method(),
                        "body": request.data.decode("utf-8") if request.data else None,
                    }
                )
                if request.get_method() == "GET":
                    return _MockHttpResponse(
                        {
                            "files": {
                                bridge.GIST_FILENAME: {
                                    "content": json.dumps(remote_state),
                                }
                            }
                        }
                    )
                return _MockHttpResponse({"id": "a1b2c3d4e5f6"})

            summary = bridge.run_sync(
                state_file=state_file,
                vault_dir=vault_dir,
                gist_id="a1b2c3d4e5f6",
                github_pat="ghp_test_token_12345",
                dry_run=False,
                opener=fake_opener,
            )

            self.assertTrue(summary["dailyMarkdownMerged"])
            self.assertTrue(summary["gistSynced"])
            self.assertEqual(len(captured_requests), 2)
            self.assertEqual(captured_requests[0]["method"], "GET")
            self.assertEqual(captured_requests[1]["method"], "PATCH")
            self.assertEqual(captured_requests[0]["url"], "https://api.github.com/gists/a1b2c3d4e5f6")

            # Verify githubPat is NEVER present in uploaded Gist JSON or saved local JSON
            uploaded_outer = json.loads(captured_requests[1]["body"])
            uploaded_state_str = uploaded_outer["files"][bridge.GIST_FILENAME]["content"]
            self.assertNotIn("ghp_test_token_12345", uploaded_state_str)
            self.assertNotIn("ghp_secret_must_never_leak", uploaded_state_str)
            uploaded_state = json.loads(uploaded_state_str)
            self.assertEqual(uploaded_state["sync"]["githubPat"], "")

            # Verify merged outcomes
            self.assertTrue(uploaded_state["objectives"][0]["completed"])
            todo_ids = {t["id"] for t in uploaded_state["todos"]}
            self.assertNotIn("todo_deleted_remote", todo_ids)
            self.assertTrue(any(t["text"] == "Prepare release checklist" for t in uploaded_state["todos"]))
            self.assertEqual(len(uploaded_state["bookmarks"]), 1)
            self.assertEqual(uploaded_state["bookmarks"][0]["id"], "bm_ios_1")


class TestObsidianExportAndDryRunCli(unittest.TestCase):
    """Tests for atomic Obsidian Markdown exports and --dry-run CLI mode."""

    def test_atomic_markdown_export_and_dry_run_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            digests_dir = root / "Digests"
            vault_dir = root / "Obsidian"
            state_file = root / "state" / "gateway-state.json"
            digests_dir.mkdir(parents=True, exist_ok=True)
            (digests_dir / "2026-11-18-digest.md").write_text(REALISTIC_TEAM_DIGEST, encoding="utf-8")

            # 1. Dry-run via main() must write zero files
            stdout_buf = io.StringIO()
            with contextlib.redirect_stdout(stdout_buf):
                rc = bridge.main(
                    [
                        "--state-file",
                        str(state_file),
                        "--digests-dir",
                        str(digests_dir),
                        "--vault-dir",
                        str(vault_dir),
                        "--dry-run",
                    ]
                )
            self.assertEqual(rc, 0)
            dry_out = json.loads(stdout_buf.getvalue())
            self.assertTrue(dry_out["ok"])
            self.assertTrue(dry_out["dryRun"])
            self.assertEqual(dry_out["parsedDigestItems"], 5)
            self.assertFalse(state_file.exists())
            self.assertFalse((vault_dir / "Reading" / "Bookmarks.md").exists())

            # 2. Real run exports Daily note and Bookmarks note cleanly
            seed = bridge.create_default_state(active_date="2026-11-19")
            seed["focusTheme"] = "Calm execution first."
            seed["wellness"]["breaksToday"] = 2
            seed["objectives"] = [
                {
                    "id": "obj_seed_1",
                    "title": "Ship Custom Reading Dashboard",
                    "url": "https://github.com/example/calm-gateway",
                    "urlLabel": "Repo",
                    "completed": False,
                    "createdAt": "2026-11-19T01:00:00.000Z",
                    "updatedAt": "2026-11-19T01:00:00.000Z",
                }
            ]
            seed["bookmarks"] = [
                {
                    "id": "bm_unpinned",
                    "url": "https://smashingmagazine.com/article",
                    "title": "Smashing Layout",
                    "domain": "smashingmagazine.com",
                    "tags": ["css"],
                    "status": "inbox",
                    "pinned": False,
                    "estReadMins": 8,
                    "addedAt": "2026-11-19T01:00:00.000Z",
                    "updatedAt": "2026-11-19T01:00:00.000Z",
                },
                {
                    "id": "bm_pinned",
                    "url": "https://web.dev/articles/anchor-positioning",
                    "title": "CSS Anchor Positioning",
                    "domain": "web.dev",
                    "tags": ["css"],
                    "status": "inbox",
                    "pinned": True,
                    "estReadMins": 5,
                    "addedAt": "2026-11-19T02:00:00.000Z",
                    "updatedAt": "2026-11-19T02:00:00.000Z",
                },
                {
                    "id": "bm_arch",
                    "url": "https://developer.chrome.com/docs/web-platform",
                    "title": "Chrome Docs",
                    "domain": "developer.chrome.com",
                    "tags": ["chrome"],
                    "status": "archived",
                    "pinned": False,
                    "estReadMins": 4,
                    "addedAt": "2026-11-18T02:00:00.000Z",
                    "updatedAt": "2026-11-19T03:00:00.000Z",
                },
            ]
            state_file.parent.mkdir(parents=True, exist_ok=True)
            state_file.write_text(bridge.export_clean_state_json(seed), encoding="utf-8")

            stdout_real = io.StringIO()
            with contextlib.redirect_stdout(stdout_real):
                rc_real = bridge.main(
                    [
                        "--state-file",
                        str(state_file),
                        "--digests-dir",
                        str(digests_dir),
                        "--vault-dir",
                        str(vault_dir),
                        "--bundle-out",
                        "",
                    ]
                )
            self.assertEqual(rc_real, 0)

            daily_md = (vault_dir / "Daily" / "2026-11-19.md").read_text(encoding="utf-8")
            self.assertIn("date: 2026-11-19", daily_md)
            self.assertIn('focus_theme: "Calm execution first."', daily_md)
            self.assertIn("breaks_taken: 2", daily_md)
            self.assertIn("## 🎯 Today's Objectives (Big 3)", daily_md)
            self.assertIn("- [ ] Ship Custom Reading Dashboard ([Repo](https://github.com/example/calm-gateway))", daily_md)
            self.assertIn("## 💬 Daily Digest Summary", daily_md)
            self.assertIn("**#frontend** [Decision] SSO auth proxy migration", daily_md)

            bookmarks_md = (vault_dir / "Reading" / "Bookmarks.md").read_text(encoding="utf-8")
            self.assertIn("## 📥 Reading Queue (Inbox)", bookmarks_md)
            self.assertIn("## 📚 Archived / Read", bookmarks_md)
            # Pinned item must appear before unpinned item in Inbox
            pinned_idx = bookmarks_md.index("★ [CSS Anchor Positioning]")
            unpinned_idx = bookmarks_md.index("[Smashing Layout]")
            self.assertLess(pinned_idx, unpinned_idx)
            self.assertIn("[Chrome Docs](https://developer.chrome.com/docs/web-platform)", bookmarks_md)

    def test_parses_callout_digest_and_wikilinks(self) -> None:
        callout_md = """---
type: digest
date: "2026-11-19"
timezone: UTC
window: "2026-11-18 09:00 -> 2026-11-19 09:00 (UTC)"
---

# Daily Digest — 2026-11-19

> [!todo]+ Action Required (TODOs)
> - [ ] 🔴 **Hiring FE (R2)**: Reply to Alex Rivera (`GroupDM:Hiring FE (R2)`) — [Slack ↗](https://team.slack.com/archives/C0CBHL52UDQ/p1795059600887109)
> - [x] 🔴 **Merge MRs for Sam**: Already merged (`DM:Sam`) — [Slack ↗](https://team.slack.com/archives/D0499SEG36V/p1795069458400299)

> [!danger]+ P0 — Urgent & Direct Mentions
> - [ ] **FE Hiring R2 Decision** (`GroupDM:Hiring FE (R2)`): Needs go/no-go. [Slack ↗](https://team.slack.com/archives/C0CBHL52UDQ/p1795059889842519)

> [!warning]+ P1 — Frontend & Key Decisions
> - [ ] **Offline Mode Sync Plan** (`#core-platform`): **Decision**: Prioritize PowerSync for mobile offline queue. [Slack ↗](https://team.slack.com/archives/CKF93N97A/p1794984272011599) · [[../Inbox/2026-11-19 Offline Mode Sync Plan|Full Breakdown]]
"""
        parsed = bridge.parse_slack_digest_markdown(
            callout_md,
            vault_name="Engineering",
            vault_prefix="Notes",
        )
        self.assertEqual(parsed["date"], "2026-11-19")
        self.assertEqual(parsed["deliveredAt"], "09:00 UTC")
        # 1 unchecked actionTodo ([x] Sam MR skipped), 2 digest items (P0 + P1)
        self.assertEqual(len(parsed["actionTodos"]), 1)
        self.assertIn("Hiring FE (R2)", parsed["actionTodos"][0]["text"])
        self.assertEqual(len(parsed["items"]), 2)
        p1_item = next(it for it in parsed["items"] if it["channel"] == "#core-platform")
        self.assertEqual(p1_item["badge"], "Decision")
        self.assertTrue(
            any("obsidian://open?vault=Engineering&file=Notes/Inbox/" in s["url"] for s in p1_item["sources"])
        )
        self.assertTrue(any("slack.com" in s["url"] for s in p1_item["sources"]))

        # Default call without vault_name produces neutral obsidian://open?file=... URI
        parsed_neutral = bridge.parse_slack_digest_markdown(callout_md)
        p1_neutral = next(it for it in parsed_neutral["items"] if it["channel"] == "#core-platform")
        self.assertTrue(
            any(s["url"].startswith("obsidian://open?file=Inbox/") for s in p1_neutral["sources"])
        )

    def test_repeat_cont_todos_unified_across_days(self) -> None:
        day1 = bridge.parse_slack_digest_markdown(
            """---
date: "2026-11-19"
window: "2026-11-18 09:00 -> 2026-11-19 09:00 (UTC)"
---
> [!todo]+ Action Required (TODOs)
> - [ ] 🔴 **Hiring FE (R2)**: Reply to Alex Rivera (`GroupDM:Hiring FE (R2)`) — [Slack ↗](https://team.slack.com/archives/C0CBHL52UDQ/p1795059600887109)
"""
        )
        day2 = bridge.parse_slack_digest_markdown(
            """---
date: "2026-11-20"
window: "2026-11-19 09:00 -> 2026-11-20 09:00 (UTC)"
---
> [!todo]+ Action Required (TODOs)
> - [ ] 🔴 **Hiring FE (R2) (cont.)**: Reply to Alex Rivera (`GroupDM:Hiring FE (R2)`) — [Slack ↗](https://team.slack.com/archives/C0CBHL52UDQ/p1795059600887109)
"""
        )
        state = bridge.create_default_state("2026-11-20")
        state = bridge.merge_slack_digest_into_state(state, day1)
        state = bridge.merge_slack_digest_into_state(state, day2)
        self.assertEqual(len(state["todos"]), 1)
        self.assertIn("(cont.)", state["todos"][0]["text"])


class TestNeutralDefaultsAndConfigResolution(unittest.TestCase):
    """Tests for neutral default state, --init-config, config precedence, and v2/v3 block preservation."""

    def test_neutral_defaults_and_v3_block_preservation(self) -> None:
        default_state = bridge.create_default_state("2026-11-20")
        self.assertEqual(default_state["userName"], "")
        self.assertFalse(default_state["onboardingCompleted"])
        self.assertEqual(default_state["digestConfig"]["title"], "Daily Digest")
        self.assertEqual(default_state["digestConfig"]["feedUrl"], "")
        self.assertEqual(default_state["slackDigest"]["deliveredAt"], "09:00 UTC")

        local_state = bridge.create_default_state("2026-11-20")
        local_state["updatedAt"] = "2026-11-20T08:00:00.000Z"
        local_state["layout"] = {
            "editMode": False,
            "zones": {"top": ["launchpad"], "left": ["objectives"], "right": ["weather"], "bottom": ["discovery"]},
            "updatedAt": "2026-11-20T08:00:00.000Z",
        }

        remote_state = bridge.create_default_state("2026-11-20")
        remote_state["updatedAt"] = "2026-11-20T09:00:00.000Z"
        remote_state["onboardingCompleted"] = True
        remote_state["digestConfig"] = {
            "title": "Team Pulse",
            "subtitle": "Daily Updates",
            "feedUrl": "https://example.com/digest.json",
        }
        remote_state["layout"] = {
            "editMode": False,
            "zones": {"top": ["weather"], "left": ["objectives", "todos"], "right": ["slack"], "bottom": ["discovery"]},
            "updatedAt": "2026-11-20T09:00:00.000Z",
        }
        remote_state["widgets"] = {
            "weather": {"locationName": "London", "latitude": 51.5, "longitude": -0.12, "updatedAt": "2026-11-20T09:00:00.000Z"},
            "worldClock": {"clocks": [{"id": "wc_lon", "label": "London", "timeZone": "Europe/London", "updatedAt": "2026-11-20T09:00:00.000Z"}]},
        }
        remote_state["background"] = {
            "mode": "pinned",
            "pinnedId": "pixel-cyber-bonsai",
            "customImages": [],
            "updatedAt": "2026-11-20T09:00:00.000Z",
        }

        merged = bridge.merge_states(local_state, remote_state)
        self.assertTrue(merged["onboardingCompleted"])
        self.assertEqual(merged["digestConfig"]["feedUrl"], "https://example.com/digest.json")
        self.assertEqual(merged["layout"]["zones"]["top"], ["weather"])
        self.assertEqual(merged["widgets"]["weather"]["locationName"], "London")
        self.assertEqual(merged["background"]["mode"], "pinned")

    def test_init_config_and_precedence_cli_env_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            cfg_file = root / "config.json"

            # 1. --init-config creates template and refuses overwrite without --force
            stdout_init = io.StringIO()
            with contextlib.redirect_stdout(stdout_init):
                rc = bridge.main(["--config", str(cfg_file), "--init-config"])
            self.assertEqual(rc, 0)
            self.assertTrue(cfg_file.is_file())
            self.assertEqual(cfg_file.stat().st_mode & 0o777, 0o600)

            stderr_dup = io.StringIO()
            with contextlib.redirect_stderr(stderr_dup):
                rc_dup = bridge.main(["--config", str(cfg_file), "--init-config"])
            self.assertEqual(rc_dup, 1)

            rc_force = bridge.main(["--config", str(cfg_file), "--init-config", "--force"])
            self.assertEqual(rc_force, 0)

            # 2. Config precedence: CLI > Env > Config > Default
            cfg_state = root / "cfg-state.json"
            cfg_digests = root / "cfg-digests"
            env_digests = root / "env-digests"
            cli_digests = root / "cli-digests"
            cfg_file.write_text(
                json.dumps(
                    {
                        "userName": "ConfigUser",
                        "stateFile": str(cfg_state),
                        "digestsDir": str(cfg_digests),
                        "gistId": "1111222233334444",
                    }
                ),
                encoding="utf-8",
            )

            parser = bridge.build_arg_parser()
            args_cfg_only = parser.parse_args([])
            resolved_cfg = bridge.resolve_runtime_options(
                args_cfg_only,
                env={"CALM_GATEWAY_CONFIG": str(cfg_file)},
            )
            self.assertEqual(resolved_cfg["user_name"], "ConfigUser")
            self.assertEqual(resolved_cfg["state_file"], cfg_state)
            self.assertEqual(resolved_cfg["digests_dir"], cfg_digests)
            self.assertEqual(resolved_cfg["gist_id"], "1111222233334444")

            resolved_env = bridge.resolve_runtime_options(
                args_cfg_only,
                env={
                    "CALM_GATEWAY_CONFIG": str(cfg_file),
                    "CALM_GATEWAY_DIGESTS_DIR": str(env_digests),
                    "CALM_GATEWAY_GIST_ID": "aaaa1111bbbb2222",
                },
            )
            self.assertEqual(resolved_env["digests_dir"], env_digests)
            self.assertEqual(resolved_env["gist_id"], "aaaa1111bbbb2222")

            args_cli = parser.parse_args(["--digests-dir", str(cli_digests), "--gist-id", "cccc3333dddd4444"])
            resolved_cli = bridge.resolve_runtime_options(
                args_cli,
                env={
                    "CALM_GATEWAY_CONFIG": str(cfg_file),
                    "CALM_GATEWAY_DIGESTS_DIR": str(env_digests),
                    "CALM_GATEWAY_GIST_ID": "aaaa1111bbbb2222",
                },
            )
            self.assertEqual(resolved_cli["digests_dir"], cli_digests)
            self.assertEqual(resolved_cli["gist_id"], "cccc3333dddd4444")


if __name__ == "__main__":
    unittest.main()
