#!/usr/bin/env python3
"""Tests for deterministic skill-doctor score aggregation."""

import json
import re
import tempfile
import unittest
from pathlib import Path

from aggregate_scores import AggregationError, aggregate_scores, main


class ScoreAggregationTests(unittest.TestCase):
    def test_aggregates_scores_failures_and_only_eligible_coverage(self):
        inventory = {
            "tasks": [
                {"task_id": "covered", "skills_used": ["tdd"]},
                {"meta": {"id": "uncovered"}, "skills_used": []},
                {"task_id": "irrelevant", "skills_used": ["code-review"]},
            ],
        }
        scoring = {
            "tasks": [
                {
                    "task_id": "covered",
                    "efficiency": {"label": "needs_improvement", "score": 0.4},
                    "code_quality": {"label": "good", "score": 0.8},
                    "eligible_skills": ["tdd"],
                },
                {
                    "meta": {"id": "uncovered"},
                    "efficiency": {"label": "good", "score": 0.8},
                    "code_quality": {
                        "label": "insufficient_evidence",
                        "score": 0.0,
                    },
                    "eligible_skills": ["code-review"],
                },
                {
                    "task_id": "irrelevant",
                    "efficiency": {"label": "excellent", "score": 1.0},
                    "code_quality": {"label": "poor", "score": 0.2},
                    "eligible_skills": [],
                },
            ],
        }

        result = aggregate_scores(inventory, scoring)

        self.assertAlmostEqual(result["raw_scores"]["efficiency"], 11 / 15)
        self.assertAlmostEqual(result["raw_scores"]["code_quality"], 0.5)
        self.assertAlmostEqual(result["scores"]["efficiency"], 13 / 15)
        self.assertAlmostEqual(result["scores"]["code_quality"], 0.75)
        self.assertEqual(result["scores"]["skill_coverage"], 0.5)
        self.assertAlmostEqual(result["scores"]["overall"], 37 / 48)
        self.assertEqual(
            result["coverage"],
            {
                "eligible_tasks": 2,
                "covered_tasks": 1,
                "eligible_skill_opportunities": 2,
                "covered_skill_opportunities": 1,
                "code_quality_evidence_tasks": 2,
            },
        )
        self.assertEqual(result["failed_tasks"], ["covered", "irrelevant"])

    def test_zero_eligible_tasks_uses_null_coverage_and_reweights_overall(self):
        inventory = {
            "tasks": [
                {"task_id": "first", "skills_used": []},
                {"task_id": "second", "skills_used": ["irrelevant-skill"]},
            ],
        }
        scoring = {
            "tasks": [
                {
                    "task_id": "first",
                    "efficiency": {"label": "poor", "score": 0.2},
                    "code_quality": {"label": "poor", "score": 0.4},
                    "eligible_skills": [],
                },
                {
                    "task_id": "second",
                    "efficiency": {"label": "good", "score": 0.6},
                    "code_quality": {"label": "good", "score": 0.8},
                    "eligible_skills": [],
                },
            ],
        }

        result = aggregate_scores(inventory, scoring)

        self.assertEqual(result["scores"]["skill_coverage"], None)
        self.assertAlmostEqual(result["scores"]["efficiency"], 0.7)
        self.assertAlmostEqual(result["scores"]["code_quality"], 0.8)
        self.assertAlmostEqual(
            result["scores"]["overall"],
            (0.5 * 0.7 + 0.35 * 0.8) / 0.85,
        )
        self.assertEqual(result["failed_tasks"], ["first"])

    def test_all_insufficient_code_quality_is_na_and_reweights_overall(self):
        inventory = {
            "tasks": [{"task_id": "task", "skills_used": ["tdd"]}],
        }
        scoring = {
            "tasks": [
                {
                    "task_id": "task",
                    "efficiency": {"label": "good", "score": 0.6},
                    "code_quality": {
                        "label": "insufficient_evidence",
                        "score": None,
                    },
                    "eligible_skills": ["tdd"],
                },
            ],
        }

        result = aggregate_scores(inventory, scoring)

        self.assertIsNone(result["raw_scores"]["code_quality"])
        self.assertIsNone(result["scores"]["code_quality"])
        self.assertEqual(result["coverage"]["code_quality_evidence_tasks"], 0)
        self.assertAlmostEqual(
            result["scores"]["overall"],
            (0.5 * 0.8 + 0.15 * 1.0) / 0.65,
        )
        self.assertEqual(result["failed_tasks"], [])

    def test_only_sampled_inventory_tasks_require_scoring(self):
        inventory = {
            "tasks": [
                {"task_id": "sampled", "skills_used": [], "sampled": True},
                {"task_id": "not-sampled", "skills_used": [], "sampled": False},
            ],
        }
        scoring = {
            "tasks": [{
                "task_id": "sampled",
                "efficiency": {"label": "good", "score": 0.8},
                "code_quality": {
                    "label": "insufficient_evidence",
                    "score": None,
                },
                "eligible_skills": [],
            }],
        }

        result = aggregate_scores(inventory, scoring)

        self.assertEqual(result["failed_tasks"], [])
        self.assertEqual(result["coverage"]["code_quality_evidence_tasks"], 0)

    def test_coverage_counts_each_eligible_skill_opportunity(self):
        inventory = {
            "tasks": [{
                "task_id": "task",
                "skills_used": ["tdd"],
                "sampled": True,
            }],
        }
        scoring = {
            "tasks": [{
                "task_id": "task",
                "efficiency": {"label": "good", "score": 0.8},
                "code_quality": {"label": "good", "score": 0.8},
                "eligible_skills": ["tdd", "security"],
            }],
        }

        result = aggregate_scores(inventory, scoring)

        self.assertEqual(result["scores"]["skill_coverage"], 0.5)
        self.assertEqual(result["coverage"]["eligible_tasks"], 1)
        self.assertEqual(result["coverage"]["covered_tasks"], 1)
        self.assertEqual(result["coverage"]["eligible_skill_opportunities"], 2)
        self.assertEqual(result["coverage"]["covered_skill_opportunities"], 1)

    def test_methodology_v2_requires_rubric_labels_and_cost_classification(self):
        inventory = {
            "methodology_version": 2,
            "skills": [],
            "tasks": [{"task_id": "task", "skills_used": [], "sampled": True}],
        }
        base_task = {
            "task_id": "task",
            "efficiency": {"label": "highly_efficient", "score": 1.0},
            "code_quality": {"label": "insufficient_evidence", "score": None},
            "eligible_skills": [],
        }

        with self.assertRaisesRegex(AggregationError, "methodology_version"):
            aggregate_scores(
                inventory,
                {"tasks": [base_task]},
            )

        with self.assertRaisesRegex(AggregationError, "cost_classification"):
            aggregate_scores(
                inventory,
                {"methodology_version": 2, "tasks": [base_task]},
            )

        invalid = dict(base_task)
        invalid["efficiency"] = {"label": "highly_efficient", "score": 0.2}
        invalid["cost_classification"] = {
            "avoidable_rework": 0,
            "required_wait": 0,
            "environment_denial": 0,
            "expected_red": 0,
            "unclassified": 0,
        }
        with self.assertRaisesRegex(AggregationError, "does not match label"):
            aggregate_scores(
                inventory,
                {"methodology_version": 2, "tasks": [invalid]},
            )

    def test_methodology_v2_rejects_unknown_skill_names(self):
        inventory = {
            "methodology_version": 2,
            "skills": [{"name": "tdd"}],
            "tasks": [{"task_id": "task", "skills_used": [], "sampled": True}],
        }
        scoring = {
            "methodology_version": 2,
            "tasks": [{
                "task_id": "task",
                "efficiency": {"label": "highly_efficient", "score": 1.0},
                "code_quality": {"label": "insufficient_evidence", "score": None},
                "eligible_skills": ["phantom"],
                "cost_classification": {
                    "avoidable_rework": 0,
                    "required_wait": 0,
                    "environment_denial": 0,
                    "expected_red": 0,
                    "unclassified": 0,
                },
            }],
        }

        with self.assertRaisesRegex(AggregationError, "unknown eligible skill"):
            aggregate_scores(inventory, scoring)

    def test_rejects_missing_duplicate_and_mismatched_task_ids(self):
        valid_score = {
            "efficiency": {"label": "good", "score": 0.8},
            "code_quality": {"label": "good", "score": 0.8},
            "eligible_skills": [],
        }
        cases = [
            (
                {"tasks": [{"skills_used": []}]},
                {"tasks": [{"task_id": "one", **valid_score}]},
                "missing task_id (or meta.id)",
            ),
            (
                {
                    "tasks": [
                        {"task_id": "one", "skills_used": []},
                        {"task_id": "one", "skills_used": []},
                    ],
                },
                {"tasks": [{"task_id": "one", **valid_score}]},
                "duplicate task ID 'one'",
            ),
            (
                {"tasks": [{"task_id": "one", "skills_used": []}]},
                {
                    "tasks": [
                        {"task_id": "one", **valid_score},
                        {"task_id": "one", **valid_score},
                    ],
                },
                "duplicate task ID 'one'",
            ),
            (
                {
                    "tasks": [
                        {"task_id": "one", "skills_used": []},
                        {"task_id": "two", "skills_used": []},
                    ],
                },
                {"tasks": [{"task_id": "one", **valid_score}]},
                "missing scoring IDs: two",
            ),
            (
                {"tasks": [{"task_id": "one", "skills_used": []}]},
                {
                    "tasks": [
                        {"task_id": "one", **valid_score},
                        {"task_id": "two", **valid_score},
                    ],
                },
                "unknown scoring IDs: two",
            ),
        ]

        for inventory, scoring, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(AggregationError, re.escape(message)):
                    aggregate_scores(inventory, scoring)

    def test_rejects_scores_outside_zero_to_one(self):
        inventory = {
            "tasks": [{"task_id": "task", "skills_used": []}],
        }

        for metric_name, score in (("efficiency", -0.01), ("code_quality", 1.01)):
            scoring = {
                "tasks": [
                    {
                        "task_id": "task",
                        "efficiency": {"label": "good", "score": 0.8},
                        "code_quality": {"label": "good", "score": 0.8},
                        "eligible_skills": [],
                    },
                ],
            }
            scoring["tasks"][0][metric_name]["score"] = score

            with self.subTest(metric=metric_name, score=score):
                with self.assertRaisesRegex(
                    AggregationError,
                    rf"{metric_name}\.score must be between 0 and 1",
                ):
                    aggregate_scores(inventory, scoring)

    def test_cli_writes_aggregation_json_to_out(self):
        inventory = {
            "tasks": [{"task_id": "task", "skills_used": ["tdd"]}],
        }
        scoring = {
            "tasks": [
                {
                    "task_id": "task",
                    "efficiency": {"label": "good", "score": 0.8},
                    "code_quality": {"label": "good", "score": 0.6},
                    "eligible_skills": ["tdd"],
                },
            ],
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory_path = root / "inventory.json"
            scoring_path = root / "scoring.json"
            output_path = root / "nested" / "aggregation.json"
            inventory_path.write_text(json.dumps(inventory))
            scoring_path.write_text(json.dumps(scoring))

            exit_code = main(
                [
                    str(inventory_path),
                    str(scoring_path),
                    "--out",
                    str(output_path),
                ]
            )

            self.assertEqual(exit_code, 0)
            written = json.loads(output_path.read_text())
            self.assertEqual(written["scores"]["skill_coverage"], 1.0)
            self.assertEqual(written["failed_tasks"], [])


if __name__ == "__main__":
    unittest.main()
