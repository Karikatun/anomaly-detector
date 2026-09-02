#!/usr/bin/env python3
"""Tests for skill-doctor session collection."""

import json
import os
import subprocess
import sys
import tempfile
import time
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
    public_skill_records,
    render_transcript,
    session_matches_repos,
    split_session_tasks,
    transcript_path_for,
    redact_sensitive_text,
    truncate,
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
        self.assertIn("[LOCAL_PATH]", redacted)

    def test_redacts_common_workspace_paths_and_provider_key_shapes(self):
        aws_temporary_key = "ASIA" + "A" * 16
        google_api_key = "AIza" + "B" * 35
        source = (
            "/data/private/customer/repo/file.ts\n"
            "/mnt/secret-project/file.ts\n"
            "/workspace/client-x/file.ts\n"
            "Authorization = Digest private-auth-value\n"
            f"{aws_temporary_key}\n"
            f"{google_api_key}"
        )

        redacted = redact_sensitive_text(source)

        for private_value in (
            "/data/private", "/mnt/secret-project", "/workspace/client-x",
            "private-auth-value", aws_temporary_key, google_api_key,
        ):
            self.assertNotIn(private_value, redacted)
        self.assertIn("[LOCAL_PATH]", redacted)
        self.assertIn("[REDACTED TOKEN]", redacted)

    def test_truncate_large_unbroken_uppercase_output_completes_within_one_second(self):
        source = "A" * (10 * 1024 * 1024)

        started = time.perf_counter()
        truncated = truncate(source, 500)
        elapsed = time.perf_counter() - started

        self.assertTrue(truncated.startswith("A" * 100))
        self.assertIn("[truncated", truncated)
        self.assertLess(
            elapsed,
            1.0,
            f"truncate took {elapsed:.3f}s for a 10 MiB uppercase tool output",
        )

    def test_truncate_fully_redacts_long_secret_values(self):
        secret_marker = "MUST_NOT_LEAK_SECRET_PAYLOAD"
        cases = {
            "unterminated quoted assignment": (
                f'API_SECRET="{secret_marker}' + "x" * (1024 * 1024)
            ),
            "private key block": (
                "-----" "BEGIN PRIVATE KEY-----\n"
                f"{secret_marker}\n"
                + "A" * (1024 * 1024)
                + "\n-----" "END PRIVATE KEY-----"
            ),
        }

        for label, source in cases.items():
            with self.subTest(label=label):
                truncated = truncate(source, 500)

                self.assertNotIn(secret_marker, truncated)
                self.assertIn("[REDACTED", truncated)

    def test_truncate_redacts_jwt_that_crosses_output_boundary(self):
        visible_jwt_prefix = "eyJ" + "A" * 17
        jwt = "eyJ" + "A" * 9000 + "." + "B" * 16 + "." + "C" * 16
        source = "p" * 480 + jwt

        truncated = truncate(source, 500)

        self.assertNotIn(visible_jwt_prefix, truncated)
        self.assertIn("[REDACTED JWT]", truncated)

    def test_truncate_handles_repeated_jwt_prefixes_without_quadratic_growth(self):
        source = "eyJ" * (64 * 1024 // 3)

        started = time.perf_counter()
        truncated = truncate(source, 500)
        elapsed = time.perf_counter() - started

        self.assertTrue(truncated.startswith("eyJeyJ"))
        self.assertLess(
            elapsed,
            0.5,
            f"truncate took {elapsed:.3f}s for repeated JWT prefixes",
        )

    def test_redacts_extended_secret_names_and_command_flags(self):
        first_secret = "a" * 26 + "123456"
        second_secret = "z" * 26 + "654321"
        source = (
            f"SECRET_KEY_BASE={first_secret}\n"
            f"AWS_SECRET_ACCESS_KEY={second_secret}\n"
            f"tool --token {first_secret}"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn(first_secret, redacted)
        self.assertNotIn(second_secret, redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 3)

    def test_redacts_entire_authorization_header_value_for_any_scheme(self):
        headers = (
            "Authorization: Bearer opaque-access-token",
            "Authorization: Basic dXNlcjpwYXNzd29yZA==",
            "Authorization: Digest username=agent,response=private-response",
            "Authorization: ApiKey private-api-key",
            "Authorization: token private-token",
        )

        for source in headers:
            with self.subTest(source=source):
                redacted = redact_sensitive_text(source)
                self.assertEqual(redacted, "Authorization: [REDACTED]")
                self.assertEqual(redact_sensitive_text(redacted), redacted)

        metadata = "AuthorizationPolicy: token public-metadata"
        self.assertEqual(redact_sensitive_text(metadata), metadata)

    def test_redacts_structured_authorization_and_cookie_headers(self):
        cases = {
            "authorization": '{"Authorization":"Digest private-auth-value"}',
            "lowercase": '{"authorization":"Basic private-basic-value"}',
            "proxy": '{"Proxy-Authorization":"Bearer private-proxy-value"}',
            "cookie": '{"Cookie":"session=private-cookie-value"}',
            "set-cookie": '{"Set-Cookie":"session=private-set-cookie-value"}',
            "nested escaped": (
                r'{"headers":"{\"Authorization\":'
                r'\"ApiKey private-nested-value\"}"}'
            ),
            "authorization array": (
                '{"Authorization":["Bearer private-array-value"]}'
            ),
            "set-cookie array": (
                '{"Set-Cookie":["session=private-cookie-array-value"]}'
            ),
        }

        for label, source in cases.items():
            with self.subTest(label=label):
                redacted = redact_sensitive_text(source)
                self.assertNotIn("private-", redacted)
                self.assertIn("[REDACTED]", redacted)

    def test_redacts_standalone_bearer_session_cookie_and_home_paths(self):
        source = (
            "token response: Bearer opaque-private-bearer-value\n"
            "SESSION_COOKIE=opaque-private-session-value\n"
            "~/.ssh/id_ed25519\n"
            "$HOME/.config/private/credentials.json"
        )

        redacted = redact_sensitive_text(source)

        for private_value in (
            "opaque-private-bearer-value",
            "opaque-private-session-value",
            "id_ed25519",
            "credentials.json",
        ):
            self.assertNotIn(private_value, redacted)
        self.assertIn("Bearer [REDACTED]", redacted)
        self.assertIn("[LOCAL_PATH]", redacted)

    def test_redacts_entire_compact_jws_and_jwe_tokens(self):
        unsigned_jws = "eyJ" + "A" * 16 + "." + "B" * 16 + "."
        compact_jwe = (
            "eyJ" + "C" * 16 + "." + "D" * 16 + "." + "E" * 16
            + ".PRIVATECIPHERTEXT." + "F" * 16
        )
        direct_jwe = (
            "eyJ" + "G" * 16 + ".." + "H" * 16
            + ".PRIVATECIPHERTEXT." + "I" * 16
        )

        for token in (unsigned_jws, compact_jwe, direct_jwe):
            with self.subTest(token=token[:24]):
                redacted = redact_sensitive_text(f"payload={token}")
                self.assertNotIn("PRIVATECIPHERTEXT", redacted)
                self.assertNotIn(token, redacted)
                self.assertIn("[REDACTED JWT]", redacted)

    def test_redacts_bracketed_named_secret_assignments(self):
        source = (
            'os.environ["AWS_SECRET_ACCESS_KEY"] = "first-private-value"\n'
            'config["API_TOKEN"]="second-private-value"'
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("first-private-value", redacted)
        self.assertNotIn("second-private-value", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 2)

    def test_redacts_short_named_secret_values(self):
        source = "PASSWORD=hunter2\ntool --token abc1234"

        redacted = redact_sensitive_text(source)

        self.assertNotIn("hunter2", redacted)
        self.assertNotIn("abc1234", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 2)

    def test_redacts_json_escaped_and_nested_serialized_secret_values(self):
        cases = {
            "escaped double quote": (
                r'{"cmd":"export AUTH_SECRET=\"json-double-secret\" && run"}',
                "json-double-secret",
            ),
            "escaped single quote": (
                r'''{"cmd":"export PASSWORD=\'json-single-secret\' && run"}''',
                "json-single-secret",
            ),
            "nested serialized object": (
                json.dumps({
                    "payload": json.dumps({"password": "nested-json-secret"}),
                }),
                "nested-json-secret",
            ),
        }

        for label, (source, secret) in cases.items():
            with self.subTest(label=label):
                redacted = redact_sensitive_text(source)
                self.assertNotIn(secret, redacted)
                self.assertIn("[REDACTED]", redacted)

    def test_preserves_names_that_only_contain_sensitive_substrings(self):
        source = (
            "tokenizer: natural-language-component\n"
            "secretary=office-contact\n"
            "passwordless: enabled-by-webauthn"
        )

        self.assertEqual(redact_sensitive_text(source), source)

    def test_redacts_plural_and_uppercase_concatenated_secret_names(self):
        source = (
            "secrets=first-private-value\n"
            "passwords=second-private-value\n"
            "tokens=third-private-value\n"
            "AUTHSECRET=fourth-private-value\n"
            "ACCESSTOKEN=fifth-private-value"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("private-value", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 5)
        self.assertEqual(redact_sensitive_text(redacted), redacted)

    def test_preserves_noncredential_token_and_password_metadata(self):
        source = (
            "token_budget=10000\n"
            "token_type=Bearer\n"
            "password_policy=minimum-eight\n"
            "max_output_tokens=12000\n"
            "max_tokens=4000\n"
            "SECRET_VALUE_PATTERN=compiled-regex\n"
            "passwordResetTokenSchema=public-schema\n"
            "cached_tokens=123\n"
            "tokens_per_second=42\n"
            "num_tokens=7\n"
            "token_expiry=1700000000"
        )

        self.assertEqual(redact_sensitive_text(source), source)

    def test_redacts_private_key_assignments_and_uri_userinfo(self):
        source = (
            "PRIVATE_KEY=base64privatekeyhere\n"
            "REDIS_URL=redis://:s3cr3t@localhost:6379/0\n"
            "SERVICE_URL=https://agent:private-password@example.test/api"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("base64privatekeyhere", redacted)
        self.assertNotIn("s3cr3t", redacted)
        self.assertNotIn("private-password", redacted)
        self.assertGreaterEqual(redacted.count("[REDACTED]"), 3)

    def test_redacts_camel_case_private_key_in_assignments_json_and_flags(self):
        source = (
            "privateKey=opaquevalueone\n"
            '{"privateKey":"opaquevaluetwo"}\n'
            "tool --privateKey opaquevaluethree\n"
            "PRIVATEKEY=opaquevaluefour\n"
            "privateKeys=opaquevaluefive\n"
            "PRIVATEKEYS=opaquevaluesix\n"
            "APIKEYS=opaquevalueseven"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("opaquevalue", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 7)

    def test_redacts_exact_master_encryption_and_signing_key_compounds(self):
        source = (
            "RAILS_MASTER_KEY=opaquevaluerails\n"
            "MASTER_KEY=opaquevaluemaster\n"
            "ENCRYPTION_KEY=opaquevalueencryption\n"
            "SIGNING_KEY=opaquevaluesigning\n"
            "FERNET_KEY=opaquevaluefernet"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("opaquevalue", redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 5)

    def test_redacts_collection_valued_named_secrets(self):
        source = (
            'TOKENS=["secret-one", {"nested": "secret-two"}]\n'
            'PASSWORD={"value":"hunter2","nested":["secret-three"]}'
        )

        redacted = redact_sensitive_text(source)

        for secret in ("secret-one", "secret-two", "secret-three", "hunter2"):
            self.assertNotIn(secret, redacted)
        self.assertEqual(redacted.count("[REDACTED]"), 2)

    def test_redacts_pgp_and_digit_bearing_private_key_armor(self):
        source = (
            "-----" "BEGIN PGP PRIVATE KEY BLOCK-----\n"
            "PGP_PRIVATE_MATERIAL\n"
            "-----" "END PGP PRIVATE KEY BLOCK-----\n"
            "-----" "BEGIN ED25519 PRIVATE KEY-----\n"
            "ED25519_PRIVATE_MATERIAL\n"
            "-----" "END ED25519 PRIVATE KEY-----"
        )

        redacted = redact_sensitive_text(source)

        self.assertNotIn("PGP_PRIVATE_MATERIAL", redacted)
        self.assertNotIn("ED25519_PRIVATE_MATERIAL", redacted)
        self.assertEqual(redacted.count("[REDACTED PRIVATE KEY]"), 2)

    def test_redacts_sensitive_assignment_nested_in_nonsensitive_wrapper(self):
        source = "patch=PASSWORD=hunter2"

        redacted = redact_sensitive_text(source)

        self.assertEqual(redacted, "patch=PASSWORD=[REDACTED]")
        self.assertEqual(redact_sensitive_text(redacted), redacted)

    def test_redacts_each_sensitive_value_in_minified_multi_assignment_payload(self):
        source = (
            "payload=user=anton&PASSWORD=hunter2&"
            "API_TOKEN=abc1234&mode=fast"
        )

        redacted = redact_sensitive_text(source)

        self.assertEqual(
            redacted,
            "payload=user=anton&PASSWORD=[REDACTED]&"
            "API_TOKEN=[REDACTED]&mode=fast",
        )
        self.assertEqual(redact_sensitive_text(redacted), redacted)

    def test_nested_secret_overlap_handling_completes_in_linear_time(self):
        unit = "patch=PASSWORD=hunter2&"
        elapsed = []
        for size in (256 * 1024, 1024 * 1024):
            source = unit * (size // len(unit))
            started = time.perf_counter()
            redacted = redact_sensitive_text(source)
            elapsed.append(time.perf_counter() - started)
            self.assertEqual(redacted.count("hunter2"), 0)

        self.assertLess(
            elapsed[1],
            1.0,
            f"nested secret redaction took {elapsed[1]:.3f}s for 1 MiB",
        )
        self.assertLess(
            elapsed[1],
            elapsed[0] * 8 + 0.1,
            f"nested secret redaction scaled {elapsed[0]:.3f}s -> {elapsed[1]:.3f}s",
        )

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

    def test_warp_native_description_is_bounded_and_redacted(self):
        meta = {"id": "warp-sensitive-description"}
        entries = [
            (
                "task_boundary",
                json.dumps({
                    "id": "native-parent",
                    "description": "PASSWORD=private-description-value",
                    "parent_task_id": None,
                }),
                "2026-08-30T10:00:00Z",
            ),
            ("user", "Parent request", "2026-08-30T10:00:00Z"),
            ("assistant", "Working."),
            ("tool:read", "{}"),
        ]

        task_meta, _stats, _task_entries = split_session_tasks(meta, entries)[0]

        self.assertNotIn("private-description-value", task_meta["native_description"])
        self.assertEqual(task_meta["native_description"], "PASSWORD=[REDACTED]")

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
            initialize_repository(root)
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

    def test_inventory_and_transcript_expose_only_the_scoring_projection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "PRIVATE_PROJECT_METADATA"
            initialize_repository(repo)
            codex_home = root / "PRIVATE_CODEX_HOME"
            session_path = (
                codex_home
                / "sessions"
                / "PRIVATE_HISTORY_DIRECTORY"
                / "rollout-PRIVATE_HISTORY_RECORD.jsonl"
            )
            out = root / "PRIVATE_REPORT_ROOT"
            skill_path = (
                repo
                / ".agents"
                / "skills"
                / "privacy-audit"
                / "SKILL.md"
            )
            skill_path.parent.mkdir(parents=True)
            skill_path.write_text(
                "---\n"
                "name: privacy-audit\n"
                "description: PASSWORD=PRIVATE_SKILL_FRONTMATTER_SECRET\n"
                "---\n"
            )

            started_at = datetime.now(timezone.utc).isoformat()
            raw_session_id = (
                "PRIVATE_SESSION_ID-"
                "PRIVATE_CONVERSATION_ID-"
                "PRIVATE_NATIVE_TASK_ID"
            )
            write_jsonl(session_path, [
                {
                    "type": "session_meta",
                    "timestamp": started_at,
                    "payload": {
                        "id": raw_session_id,
                        "cwd": str(repo),
                        "timestamp": started_at,
                        "originator": "PRIVATE_ORIGINATOR_METADATA",
                        "thread_source": "root",
                        "cli_version": "PRIVATE_CLI_VERSION_METADATA",
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": started_at,
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "Review the private sample",
                        }],
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": started_at,
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{
                            "type": "output_text",
                            "text": "I will inspect the evidence.",
                        }],
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": started_at,
                    "payload": {
                        "type": "custom_tool_call",
                        "name": "PRIVATE_TOOL_EXECUTOR",
                        "input": json.dumps({
                            "path": str(skill_path),
                            "action": "apply_patch",
                        }),
                    },
                },
                {
                    "type": "response_item",
                    "timestamp": started_at,
                    "payload": {
                        "type": "custom_tool_call_output",
                        "output": "Applied patch successfully",
                    },
                },
            ])

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
                    str(repo),
                    "--max-tasks",
                    "1",
                    "--out",
                    str(out),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            inventory = json.loads((out / "inventory.json").read_text())
            inventory_text = json.dumps(inventory, ensure_ascii=False)
            private_values = (
                "PRIVATE_SESSION_ID",
                "PRIVATE_CONVERSATION_ID",
                "PRIVATE_NATIVE_TASK_ID",
                "PRIVATE_ORIGINATOR_METADATA",
                "PRIVATE_CLI_VERSION_METADATA",
                "PRIVATE_PROJECT_METADATA",
                "PRIVATE_CODEX_HOME",
                "PRIVATE_HISTORY_DIRECTORY",
                "PRIVATE_HISTORY_RECORD",
                "PRIVATE_REPORT_ROOT",
                "PRIVATE_SKILL_FRONTMATTER_SECRET",
                str(repo),
                str(codex_home),
                str(session_path),
                str(out),
                str(skill_path),
            )
            for private_value in private_values:
                with self.subTest(artifact="inventory", value=private_value):
                    self.assertFalse(
                        private_value in inventory_text,
                        f"inventory leaked {private_value!r}",
                    )

            sampled = [task for task in inventory["tasks"] if task["sampled"]]
            self.assertEqual(len(sampled), 1)
            task = sampled[0]
            transcript_files = list((out / "transcripts").glob("*.md"))
            self.assertEqual(len(transcript_files), 1)
            transcript = transcript_files[0].read_text()
            for private_value in (*private_values, "PRIVATE_TOOL_EXECUTOR"):
                with self.subTest(artifact="transcript", value=private_value):
                    self.assertFalse(
                        private_value in transcript,
                        f"transcript leaked {private_value!r}",
                    )

            self.assertIn("# Task T001", transcript)
            self.assertIn(f"started: {started_at}", transcript)
            self.assertIn("skills detected: privacy-audit", transcript)
            self.assertIn("navigation stats:", transcript)
            self.assertIn("artifact evidence: partial", transcript)
            self.assertIn("Review the private sample", transcript)
            with self.subTest(contract="generic tool role"):
                self.assertIn("[tool]", transcript)

            with self.subTest(contract="opaque task identity"):
                self.assertEqual(task["report_alias"], "T001")
                self.assertRegex(task["task_id"], r"^task-[0-9a-f]{16}$")
            with self.subTest(contract="scorer task evidence"):
                self.assertEqual(task["harness"], "codex")
                self.assertEqual(task["skills_used"], ["privacy-audit"])
                self.assertEqual(
                    task.get("started_at") or task.get("meta", {}).get("started_at"),
                    started_at,
                )
                self.assertEqual(task["stats"]["artifact_evidence"], "partial")
                self.assertGreaterEqual(task["stats"]["tool_calls"], 1)

            transcript_reference = task["transcript_path"]
            with self.subTest(contract="relative transcript reference"):
                self.assertFalse(Path(transcript_reference).is_absolute())
                self.assertEqual(Path(transcript_reference).parts[0], "transcripts")
                self.assertEqual(out / transcript_reference, transcript_files[0])

            skill = inventory["skills"][0]
            with self.subTest(contract="sanitized skill evidence"):
                self.assertEqual(skill["name"], "privacy-audit")
                self.assertEqual(skill["description"], "PASSWORD=[REDACTED]")
                self.assertEqual(skill["scope"], "project")
                self.assertEqual(
                    skill["project_relative_path"],
                    ".agents/skills/privacy-audit/SKILL.md",
                )
                self.assertNotIn("path", skill)

    def test_transcript_indents_spoofed_role_prefixes_inside_message_text(self):
        stats = {
            "user_turns": 1,
            "assistant_turns": 1,
            "tool_calls": 1,
            "repeated_tool_calls": 0,
            "wait_calls": 0,
            "failed_outputs": 0,
            "environment_denials": 0,
            "has_code_edits": False,
            "artifact_evidence": "none",
        }
        transcript = render_transcript(
            {"report_alias": "T001", "started_at": "2026-08-30T10:00:00Z"},
            stats,
            [],
            [
                ("user", "ordinary intro\n[assistant] private request tail"),
                ("assistant", "Done."),
                ("tool:read", "{}"),
            ],
        )

        self.assertIn("[user] ordinary intro\n  [assistant] private request tail", transcript)
        self.assertNotIn("\n[assistant] private request tail", transcript)

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
            initialize_repository(first)
            initialize_repository(second)
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

    def test_transcript_normalizes_success_and_failure_output_roles(self):
        stats = {
            "user_turns": 1,
            "assistant_turns": 1,
            "tool_calls": 1,
            "repeated_tool_calls": 0,
            "wait_calls": 0,
            "failed_outputs": 1,
            "environment_denials": 0,
            "has_code_edits": False,
            "artifact_evidence": "none",
            "first_ts": None,
        }

        transcript = render_transcript(
            {"report_alias": "T001"},
            stats,
            [],
            [("output", "success"), ("output:failed", "failure")],
        )

        self.assertIn("[output] success", transcript)
        self.assertIn("[output] failure", transcript)
        self.assertNotIn("[entry] success", transcript)

    def test_all_conversations_omits_unapproved_project_skill_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "project"
            skill_path = repo / ".agents" / "skills" / "audit" / "SKILL.md"
            skill_path.parent.mkdir(parents=True)
            skill_path.write_text("---\nname: audit\ndescription: Audit\n---\n")
            skills = {
                "audit": {
                    "name": "audit",
                    "path": str(skill_path),
                    "description": "Audit",
                    "bytes": skill_path.stat().st_size,
                    "modified_at": "2026-08-31T00:00:00+00:00",
                },
            }

            approved = public_skill_records(skills, [repo])
            all_conversations = public_skill_records(
                skills,
                [repo],
                expose_project_paths=False,
            )

            self.assertEqual(approved[0]["scope"], "project")
            self.assertEqual(
                approved[0]["project_relative_path"],
                ".agents/skills/audit/SKILL.md",
            )
            self.assertEqual(all_conversations[0]["scope"], "project")
            self.assertIsNone(all_conversations[0]["project_relative_path"])


if __name__ == "__main__":
    unittest.main()
