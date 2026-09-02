#!/usr/bin/env python3
"""Privacy-boundary tests for repository-scoped skill-doctor collection."""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from collect_sessions import (
    assert_no_local_paths,
    build_repo_scopes,
    claude_project_directory_keys,
    find_claude_session_files,
    parse_scoped_claude_session,
    parse_scoped_codex_session,
    parse_scoped_warp_conversation,
    redact_sensitive_text,
    resolve_repo,
    session_matches_repos,
)


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(record) for record in records) + "\n")


def initialize_repository(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(
        [
            "git", "-C", str(path),
            "-c", "user.name=Scope Test",
            "-c", "user.email=scope-test@example.invalid",
            "commit", "-q", "--allow-empty", "-m", "test",
        ],
        check=True,
    )


class ScopePrivacyTests(unittest.TestCase):
    def test_repository_scope_rejects_name_collisions_and_stale_worktrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved" / "theGame"
            same_basename = root / "other" / "theGame"
            segment_collision = root / "theGame" / "unrelated"
            nested_repository = approved / "vendor" / "foreign"
            worktree = root / "renamed worktree Проект"
            stale_worktree = root / "removed-worktree"
            initialize_repository(approved)
            initialize_repository(same_basename)
            initialize_repository(nested_repository)
            internal_directory = approved / "internal"
            internal_directory.mkdir()
            internal_link = approved / "internal-link"
            external_link = approved / "external-link"
            internal_link.symlink_to(internal_directory, target_is_directory=True)
            external_link.symlink_to(same_basename, target_is_directory=True)

            subprocess.run(
                [
                    "git", "-C", str(approved), "worktree", "add", "-q",
                    "-b", "review", str(worktree),
                ],
                check=True,
            )
            subprocess.run(
                [
                    "git", "-C", str(approved), "worktree", "add", "-q",
                    "-b", "stale", str(stale_worktree),
                ],
                check=True,
            )
            subprocess.run(
                [
                    "git", "-C", str(approved), "worktree", "remove",
                    "--force", str(stale_worktree),
                ],
                check=True,
            )

            scopes = build_repo_scopes([approved])

            self.assertTrue(session_matches_repos(approved, scopes))
            self.assertTrue(
                session_matches_repos(approved / "missing" / "child", scopes)
            )
            self.assertTrue(session_matches_repos(worktree / "src", scopes))
            self.assertTrue(session_matches_repos(internal_link, scopes))
            self.assertFalse(session_matches_repos(same_basename, scopes))
            self.assertFalse(session_matches_repos(segment_collision, scopes))
            self.assertFalse(session_matches_repos(nested_repository, scopes))
            self.assertFalse(session_matches_repos(external_link, scopes))
            self.assertFalse(session_matches_repos(stale_worktree / "src", scopes))
            self.assertFalse(session_matches_repos(".", scopes))
            self.assertFalse(session_matches_repos("src", scopes))
            if os.name != "nt":
                self.assertFalse(session_matches_repos(r"C:\\private", scopes))
                self.assertFalse(
                    session_matches_repos(r"\\\\server\\share", scopes)
                )
                self.assertFalse(
                    session_matches_repos("//server/share", scopes)
                )

    def test_non_git_scope_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "explicit-project"
            nested_repository = approved / "nested-repository"
            approved.mkdir()
            initialize_repository(nested_repository)
            scopes = build_repo_scopes([approved])

            with self.assertRaises(ValueError):
                resolve_repo(approved)
            self.assertFalse(session_matches_repos(approved, scopes))
            self.assertFalse(session_matches_repos(approved / "ordinary", scopes))
            self.assertFalse(session_matches_repos(nested_repository, scopes))
            self.assertFalse(session_matches_repos(root / "other", scopes))

    def test_scoped_parsers_gate_on_metadata_before_full_payload_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "other" / approved.name
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])

            claude_path = root / "claude.jsonl"
            write_jsonl(claude_path, [{
                "sessionId": "claude-out-of-scope",
                "cwd": str(rejected),
                "type": "user",
                "message": {"role": "user", "content": "SENSITIVE_CLAUDE_SENTINEL"},
            }])
            codex_path = root / "codex.jsonl"
            write_jsonl(codex_path, [
                {
                    "type": "session_meta",
                    "payload": {"id": "codex-out-of-scope", "cwd": str(rejected)},
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "SENSITIVE_CODEX_SENTINEL",
                        }],
                    },
                },
            ])
            warp_record = {
                "conversation_id": "warp-out-of-scope",
                "summary": json.dumps({
                    "initial_working_directory": str(rejected),
                }),
            }

            with patch("collect_sessions.parse_claude_session") as parser:
                self.assertIsNone(parse_scoped_claude_session(
                    claude_path, set(), False, scopes,
                ))
                parser.assert_not_called()
            with patch("collect_sessions.parse_codex_session") as parser:
                self.assertIsNone(parse_scoped_codex_session(
                    codex_path, set(), False, scopes,
                ))
                parser.assert_not_called()
            with patch("collect_sessions.parse_warp_conversation") as parser:
                self.assertIsNone(parse_scoped_warp_conversation(
                    warp_record, set(), False, scopes,
                ))
                parser.assert_not_called()

    def test_missing_scope_metadata_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            initialize_repository(root)
            scopes = build_repo_scopes([root])
            missing_meta = root / "missing-meta.jsonl"
            write_jsonl(missing_meta, [{"type": "response_item", "payload": {}}])

            with patch("collect_sessions.parse_claude_session") as claude_parser:
                self.assertIsNone(parse_scoped_claude_session(
                    missing_meta, set(), False, scopes,
                ))
                claude_parser.assert_not_called()
            with patch("collect_sessions.parse_codex_session") as codex_parser:
                self.assertIsNone(parse_scoped_codex_session(
                    missing_meta, set(), False, scopes,
                ))
                codex_parser.assert_not_called()
            with patch("collect_sessions.parse_warp_conversation") as warp_parser:
                self.assertIsNone(parse_scoped_warp_conversation(
                    {"conversation_id": "missing", "summary": "not-json"},
                    set(),
                    False,
                    scopes,
                ))
                warp_parser.assert_not_called()

            with patch("collect_sessions.open_warp_database") as database:
                self.assertIsNone(parse_scoped_warp_conversation(
                    {"conversation_id": "non-object", "summary": "[]"},
                    set(),
                    False,
                    scopes,
                ))
                database.assert_not_called()

    def test_multibyte_oversized_metadata_fails_before_full_parser(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            initialize_repository(approved)
            scopes = build_repo_scopes([approved])
            path = root / "oversized.jsonl"
            record = {
                "type": "session_meta",
                "payload": {"cwd": str(approved), "padding": "😀" * 20000},
            }
            path.write_text(json.dumps(record, ensure_ascii=False) + "\n")

            with patch("collect_sessions.parse_codex_session") as parser:
                self.assertIsNone(parse_scoped_codex_session(
                    path, set(), False, scopes,
                ))
                parser.assert_not_called()

    def test_conflicting_codex_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])
            path = root / "conflicting.jsonl"
            write_jsonl(path, [
                {
                    "type": "session_meta",
                    "payload": {"id": "session", "cwd": str(approved)},
                },
                {
                    "type": "session_meta",
                    "payload": {"id": "session", "cwd": str(rejected)},
                },
            ])

            self.assertIsNone(parse_scoped_codex_session(
                path, set(), False, scopes,
            ))

    def test_conflicting_claude_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])
            path = root / "conflicting.jsonl"
            write_jsonl(path, [
                {
                    "sessionId": "session",
                    "cwd": str(approved),
                    "type": "user",
                    "message": {"role": "user", "content": "approved"},
                },
                {
                    "sessionId": "session",
                    "cwd": str(rejected),
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": "OUT_OF_SCOPE_SENTINEL",
                    },
                },
            ])

            self.assertIsNone(parse_scoped_claude_session(
                path, set(), False, scopes,
            ))

    def test_conflicting_warp_summary_and_query_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])
            database = root / "warp.sqlite"
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE ai_queries ("
                "conversation_id TEXT, working_directory TEXT, start_ts TEXT)"
            )
            connection.execute(
                "INSERT INTO ai_queries VALUES (?, ?, ?)",
                ("conflict", str(rejected), "2026-09-02T00:00:00Z"),
            )
            connection.commit()
            connection.close()
            record = {
                "conversation_id": "conflict",
                "database": database,
                "summary": json.dumps({
                    "initial_working_directory": str(approved),
                }),
            }

            with patch("collect_sessions.parse_warp_conversation") as parser:
                self.assertIsNone(parse_scoped_warp_conversation(
                    record, set(), False, scopes,
                ))
                parser.assert_not_called()

    def test_later_conflicting_warp_query_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])
            database = root / "warp.sqlite"
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE ai_queries ("
                "conversation_id TEXT, working_directory TEXT, start_ts TEXT)"
            )
            connection.executemany(
                "INSERT INTO ai_queries VALUES (?, ?, ?)",
                [
                    ("conflict", str(approved), "2026-09-02T00:00:00Z"),
                    ("conflict", str(rejected), "2026-09-02T00:01:00Z"),
                ],
            )
            connection.commit()
            connection.close()
            record = {
                "conversation_id": "conflict",
                "database": database,
                "summary": json.dumps({
                    "initial_working_directory": str(approved),
                }),
            }

            with patch("collect_sessions.parse_warp_conversation") as parser:
                self.assertIsNone(parse_scoped_warp_conversation(
                    record, set(), False, scopes,
                ))
                parser.assert_not_called()

    def test_cli_synthetic_homes_exclude_out_of_scope_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            codex_home = root / "synthetic-codex-home"
            claude_home = root / "synthetic-claude-home"
            out = root / "report"
            timestamp = datetime.now(timezone.utc).isoformat()
            write_jsonl(codex_home / "sessions" / "rollout-approved.jsonl", [
                {
                    "type": "session_meta",
                    "timestamp": timestamp,
                    "payload": {
                        "id": "approved-session",
                        "cwd": str(approved),
                        "timestamp": timestamp,
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": timestamp,
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "APPROVED_CANARY_MESSAGE",
                        }],
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": timestamp,
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": "Approved response",
                        }],
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": timestamp,
                    "payload": {
                        "type": "custom_tool_call",
                        "name": "read",
                        "input": "{}",
                    },
                },
            ])
            write_jsonl(codex_home / "sessions" / "rollout-rejected.jsonl", [
                {
                    "type": "session_meta",
                    "timestamp": timestamp,
                    "payload": {
                        "id": "rejected-session",
                        "cwd": str(rejected),
                        "timestamp": timestamp,
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": timestamp,
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "OUT_OF_SCOPE_SENTINEL",
                        }],
                    },
                },
            ])
            approved_key = next(iter(claude_project_directory_keys([approved])))
            write_jsonl(
                claude_home / "projects" / approved_key / "rejected.jsonl",
                [{
                    "sessionId": "claude-rejected",
                    "cwd": str(rejected),
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": "OUT_OF_SCOPE_CLAUDE_SENTINEL",
                    },
                }],
            )
            script = Path(__file__).resolve().parent / "collect_sessions.py"
            environment = {
                **os.environ,
                "HOME": str(root / "synthetic-home"),
                "HTTP_PROXY": "http://127.0.0.1:9",
                "HTTPS_PROXY": "http://127.0.0.1:9",
                "NO_PROXY": "*",
            }

            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--harness", "all",
                    "--repo", str(approved),
                    "--codex-home", str(codex_home),
                    "--claude-home", str(claude_home),
                    "--warp-data-dir", str(root / "empty-warp-home"),
                    "--days", "1",
                    "--out", str(out),
                ],
                capture_output=True,
                text=True,
                timeout=15,
                env=environment,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            artifacts = "\n".join(
                path.read_text(errors="replace")
                for path in out.rglob("*")
                if path.is_file()
            )
            self.assertIn("APPROVED_CANARY_MESSAGE", artifacts)
            self.assertNotIn("OUT_OF_SCOPE_SENTINEL", artifacts)
            self.assertNotIn("OUT_OF_SCOPE_CLAUDE_SENTINEL", artifacts)

    def test_explicit_all_conversations_scope_still_parses_every_source(self):
        marker = object()
        with patch(
            "collect_sessions.parse_claude_session", return_value=marker,
        ) as claude_parser:
            self.assertIs(
                parse_scoped_claude_session(Path("unused"), set(), False, None),
                marker,
            )
            claude_parser.assert_called_once()
        with patch(
            "collect_sessions.parse_codex_session", return_value=marker,
        ) as codex_parser:
            self.assertIs(
                parse_scoped_codex_session(Path("unused"), set(), False, None),
                marker,
            )
            codex_parser.assert_called_once()
        with patch(
            "collect_sessions.parse_warp_conversation", return_value=marker,
        ) as warp_parser:
            self.assertIs(
                parse_scoped_warp_conversation({}, set(), False, None),
                marker,
            )
            warp_parser.assert_called_once()

    def test_claude_discovery_uses_only_approved_project_directory_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / "claude"
            approved = root / "approved"
            rejected = root / "rejected"
            initialize_repository(approved)
            initialize_repository(rejected)
            approved_key = next(iter(claude_project_directory_keys([approved])))
            rejected_key = next(iter(claude_project_directory_keys([rejected])))
            approved_session = (
                claude_home / "projects" / approved_key / "approved.jsonl"
            )
            rejected_session = (
                claude_home / "projects" / rejected_key / "rejected.jsonl"
            )
            write_jsonl(approved_session, [{"type": "user"}])
            write_jsonl(rejected_session, [{"type": "user"}])
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)

            files = find_claude_session_files(
                claude_home,
                cutoff,
                False,
                project_keys={approved_key},
            )

            self.assertEqual([path for _, path in files], [approved_session])

    def test_claude_slug_collision_still_requires_each_files_cwd_to_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            claude_home = root / "claude"
            approved = root / "foo_bar"
            rejected = root / "foo-bar"
            initialize_repository(approved)
            initialize_repository(rejected)
            scopes = build_repo_scopes([approved])
            key = next(iter(claude_project_directory_keys(scopes)))
            self.assertEqual(
                key,
                next(iter(claude_project_directory_keys([rejected]))),
            )
            approved_session = claude_home / "projects" / key / "approved.jsonl"
            rejected_session = claude_home / "projects" / key / "rejected.jsonl"
            write_jsonl(approved_session, [{
                "sessionId": "approved",
                "cwd": str(approved),
                "type": "user",
                "message": {"role": "user", "content": "approved"},
            }])
            write_jsonl(rejected_session, [{
                "sessionId": "rejected",
                "cwd": str(rejected),
                "type": "user",
                "message": {"role": "user", "content": "rejected"},
            }])
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)
            files = find_claude_session_files(
                claude_home, cutoff, False, project_keys={key},
            )

            self.assertEqual(
                {path for _, path in files},
                {approved_session, rejected_session},
            )
            with patch("collect_sessions.parse_claude_session") as parser:
                self.assertIsNone(parse_scoped_claude_session(
                    rejected_session, set(), False, scopes,
                ))
                parser.assert_not_called()

    def test_redacts_complete_paths_with_spaces_across_platform_shapes(self):
        nfc = "Проект"
        nfd = unicodedata.normalize("NFD", "Проект")
        nested_path = json.dumps({
            "arguments": '{"path":"\\/Users/alice/secret.txt"}',
        })
        nested_quoted_path = json.dumps({
            "arguments": json.dumps({
                "path": '/Users/alice/a"PRIVATE_SUFFIX.txt',
            }),
        })
        samples = {
            '"/Users/alice/My Project/a,)] file.txt"': '"[LOCAL_PATH]"',
            '{"path":"/home/alice/My Project/sensitive/file.txt"}':
                '{"path":"[LOCAL_PATH]"}',
            f"cwd:/tmp/{nfc}/sensitive/file.txt": "cwd:[LOCAL_PATH]",
            rf"cwd:C:\\Users\\Alice\\{nfd}\\sensitive\\file.txt":
                "cwd:[LOCAL_PATH]",
            r'"\\\\server\\share"': r'"[LOCAL_PATH]"',
            rf'"\\\\server\\My Share\\{nfc}\\file.txt"':
                r'"[LOCAL_PATH]"',
            f'"//server/share/{nfd}/file.txt"': '"[LOCAL_PATH]"',
            rf'{{\"path\":\"/Users/alice/{nfc}/a,)] file.txt\",\"next\":1}}':
                r'{\"path\":\"[LOCAL_PATH]\",\"next\":1}',
            '"/Applications/Secret Project/file.txt"': '"[LOCAL_PATH]"',
            r'{\"path\":\"\/Users\/alice\/secret.txt\"}':
                r'{\"path\":\"[LOCAL_PATH]\"}',
            r'{\"path\":\"\/\/server\/share\/PRIVATE.txt\"}':
                r'{\"path\":\"[LOCAL_PATH]\"}',
            "/Users/alice/a,b/secret.txt": "[LOCAL_PATH]",
            "/Users/alice/a,b.txt": "[LOCAL_PATH]",
            '/custom/Проект/a"PRIVATE.txt': "[LOCAL_PATH]",
            nested_path: None,
            nested_quoted_path: None,
        }

        for source, expected in samples.items():
            with self.subTest(source=source):
                redacted = redact_sensitive_text(source)
                if expected is not None:
                    self.assertEqual(redacted, expected)
                self.assertIn("[LOCAL_PATH]", redacted)
                self.assertNotIn("Users", redacted)
                self.assertNotIn("sensitive", redacted.lower())
                self.assertNotIn("secret.txt", redacted)
                self.assertNotIn("PRIVATE_SUFFIX", redacted)
                assert_no_local_paths(redacted)

    def test_final_path_validator_rejects_any_unredacted_local_path(self):
        with self.assertRaises(ValueError):
            assert_no_local_paths('/Users/alice/My Project/sensitive/file.txt')
        with self.assertRaises(ValueError):
            assert_no_local_paths('[LOCAL_PATH] Project/sensitive/file.txt')
        with self.assertRaises(ValueError):
            assert_no_local_paths('/Applications/Secret Project/file.txt')
        with self.assertRaises(ValueError):
            assert_no_local_paths(r'\/Users\/alice\/secret.txt')
        self.assertEqual(
            redact_sensitive_text('[LOCAL_PATH] ordinary/text'),
            '[LOCAL_PATH] ordinary/text',
        )

    def test_nested_json_redaction_handles_multiple_escape_depths(self):
        private_markers = (
            "PRIVATE_PROJECT",
            "Проект",
            "Users",
            "server",
        )
        paths = (
            '/Applications/PRIVATE_PROJECT/file.txt',
            '/Users/alice/a,b;)]} PRIVATE_PROJECT.txt',
            '/opt/Проект/a"PRIVATE_PROJECT.txt',
            r'C:\\Users\\Alice\\Проект\\a"PRIVATE_PROJECT.txt',
            r'\\server\\My Share\\Проект\\a"PRIVATE_PROJECT.txt',
            '//server/My Share/Проект/a"PRIVATE_PROJECT.txt',
        )

        for path in paths:
            nested = json.dumps({"path": path}, ensure_ascii=False)
            for depth in range(4):
                with self.subTest(path=path, depth=depth):
                    redacted = redact_sensitive_text(nested)
                    self.assertIn("[LOCAL_PATH]", redacted)
                    for marker in private_markers:
                        self.assertNotIn(marker, redacted)
                    assert_no_local_paths(redacted)
                nested = json.dumps({"arguments": nested}, ensure_ascii=False)

    def test_ansi_controls_cannot_hide_local_paths(self):
        paths = (
            "/Users/alice/PRIVATE_POSIX.txt",
            r"C:\\Users\\alice\\PRIVATE_WINDOWS.txt",
            r"\\server\\share\\PRIVATE_UNC.txt",
        )

        for path in paths:
            samples = (
                f"\x1b[36m{path}\x1b[0m",
                json.dumps({"output": f"\x1b[36m{path}\x1b[0m"}),
                json.dumps({
                    "arguments": json.dumps({
                        "output": f"\x1b[36m{path}\x1b[0m",
                    }),
                }),
                f"\\033[36m{path}\\033[0m",
                f"\\x9b36m{path}\\x9b0m",
                f"\\23336m{path}\\2330m",
            )
            for source in samples:
                with self.subTest(path=path, source=source):
                    redacted = redact_sensitive_text(source)
                    self.assertIn("[LOCAL_PATH]", redacted)
                    self.assertNotIn("PRIVATE_", redacted)
                    assert_no_local_paths(redacted)

        hyperlink = (
            "\x1b]8;;file:///Users/alice/PRIVATE_LINK.txt\x1b\\"
            "visible label"
            "\x1b]8;;\x1b\\"
        )
        redacted = redact_sensitive_text(hyperlink)
        self.assertEqual(redacted, "visible label")
        self.assertNotIn("PRIVATE_LINK", redacted)


if __name__ == "__main__":
    unittest.main()
