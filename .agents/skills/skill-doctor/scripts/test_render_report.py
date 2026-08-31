#!/usr/bin/env python3
"""Tests for skill-doctor report rendering."""

import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch

from render_report import (
    PrivacyError,
    ReportContractError,
    embedded_diffs_script,
    format_generated_at,
    inventory_sensitive_values,
    open_report,
    parse_args,
    render_page,
    validate_report_aggregation,
    validate_report_privacy,
    validate_report_schema,
)


class ReportRendererTests(unittest.TestCase):
    def test_privacy_gate_rejects_extended_paths_headers_and_jwts(self):
        unsafe_values = [
            "/opt/private/model.bin",
            "/workspace/private/model.bin",
            "D:/work/private/report.txt",
            r"\\server\share\private.txt",
            "file:///root/private/report.txt",
            "Cookie: session=private-value",
            "eyJabcdefghij.eyJklmnopqrst.uvwxyzabcdefgh",
            "ASIA" + "A" * 16,
            "AIza" + "B" * 35,
            "Authorization = Digest private-value",
            "redis://:private-password@localhost:6379/0",
            "RAILS_MASTER_KEY=abcdef0123456789abcdef0123456789",
        ]

        for value in unsafe_values:
            with self.subTest(value=value), self.assertRaises(PrivacyError):
                validate_report_privacy({"top_findings": [{"summary": value}]})

    def test_privacy_gate_rejects_verbatim_user_text_from_transcript(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            transcript = root / "task.md"
            private_request = "Keep this exact private request out of the report."
            transcript.write_text(
                "# Task T001\n\n[user] " + private_request + "\n\n[assistant] Done.\n"
            )
            inventory = {"tasks": [{"transcript_path": str(transcript)}]}
            sensitive = inventory_sensitive_values(inventory, root / "report.json")

            with self.assertRaises(PrivacyError):
                validate_report_privacy(
                    {"top_findings": [{"summary": private_request}]},
                    sensitive,
                )
            with self.assertRaises(PrivacyError):
                validate_report_privacy(
                    {"top_findings": [{"summary": "exact private request out"}]},
                    sensitive,
                )

    def test_privacy_gate_resolves_relative_transcript_from_report_directory(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            transcript = root / "transcripts" / "task.md"
            transcript.parent.mkdir()
            private_request = "Never publish this relative transcript request."
            transcript.write_text(
                "# Task T001\n\n[user] " + private_request + "\n\n[assistant] Done.\n"
            )
            inventory = {"tasks": [{"transcript_path": "transcripts/task.md"}]}
            sensitive = inventory_sensitive_values(inventory, root / "report.json")

            with self.assertRaises(PrivacyError):
                validate_report_privacy(
                    {"top_findings": [{"summary": private_request}]},
                    sensitive,
                )

    def test_v2_privacy_gate_fails_closed_on_missing_or_escaping_transcript(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for transcript_path in ("transcripts/missing.md", "../outside.md"):
                inventory = {
                    "methodology_version": 2,
                    "tasks": [{
                        "sampled": True,
                        "transcript_path": transcript_path,
                    }],
                }
                with self.subTest(path=transcript_path), self.assertRaises(
                    ReportContractError
                ):
                    inventory_sensitive_values(inventory, root / "report.json")

    def test_v2_privacy_gate_rejects_readable_absolute_transcript(self):
        with TemporaryDirectory() as report_dir, TemporaryDirectory() as outside_dir:
            report_root = Path(report_dir)
            outside = Path(outside_dir) / "task.md"
            outside.write_text("# Task T001\n\n[user] private request\n")
            inventory = {
                "methodology_version": 2,
                "tasks": [{
                    "sampled": True,
                    "transcript_path": str(outside),
                }],
            }

            with self.assertRaises(ReportContractError):
                inventory_sensitive_values(inventory, report_root / "report.json")

    def test_inventory_marks_plural_identifier_fields_sensitive(self):
        with TemporaryDirectory() as temp_dir:
            private_id = "private-child-task-identifier"
            inventory = {"merged_child_task_ids": [private_id], "tasks": []}
            sensitive = inventory_sensitive_values(
                inventory,
                Path(temp_dir) / "report.json",
            )

            with self.assertRaises(PrivacyError):
                validate_report_privacy(
                    {"top_findings": [{"summary": private_id}]},
                    sensitive,
                )

    def test_inventory_marks_project_relative_skill_path_sensitive(self):
        private_path = "clients/private-codename/.agents/skills/a/SKILL.md"
        inventory = {"project_relative_path": private_path, "tasks": []}
        sensitive = inventory_sensitive_values(inventory, Path("report.json"))

        with self.assertRaises(PrivacyError):
            validate_report_privacy(
                {"top_findings": [{"summary": private_path}]},
                sensitive,
            )

    def test_v2_schema_binds_card_fields_and_stats_to_inventory(self):
        inventory = {
            "harness": "codex",
            "repo_name": "example",
            "window_days": 3,
            "stats": {
                "tasks_sampled": 2,
                "conversation_records_in_window": 4,
                "skills_found": 3,
                "skills_used": 1,
            },
        }
        report = {
            "methodology_version": 2,
            "title": "Agent Skill Report",
            "generated_at": "2026-08-31T12:00:00Z",
            "harness": "codex",
            "handle": "example",
            "stats": {
                "tasks_analyzed": 2,
                "conversations_scanned": 4,
                "skills_found": 3,
                "skills_used": 1,
                "window_days": 3,
            },
            "scores": {},
            "coverage": {},
            "failed_task_aliases": [],
            "top_findings": [
                {"summary": "One", "disposition": "no_change", "reason": "Safe."},
                {"summary": "Two", "disposition": "no_change", "reason": "Safe."},
                {"summary": "Three", "disposition": "no_change", "reason": "Safe."},
            ],
            "workflow_recommendations": [],
            "skill_edits": [],
        }

        validate_report_schema(report, inventory)
        report["skill_edits"] = [{
            "skill": "example-skill",
            "change": "Clarify the trigger.",
            "evidence": "T001 missed the trigger.",
            "proposed_path": "proposed/example-skill/SKILL.md",
            "diff": (
                "--- a/example-skill/SKILL.md\n"
                "+++ b/example-skill/SKILL.md\n"
                "@@ -1 +1 @@\n-old\n+new\n"
            ),
        }]
        validate_report_schema(report, inventory)
        report["skill_edits"][0]["diff"] = (
            "--- ../../private/SKILL.md\n+++ ../../private/SKILL.md\n"
        )
        with self.assertRaises(ReportContractError):
            validate_report_schema(report, inventory)
        report["skill_edits"] = []
        report["handle"] = "private prose"
        with self.assertRaises(ReportContractError):
            validate_report_schema(report, inventory)

    def test_v2_report_must_match_aggregation_and_failed_task_aliases(self):
        inventory = {
            "tasks": [
                {"task_id": "private-task-1", "report_alias": "T001"},
                {"task_id": "private-task-2", "report_alias": "T002"},
            ]
        }
        aggregation = {
            "scores": {
                "efficiency": 0.8,
                "code_quality": None,
                "skill_coverage": 0.5,
                "overall": 0.75,
            },
            "coverage": {
                "eligible_tasks": 1,
                "covered_tasks": 1,
                "eligible_skill_opportunities": 2,
                "covered_skill_opportunities": 1,
                "code_quality_evidence_tasks": 0,
            },
            "failed_tasks": ["private-task-2"],
        }
        report = {
            "scores": dict(aggregation["scores"]),
            "coverage": dict(aggregation["coverage"]),
            "failed_task_aliases": ["T002"],
        }

        validate_report_aggregation(report, aggregation, inventory)
        report["scores"]["overall"] = 0.9
        with self.assertRaises(ReportContractError):
            validate_report_aggregation(report, aggregation, inventory)

    def test_v2_report_rejects_failed_task_alias_drift(self):
        inventory = {
            "tasks": [{"task_id": "private-task-1", "report_alias": "T001"}]
        }
        aggregation = {
            "scores": {"overall": 0.8},
            "coverage": {"eligible_tasks": 0},
            "failed_tasks": ["private-task-1"],
        }
        report = {
            "scores": {"overall": 0.8},
            "coverage": {"eligible_tasks": 0},
            "failed_task_aliases": [],
        }

        with self.assertRaises(ReportContractError):
            validate_report_aggregation(report, aggregation, inventory)

    def test_privacy_gate_rejects_paths_ids_and_secrets_without_echoing_them(self):
        unsafe_values = [
            "/Users/alice/private/project/file.py",
            "01a0545f-bda5-7212-b218-a1a2e1adace8",
            "ghp_" + "a" * 36,
            "opaque-private-task-id",
        ]

        for value in unsafe_values:
            with self.subTest(value=value):
                report = {"top_findings": [{"summary": value}]}
                exact = {value} if value == "opaque-private-task-id" else set()
                with self.assertRaises(PrivacyError) as caught:
                    validate_report_privacy(report, exact)
                self.assertNotIn(value, str(caught.exception))

    def test_safe_labeled_diff_round_trips_through_privacy_gate(self):
        diff = (
            "--- a/example-skill/SKILL.md\n"
            "+++ b/example-skill/SKILL.md\n"
            "@@ -1 +1 @@\n"
            "-old https://example.com/docs\n"
            "+new src/example.py\n"
        )
        report = {
            "scores": {
                "efficiency": 0.8,
                "code_quality": None,
                "skill_coverage": None,
                "overall": 0.8,
            },
            "skill_edits": [{
                "skill": "example-skill",
                "change": "Clarify one step.",
                "diff": diff,
                "proposed_path": "proposed/example-skill/SKILL.md",
            }],
        }

        validate_report_privacy(report)
        page = render_page(report)

        self.assertIn("--- a/example-skill/SKILL.md", page)
        self.assertIn("+++ b/example-skill/SKILL.md", page)
    def test_skill_startup_contract_is_centralized(self):
        skill_root = Path(__file__).resolve().parent.parent
        skill_text = (skill_root / "SKILL.md").read_text()
        harness_text = (
            skill_root / "references" / "supported-harnesses.md"
        ).read_text()

        self.assertIn(
            "$SKILL_ROOT/references/supported-harnesses.md",
            skill_text,
        )
        self.assertIn("Conversations in this repository", skill_text)
        self.assertIn("All conversations", skill_text)
        self.assertIn("Choose projects to analyze", skill_text)
        self.assertIn(
            "Project skills + global skills",
            skill_text,
        )
        self.assertIn("Project skills only", skill_text)
        self.assertIn(
            "Scoring is based on efficiency and code quality for the sampled "
            "tasks, not whole multi-request conversations",
            skill_text,
        )
        self.assertIn(
            "Process datasets of 50 transcripts or fewer in one batch",
            skill_text,
        )
        self.assertIn(
            "For larger datasets, use parallel batches of about 20",
            skill_text,
        )
        self.assertNotIn("--harness claude|codex|warp", skill_text)
        self.assertNotIn("--claude-home PATH", skill_text)
        self.assertIn("| Warp | `warp` |", harness_text)
        self.assertIn("| Claude Code | `claude` |", harness_text)
        self.assertIn("| Codex | `codex` |", harness_text)
        self.assertIn("stop before creating a report directory", harness_text)

    def test_code_diffs_follow_os_theme(self):
        bundle = embedded_diffs_script()

        self.assertIn('themeType:"system"', bundle)
        self.assertIn(
            'theme:{dark:"pierre-dark",light:"pierre-light"}',
            bundle,
        )

    def test_report_follows_os_theme(self):
        page = render_page({
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
        })

        self.assertIn('<meta name="color-scheme" content="light dark">', page)
        self.assertIn("@media (prefers-color-scheme: dark)", page)
        self.assertIn("--page-bg: #0f0d14", page)
        self.assertIn("background: var(--surface)", page)
        self.assertIn(
            "--mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            page,
        )
        self.assertIn("--diffs-font-family: var(--mono-font)", page)
        self.assertIn("--diffs-header-font-family: var(--mono-font)", page)

    def test_report_has_no_factories_promotion(self):
        report = {
            "title": "Agent Skill Report",
            "generated_at": "2026-08-25T00:00:00Z",
            "harness": "codex",
            "handle": "example",
            "stats": {
                "sessions_analyzed": 1,
                "sessions_scanned": 1,
                "skills_found": 1,
                "skills_used": 1,
                "window_days": 45,
            },
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
            "top_findings": ["No material waste detected."],
            "suggestions": [],
        }

        page = render_page(report)

        self.assertNotIn("Warp Factories", page)
        self.assertNotIn("request-access", page)
        self.assertNotIn("factories-footer", page)
        self.assertNotIn("all analysis ran locally", page)
        self.assertIn(
            "Generated August 25, 2026 at 12:00 AM UTC &middot; harness: codex",
            page,
        )

    def test_report_separates_workflow_recommendations_from_skill_edits(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": 0.5,
                "overall": 0.8,
            },
            "workflow_recommendations": [{
                "owner": "Project workflow",
                "change": "Run the narrow validation before the full suite.",
                "evidence": "Two tasks repeated the same broad test run.",
                "expected_effect": "Shorter feedback loops.",
            }],
            "skill_edits": [{
                "skill": "tdd",
                "change": "Add the repository's narrow validation command.",
                "evidence": "The command was rediscovered in task 7.",
                "proposed_path": "proposed/tdd/SKILL.md",
                "diff": "--- a/SKILL.md\n+++ b/SKILL.md",
            }],
        })

        workflow_heading = page.index("<h2>Workflow recommendations</h2>")
        workflow_change = page.index("Run the narrow validation before the full suite.")
        skill_heading = page.index("<h2>Suggested skill changes</h2>")
        skill_change = page.index("Add the repository&#x27;s narrow validation command.")

        self.assertLess(workflow_heading, workflow_change)
        self.assertLess(workflow_change, skill_heading)
        self.assertLess(skill_heading, skill_change)
        self.assertIn("Project workflow", page)
        self.assertIn("Two tasks repeated the same broad test run.", page)
        self.assertIn("Shorter feedback loops.", page)

    def test_workflow_recommendations_remain_when_skill_edits_are_empty(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": 0.5,
                "overall": 0.8,
            },
            "workflow_recommendations": ["Keep the audit scope bounded."],
            "skill_edits": [],
            "suggestions": [{
                "skill": "legacy-must-not-leak",
                "change": "This fallback must not replace an explicit empty list.",
            }],
        })

        self.assertIn("Keep the audit scope bounded.", page)
        self.assertIn("No skill change cleared the bar for this window.", page)
        self.assertNotIn("legacy-must-not-leak", page)

    def test_finding_disposition_explains_why_no_change_is_recommended(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": 0.5,
                "overall": 0.8,
            },
            "top_findings": [{
                "summary": "The task spent time on broad discovery.",
                "disposition": "No change",
                "reason": "The discovery was necessary for an unfamiliar repository.",
            }, "Legacy string finding."],
            "workflow_recommendations": [],
            "skill_edits": [],
        })

        self.assertIn("The task spent time on broad discovery.", page)
        self.assertIn("Disposition: No change", page)
        self.assertIn(
            "Reason: The discovery was necessary for an unfamiliar repository.",
            page,
        )
        self.assertIn("Legacy string finding.", page)

    def test_legacy_suggestions_render_as_skill_edits(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": 0.5,
                "overall": 0.8,
            },
            "suggestions": [{
                "skill": "legacy-skill",
                "change": "Preserve old report compatibility.",
            }],
        })

        self.assertIn("<h2>Suggested skill changes</h2>", page)
        self.assertIn("legacy-skill", page)
        self.assertIn("Preserve old report compatibility.", page)

    def test_null_skill_coverage_renders_na_while_overall_still_renders(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": None,
                "overall": 0.82,
            },
        })

        self.assertIn('<span class="bar-name">Skill Coverage</span>', page)
        self.assertIn('<span class="bar-val">N/A</span>', page)
        self.assertIn('<div class="grade-label">overall 82</div>', page)
        self.assertIn('["Skill Coverage", null]', page)

    def test_null_code_quality_renders_na(self):
        page = render_page({
            "scores": {
                "efficiency": 0.8,
                "code_quality": None,
                "skill_coverage": 1.0,
                "overall": 0.85,
            },
        })

        self.assertIn('<span class="bar-name">Code Quality</span>', page)
        self.assertIn('["Code Quality", null]', page)
        self.assertIn('<div class="grade-label">overall 85</div>', page)

    def test_report_labels_scored_work_as_tasks(self):
        page = render_page({
            "stats": {
                "tasks_analyzed": 7,
                "conversations_scanned": 11,
                "window_days": 30,
            },
            "scores": {
                "efficiency": 0.8,
                "code_quality": 0.9,
                "skill_coverage": 0.5,
                "overall": 0.8,
            },
        })

        self.assertIn('<div class="lbl">tasks scored</div>', page)
        self.assertIn('"meta": "7 tasks scored \\u00b7 last 30 days"', page)
        self.assertIn('["7", "tasks scored"]', page)
        self.assertNotIn("conversations scored", page)
        self.assertNotIn("conversations found", page)

    def test_report_accepts_collector_stats_without_manual_renaming(self):
        page = render_page({
            "stats": {
                "tasks_sampled": 6,
                "conversation_records_in_window": 9,
                "window_days": 3,
            },
            "scores": {
                "efficiency": 0.8,
                "code_quality": None,
                "skill_coverage": None,
                "overall": 0.8,
            },
        })

        self.assertIn('"meta": "6 tasks scored \\u00b7 last 3 days"', page)
        self.assertIn('["6", "tasks scored"]', page)

    def test_generated_timestamp_formatting(self):
        self.assertEqual(
            format_generated_at("2026-08-27T22:06:10.421941+00"),
            "August 27, 2026 at 10:06 PM UTC",
        )
        self.assertEqual(format_generated_at("not-a-date"), "not-a-date")

    def test_open_report_uses_default_browser_with_file_uri(self):
        report_path = Path("/tmp/skill doctor/report.html")
        args = parse_args([str(report_path), "--open"])

        self.assertEqual(args.report_path, str(report_path))
        self.assertTrue(args.open_browser)

        with patch("render_report.webbrowser.open", return_value=True) as browser_open:
            self.assertTrue(open_report(report_path))

        browser_open.assert_called_once_with(
            report_path.absolute().as_uri(),
            new=2,
        )

        with patch("render_report.webbrowser.open", side_effect=OSError):
            self.assertFalse(open_report(report_path))

    def test_share_card_uses_neutral_methodology_attribution(self):
        page = render_page({
            "scores": {
                "efficiency": 1.0,
                "code_quality": 1.0,
                "skill_coverage": 1.0,
                "overall": 1.0,
            },
        })

        self.assertIn(
            '"stamp": ["Agent skill report", '
            '"skill-doctor \\u00b7 methodology v2"]',
            page,
        )
        self.assertNotIn("warp.dev/skill-doctor", page)
        self.assertIn('"eyebrow": "skill-doctor"', page)
        self.assertIn("text('# ' + CARD.eyebrow", page)

    def test_report_metric_lines_animate_like_skill_doctor_landing_page(self):
        page = render_page({
            "scores": {
                "efficiency": 0.75,
                "code_quality": 0.93,
                "skill_coverage": 0.74,
                "overall": 0.82,
            },
        })

        self.assertIn(
            "animation: skill-doctor-fill 700ms "
            "cubic-bezier(0.22, 1, 0.36, 1) var(--metric-delay) both",
            page,
        )
        self.assertIn("@keyframes skill-doctor-fill", page)
        self.assertIn("from { transform: scaleX(0); }", page)
        self.assertIn("to { transform: scaleX(1); }", page)
        self.assertIn("width:75%;--metric-delay:180ms", page)
        self.assertIn("width:93%;--metric-delay:290ms", page)
        self.assertIn("width:74%;--metric-delay:400ms", page)
        self.assertIn("@media (prefers-reduced-motion: reduce)", page)
        self.assertIn(".bar-fill { animation: none; }", page)

    def test_skill_output_links_report_without_promotional_footer(self):
        skill_path = Path(__file__).resolve().parent.parent / "SKILL.md"
        skill_text = skill_path.read_text()
        output_section = skill_text.split("## Step 6: Output", 1)[1]

        self.assertIn(
            '--inventory "$REPORT_DIR/inventory.json"',
            skill_text,
        )
        self.assertIn(
            '--aggregation "$REPORT_DIR/aggregation.json"',
            skill_text,
        )
        self.assertIn(
            "include its local path once",
            output_section,
        )
        self.assertIn(
            "Do not append promotional links, fixed footer text, or a generic "
            "follow-up question",
            output_section,
        )
        self.assertNotIn("Warp Factories", output_section)
        self.assertNotIn("Want me to apply", output_section)

    def test_skill_edits_only_use_failed_tasks(self):
        skill_path = Path(__file__).resolve().parent.parent / "SKILL.md"
        skill_text = skill_path.read_text()

        self.assertIn(
            "The aggregator validates sampled task IDs, rubric labels, score bounds",
            skill_text,
        )
        self.assertIn(
            "calculates coverage across confirmed eligible task-skill opportunities",
            skill_text,
        )
        self.assertIn(
            "Use its `scores`, `coverage`, and `failed_tasks` values without "
            "recalculating them manually",
            skill_text,
        )
        self.assertIn(
            "Each finding records a concise `summary`, its `disposition`",
            skill_text,
        )
        self.assertIn(
            "propose improvements to project skills based only on `failed_tasks`",
            skill_text,
        )
        self.assertIn("project_relative_path", skill_text)
        self.assertIn("exactly one existing file", skill_text)
        self.assertIn("Do not draft edits for external skills", skill_text)
        self.assertNotIn("path is in `inventory.json`", skill_text)

    def test_report_renders_letter_grade(self):
        page = render_page({
            "scores": {
                "efficiency": 0.7,
                "code_quality": 0.7,
                "skill_coverage": 0.8,
                "overall": 0.7,
            },
        })

        self.assertIn('<div class="grade">C-</div>', page)
        self.assertIn('<div class="grade-label">overall 70</div>', page)


if __name__ == "__main__":
    unittest.main()
