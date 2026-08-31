#!/usr/bin/env python3
"""Tests for skill-doctor session collection."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from collect_sessions import (
    classify_tool_output,
    detect_skills_from_entries,
    discover_skills,
    find_claude_session_files,
    is_wait_tool,
    parse_claude_session,
    parse_codex_session,
    parse_since,
    session_matches_repos,
    split_session_tasks,
    transcript_path_for,
    redact_sensitive_text,
)


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(record) for record in records) + "\n")


class ClaudeSessionTests(unittest.TestCase):
    def test_redacts_secrets_and_local_identifiers_before_transcript_output(self):
        github_token = "ghp_" + "a" * 36
        jwt = ".".join(("eyJabcdefghij", "eyJklmnopqrst", "uvwxyzabcdefgh"))
        source = (
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n"
            "Cookie: session=private-cookie-value\n"
            "AUTH_SECRET=abcdefghijklmnopqrstuvwxyz123456\n"
            f"{github_token}\n"
            f"{jwt}\n"
            "/Users/alice/private/repo/file.py\n"
            "D:/work/private/report.txt\n"
            "file:///root/private/report.txt\n"
            "alice@example.test\n"
            "01a0545f-bda5-7212-b218-a1a2e1adace8"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", redacted)
        self.assertNotIn("/Users/alice", redacted)
        self.assertNotIn("private-cookie-value", redacted)
        self.assertNotIn(jwt, redacted)
        self.assertNotIn("D:/work/private/report.txt", redacted)
        self.assertNotIn("file:///root/private/report.txt", redacted)
        self.assertNotIn("alice@example.test", redacted)
        self.assertNotIn("01a0545f-bda5-7212-b218-a1a2e1adace8", redacted)
        self.assertIn("[REDACTED]", redacted)
        self.assertIn("$HOME/private/repo/file.py", redacted)

    def test_transcript_filename_never_contains_untrusted_task_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            transcripts = Path(tmp) / "transcripts"
            hostile_ids = [
                "../../../../Users/example/AGENTS",
                r"..\\..\\secret",
                r"C:\\Users\\example\\secret",
                "//server/share/secret",
                "task/with/slashes\nand-control",
            ]

            for task_id in hostile_ids:
                with self.subTest(task_id=task_id):
                    path = transcript_path_for(transcripts, "codex", task_id)
                    self.assertEqual(path.parent, transcripts.resolve())
                    self.assertRegex(path.name, r"^codex-[0-9a-f]{16}\.md$")
                    self.assertNotIn("secret", path.name)

    def test_splits_multi_request_conversation_into_scoring_tasks(self):
        meta = {
            "id": "conversation-1",
            "cwd": "/tmp/repo",
            "started_at": "2026-08-30T10:00:00Z",
        }
        entries = [
            ("assistant", "Preamble without a user request."),
            ("user", "Implement the first change"),
            ("assistant", "I will inspect it."),
            ("tool:read", '{"path":"/tmp/repo/first.py"}'),
            ("output", "ok"),
            ("user", "Now investigate a separate problem"),
            ("assistant", "I will reproduce it."),
            ("tool:wait", '{}'),
            ("tool:exec", '{"cmd":"pytest"}'),
            ("output:environment_denial", "sandbox denied access"),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(len(tasks), 2)
        first_meta, first_stats, first_entries = tasks[0]
        second_meta, second_stats, second_entries = tasks[1]
        self.assertEqual(first_meta["id"], "conversation-1-task-001")
        self.assertEqual(first_meta["parent_session_id"], "conversation-1")
        self.assertEqual(second_meta["id"], "conversation-1-task-002")
        self.assertEqual(first_entries[0], ("user", "Implement the first change"))
        self.assertEqual(second_entries[0], ("user", "Now investigate a separate problem"))
        self.assertEqual(first_stats["tool_calls"], 1)
        self.assertEqual(second_stats["tool_calls"], 2)
        self.assertEqual(second_stats["wait_calls"], 1)
        self.assertEqual(second_stats["failed_outputs"], 1)
        self.assertEqual(second_stats["environment_denials"], 1)

    def test_short_confirmation_stays_with_the_request_it_authorizes(self):
        meta = {"id": "conversation-approval"}
        entries = [
            ("user", "Install and run skill-doctor"),
            ("assistant", "Run it against a limited local sample?"),
            ("user", "да, ограниченный запуск"),
            ("assistant", "Starting the limited run."),
            ("tool:exec", '{"cmd":"collect"}'),
            ("output", "ok"),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0][1]["user_turns"], 2)
        self.assertEqual(tasks[0][2][0], ("user", "Install and run skill-doctor"))
        self.assertIn(("user", "да, ограниченный запуск"), tasks[0][2])

    def test_generic_follow_up_question_does_not_absorb_a_new_request(self):
        meta = {"id": "conversation-generic-follow-up"}
        entries = [
            ("user", "Audit repository A"),
            ("assistant", "Done. Want another check?"),
            ("user", "Now implement unrelated feature B"),
            ("assistant", "Implementing."),
            ("tool:exec", '{"cmd":"implement"}'),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0][2][0], ("user", "Audit repository A"))
        self.assertEqual(
            tasks[1][2][0],
            ("user", "Now implement unrelated feature B"),
        )

    def test_short_acknowledgement_without_a_question_starts_a_new_task(self):
        entries = [
            ("user", "Audit repository A"),
            ("assistant", "Audit complete."),
            ("user", "да"),
            ("assistant", "Starting the next task."),
            ("tool:exec", '{"cmd":"next"}'),
        ]

        tasks = split_session_tasks({"id": "conversation-unprompted-ack"}, entries)

        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[1][2][0], ("user", "да"))

    def test_each_task_keeps_its_own_request_timestamp(self):
        meta = {
            "id": "conversation-timestamps",
            "started_at": "2026-08-20T00:00:00Z",
        }
        entries = [
            ("user", "Old request", "2026-08-20T10:00:00Z"),
            ("assistant", "Done."),
            ("tool:exec", "{}"),
            ("user", "New request", "2026-08-30T10:00:00Z"),
            ("assistant", "Done."),
            ("tool:exec", "{}"),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(tasks[0][0]["started_at"], "2026-08-20T10:00:00Z")
        self.assertEqual(tasks[1][0]["started_at"], "2026-08-30T10:00:00Z")

    def test_warp_native_task_boundaries_and_skill_evidence_are_preserved(self):
        meta = {"id": "warp-conversation"}
        entries = [
            (
                "task_boundary",
                json.dumps({
                    "id": "native-parent",
                    "description": "Parent task",
                    "parent_task_id": None,
                }),
                "2026-08-30T10:00:00Z",
            ),
            ("user", "Parent request", "2026-08-30T10:00:00Z"),
            ("skill", '{"name":"anomaly-ui"}'),
            ("assistant", "Working."),
            ("tool:read", "{}"),
            (
                "task_boundary",
                json.dumps({
                    "id": "native-child",
                    "description": "Child task",
                    "parent_task_id": "native-parent",
                }),
                "2026-08-30T10:01:00Z",
            ),
            ("assistant", "Child work."),
            ("tool:read", "{}"),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0][0]["native_task_id"], "native-parent")
        self.assertIsNone(tasks[0][0]["native_parent_task_id"])
        self.assertEqual(tasks[0][0]["merged_child_task_ids"], ["native-child"])
        self.assertEqual(tasks[0][1]["tool_calls"], 2)
        self.assertEqual(
            detect_skills_from_entries(tasks[0][2], {"anomaly-ui"}),
            {"anomaly-ui"},
        )

    def test_warp_child_with_materialized_user_query_merges_into_parent(self):
        meta = {"id": "warp-conversation-with-child-query"}
        entries = [
            (
                "task_boundary",
                json.dumps({
                    "id": "native-parent",
                    "description": "Parent task",
                    "parent_task_id": None,
                }),
                "2026-08-30T10:00:00Z",
            ),
            ("user", "Real user request", "2026-08-30T10:00:00Z"),
            ("assistant", "Delegating."),
            ("tool:run_agents", "{}"),
            (
                "task_boundary",
                json.dumps({
                    "id": "native-child",
                    "description": "Child task",
                    "parent_task_id": "native-parent",
                }),
                "2026-08-30T10:01:00Z",
            ),
            (
                "user",
                "Agent-generated child brief",
                "2026-08-30T10:01:00Z",
            ),
            ("skill", '{"name":"anomaly-ui"}'),
            ("assistant", "Child work."),
            ("tool:read", "{}"),
        ]

        tasks = split_session_tasks(meta, entries)

        self.assertEqual(len(tasks), 1)
        task_meta, task_stats, task_entries = tasks[0]
        self.assertEqual(task_meta["native_task_id"], "native-parent")
        self.assertEqual(task_meta["merged_child_task_ids"], ["native-child"])
        self.assertEqual(task_stats["user_turns"], 2)
        self.assertEqual(task_stats["tool_calls"], 2)
        self.assertEqual(
            [entry[:2] for entry in task_entries],
            [entry[:2] for entry in entries if entry[0] != "task_boundary"],
        )
        self.assertEqual(
            detect_skills_from_entries(task_entries, {"anomaly-ui"}),
            {"anomaly-ui"},
        )

    def test_classifies_only_explicit_tool_failures(self):
        self.assertEqual(
            classify_tool_output('{"exit_code": 1, "output": "tests failed"}'),
            "failed",
        )
        self.assertEqual(
            classify_tool_output("Traceback (most recent call last):\nboom"),
            "failed",
        )
        self.assertEqual(
            classify_tool_output("operation not permitted by sandbox policy"),
            "environment_denial",
        )
        self.assertEqual(
            classify_tool_output("Applied patch to src/errors.ts successfully"),
            "ok",
        )
        self.assertEqual(
            classify_tool_output("Script failed with exit code 2"),
            "failed",
        )
        self.assertEqual(
            classify_tool_output("curl: (6) Could not resolve host: example.test"),
            "environment_denial",
        )
        self.assertEqual(
            classify_tool_output(
                "@@ -1 +1 @@\n- old\n+ message = 'permission denied'\n"
            ),
            "ok",
        )
        self.assertEqual(
            classify_tool_output(json.dumps([
                {"type": "text", "text": "Script failed with exit code 2"},
            ])),
            "failed",
        )
        self.assertEqual(
            classify_tool_output(
                "error connecting to api.github.com\ncheck your internet connection"
            ),
            "environment_denial",
        )
        self.assertEqual(
            classify_tool_output("note: permission denied is a documented example"),
            "ok",
        )

    def test_detects_nested_wait_tool_calls(self):
        self.assertTrue(
            is_wait_tool(
                "exec",
                "const result = await tools.write_stdin({session_id: 42});",
            )
        )
        self.assertFalse(
            is_wait_tool(
                "exec",
                "const result = await tools.exec_command({cmd: 'pytest'});",
            )
        )

    def test_parses_exact_since_boundary(self):
        cutoff = parse_since("2026-08-28T00:00:00Z")

        self.assertEqual(
            cutoff,
            datetime(2026, 8, 28, tzinfo=timezone.utc),
        )

    def test_since_records_effective_window_days_in_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex_home = root / "codex-home"
            codex_home.mkdir()
            out = root / "report"
            since = datetime.now(timezone.utc) - timedelta(hours=25)
            script = Path(__file__).resolve().parent / "collect_sessions.py"

            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--harness",
                    "codex",
                    "--codex-home",
                    str(codex_home),
                    "--repo",
                    str(root),
                    "--since",
                    since.isoformat(),
                    "--out",
                    str(out),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            inventory = json.loads((out / "inventory.json").read_text())
            self.assertEqual(inventory["window_days"], 2)
            self.assertEqual(
                inventory["window_start"],
                since.isoformat(),
            )

    def test_codex_injected_user_context_does_not_create_a_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            write_jsonl(path, [
                {
                    "type": "session_meta",
                    "timestamp": "2026-08-30T10:00:00Z",
                    "payload": {
                        "id": "codex-session",
                        "cwd": "/tmp/repo",
                        "timestamp": "2026-08-30T10:00:00Z",
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "<recommended_plugins>injected context</recommended_plugins>",
                        }],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "First request"}],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call",
                        "name": "exec",
                        "input": '{"cmd":"inspect"}',
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call_output",
                        "output": "Applied patch to src/errors.ts successfully",
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Done."}],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "Second request"}],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call",
                        "name": "exec",
                        "input": '{"cmd":"verify"}',
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Verified."}],
                    },
                },
            ])

            meta, stats, entries, _skills = parse_codex_session(path, set(), False)
            tasks = split_session_tasks(meta, entries)

            self.assertEqual(len(tasks), 2)
            self.assertEqual(tasks[0][2][0][:2], ("user", "First request"))
            self.assertEqual(tasks[1][2][0][:2], ("user", "Second request"))
            self.assertEqual(stats["user_turns"], 2)
            self.assertEqual(stats["assistant_turns"], 2)
            self.assertEqual(stats["failed_outputs"], 0)

    def test_claude_user_message_with_multiple_text_blocks_is_one_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            common = {
                "sessionId": "claude-multi-block",
                "cwd": "/tmp/repo",
                "timestamp": "2026-08-30T10:00:00Z",
            }
            write_jsonl(path, [
                {
                    **common,
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "One request, part A"},
                            {"type": "text", "text": "Part B"},
                        ],
                    },
                },
                {
                    **common,
                    "type": "assistant",
                    "message": {
                        "id": "assistant-multi-block",
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "Working."},
                            {
                                "type": "tool_use",
                                "name": "Read",
                                "input": {"path": "/tmp/repo/file.py"},
                            },
                        ],
                    },
                },
            ])

            meta, stats, entries, _skills = parse_claude_session(
                path,
                set(),
                False,
            )
            tasks = split_session_tasks(meta, entries)

            self.assertEqual(stats["user_turns"], 1)
            self.assertEqual(len(tasks), 1)
            self.assertEqual(
                tasks[0][2][0][:2],
                ("user", "One request, part A\nPart B"),
            )

    def test_codex_request_after_old_eight_megabyte_prefix_is_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout.jsonl"
            filler = {
                "type": "ignored",
                "payload": "x" * (8 * 1024 * 1024),
            }
            records = [
                filler,
                {
                    "type": "session_meta",
                    "timestamp": "2026-08-30T10:00:00Z",
                    "payload": {
                        "id": "large-session",
                        "cwd": "/tmp/repo",
                        "timestamp": "2026-08-30T10:00:00Z",
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "Tail request"}],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "custom_tool_call",
                        "name": "exec",
                        "input": '{"cmd":"verify tail"}',
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Done."}],
                    },
                },
            ]
            write_jsonl(path, records)

            meta, _stats, entries, _skills = parse_codex_session(path, set(), False)
            tasks = split_session_tasks(meta, entries)

            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0][2][0][:2], ("user", "Tail request"))

    def test_codex_source_records_with_same_session_id_get_unique_task_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            records = [
                {
                    "type": "session_meta",
                    "timestamp": "2026-08-30T10:00:00Z",
                    "payload": {
                        "id": "shared-session",
                        "cwd": "/tmp/repo",
                        "timestamp": "2026-08-30T10:00:00Z",
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "Request"}],
                    },
                },
            ]
            first = root / "first.jsonl"
            second = root / "second.jsonl"
            write_jsonl(first, records)
            write_jsonl(second, records)

            first_meta, _stats, first_entries, _skills = parse_codex_session(
                first, set(), False
            )
            second_meta, _stats, second_entries, _skills = parse_codex_session(
                second, set(), False
            )
            first_task = split_session_tasks(first_meta, first_entries)[0][0]
            second_task = split_session_tasks(second_meta, second_entries)[0][0]

            self.assertNotEqual(first_task["id"], second_task["id"])
            self.assertEqual(first_task["conversation_id"], "shared-session")
            self.assertEqual(second_task["conversation_id"], "shared-session")

    def test_discovers_skills_and_matches_sessions_across_projects(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first"
            second = root / "second"
            first_skill = first / ".agents" / "skills" / "alpha" / "SKILL.md"
            second_skill = second / ".claude" / "skills" / "beta" / "SKILL.md"
            first_skill.parent.mkdir(parents=True)
            second_skill.parent.mkdir(parents=True)
            first_skill.write_text("---\ndescription: Alpha\n---\n")
            second_skill.write_text("---\ndescription: Beta\n---\n")

            skills = discover_skills(
                [first, second],
                root / "codex-home",
                [],
                False,
            )

            self.assertEqual(set(skills), {"alpha", "beta"})
            self.assertTrue(
                session_matches_repos(second / "src", [first, second])
            )
            self.assertFalse(
                session_matches_repos(root / "elsewhere", [first, second])
            )

    def test_detects_skills_from_deferred_tool_entries(self):
        entries = [
            ("tool:Skill", '{"skill": "alpha"}'),
            ("tool:read", '{"path": "/repo/.agents/skills/beta/SKILL.md"}'),
            ("assistant", "Mentioning gamma here does not count."),
        ]

        self.assertEqual(
            detect_skills_from_entries(entries, {"alpha", "beta", "gamma"}),
            {"alpha", "beta"},
        )

    def test_discovers_parent_sessions_and_optional_subagents(self):
        with tempfile.TemporaryDirectory() as tmp:
            claude_home = Path(tmp)
            parent = claude_home / "projects" / "-repo" / "parent.jsonl"
            subagent = (
                claude_home
                / "projects"
                / "-repo"
                / "parent"
                / "subagents"
                / "agent-child.jsonl"
            )
            old = claude_home / "projects" / "-repo" / "old.jsonl"
            for path in (parent, subagent, old):
                write_jsonl(path, [{"type": "user"}])
            old_time = (datetime.now(timezone.utc) - timedelta(days=10)).timestamp()
            os.utime(old, (old_time, old_time))
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)

            parents = find_claude_session_files(claude_home, cutoff, False)
            with_subagents = find_claude_session_files(claude_home, cutoff, True)

            self.assertEqual([path for _, path in parents], [parent])
            self.assertEqual(
                {path for _, path in with_subagents},
                {parent, subagent},
            )

    def test_parses_messages_tools_skills_and_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session.jsonl"
            common = {
                "sessionId": "session-1",
                "cwd": "/tmp/repo",
                "timestamp": "2026-08-20T10:00:00Z",
                "version": "1.0.0",
            }
            write_jsonl(path, [
                {
                    **common,
                    "type": "user",
                    "uuid": "user-1",
                    "message": {"role": "user", "content": "Improve my skill"},
                },
                {
                    **common,
                    "type": "assistant",
                    "uuid": "assistant-1",
                    "message": {
                        "id": "message-1",
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "I will inspect it."},
                            {
                                "type": "tool_use",
                                "name": "Skill",
                                "input": {"skill": "update-skill"},
                            },
                        ],
                    },
                },
                {
                    **common,
                    "type": "assistant",
                    "uuid": "assistant-2",
                    "message": {
                        "id": "message-1",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "name": "Edit",
                                "input": {"file_path": "/tmp/repo/SKILL.md"},
                            }
                        ],
                    },
                },
                {
                    **common,
                    "type": "user",
                    "uuid": "result-1",
                    "message": {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "is_error": True,
                                "content": "permission denied",
                            }
                        ],
                    },
                },
            ])

            meta, stats, entries, skills = parse_claude_session(
                path,
                {"update-skill"},
                False,
            )

            self.assertEqual(meta["id"], "session-1")
            self.assertEqual(meta["cwd"], "/tmp/repo")
            self.assertEqual(stats["user_turns"], 1)
            self.assertEqual(stats["assistant_turns"], 1)
            self.assertEqual(stats["tool_calls"], 2)
            self.assertEqual(stats["failed_outputs"], 1)
            self.assertEqual(stats["environment_denials"], 1)
            self.assertTrue(stats["has_code_edits"])
            self.assertEqual(skills, ["update-skill"])
            self.assertIn(("user", "Improve my skill"), [entry[:2] for entry in entries])
            self.assertIn(("assistant", "I will inspect it."), entries)

    def test_excludes_sidechains_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent-child.jsonl"
            write_jsonl(path, [{
                "type": "user",
                "sessionId": "session-1",
                "agentId": "child-1",
                "isSidechain": True,
                "cwd": "/tmp/repo",
                "timestamp": "2026-08-20T10:00:00Z",
                "message": {"role": "user", "content": "Investigate"},
            }])

            self.assertIsNone(parse_claude_session(path, set(), False))
            parsed = parse_claude_session(path, set(), True)
            self.assertEqual(parsed[0]["id"], "session-1-child-1")
            self.assertEqual(parsed[0]["thread_source"], "subagent")


if __name__ == "__main__":
    unittest.main()
