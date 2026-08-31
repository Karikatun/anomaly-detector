#!/usr/bin/env python3
"""Deterministically aggregate per-task skill-doctor scores.

The input files are deliberately simple JSON documents with a top-level
``tasks`` list. Sampled inventory tasks describe which skills were used.
Scoring tasks provide rubric results and the skills that were eligible.
"""

import argparse
import json
import math
from pathlib import Path


class AggregationError(ValueError):
    """Raised when aggregation input violates the public JSON contract."""


RUBRIC_SCORES = {
    "efficiency": {
        "highly_efficient": 1.0,
        "mostly_efficient": 0.8,
        "mostly_inefficient": 0.4,
        "highly_inefficient": 0.2,
    },
    "code_quality": {
        "approve": 1.0,
        "block": 0.2,
        "insufficient_evidence": None,
    },
}
COST_KEYS = {
    "avoidable_rework",
    "required_wait",
    "environment_denial",
    "expected_red",
    "unclassified",
}


def _tasks(document, source_name):
    if not isinstance(document, dict):
        raise AggregationError(f"{source_name} must be a JSON object")
    tasks = document.get("tasks")
    if not isinstance(tasks, list):
        raise AggregationError(f"{source_name}.tasks must be a list")
    if not tasks:
        raise AggregationError(f"{source_name}.tasks must contain at least one task")
    return tasks


def _task_id(task, source_name, index):
    if not isinstance(task, dict):
        raise AggregationError(f"{source_name}.tasks[{index}] must be an object")

    task_id = task.get("task_id")
    meta = task.get("meta")
    meta_id = meta.get("id") if isinstance(meta, dict) else None
    if task_id is not None and meta_id is not None and task_id != meta_id:
        raise AggregationError(
            f"{source_name}.tasks[{index}] has conflicting task_id and meta.id"
        )
    resolved = task_id if task_id is not None else meta_id
    if not isinstance(resolved, str) or not resolved.strip():
        raise AggregationError(
            f"{source_name}.tasks[{index}] is missing task_id (or meta.id)"
        )
    return resolved


def _indexed_tasks(document, source_name):
    ordered = []
    indexed = {}
    for index, task in enumerate(_tasks(document, source_name)):
        task_id = _task_id(task, source_name, index)
        if task_id in indexed:
            raise AggregationError(
                f"{source_name} contains duplicate task ID {task_id!r}"
            )
        indexed[task_id] = task
        ordered.append((task_id, task))
    return ordered, indexed


def _sampled_inventory(inventory):
    """Limit v2 inventories to sampled tasks; legacy inventories score all."""
    tasks = _tasks(inventory, "inventory")
    if any("sampled" in task for task in tasks if isinstance(task, dict)):
        tasks = [task for task in tasks if task.get("sampled") is True]
    return {"tasks": tasks}


def _skill_set(task, field, source_name, task_id):
    value = task.get(field)
    if not isinstance(value, list):
        raise AggregationError(
            f"{source_name} task {task_id!r} field {field!r} must be a list"
        )
    if any(not isinstance(name, str) or not name for name in value):
        raise AggregationError(
            f"{source_name} task {task_id!r} field {field!r} must contain skill names"
        )
    return set(value)


def _metric(task, metric_name, task_id, strict_contract=False):
    metric = task.get(metric_name)
    if not isinstance(metric, dict):
        raise AggregationError(
            f"scoring task {task_id!r} field {metric_name!r} must be an object"
        )

    label = metric.get("label")
    if not isinstance(label, str) or not label:
        raise AggregationError(
            f"scoring task {task_id!r} {metric_name}.label must be a non-empty string"
        )

    score = metric.get("score")
    expected_score = RUBRIC_SCORES[metric_name].get(label)
    if strict_contract:
        if label not in RUBRIC_SCORES[metric_name]:
            raise AggregationError(
                f"scoring task {task_id!r} has unknown {metric_name} label {label!r}"
            )
        if expected_score is None:
            if score is not None:
                raise AggregationError(
                    f"scoring task {task_id!r} {metric_name}.score must be null for {label}"
                )
        elif isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isclose(
            float(score), expected_score, rel_tol=0.0, abs_tol=1e-9
        ):
            raise AggregationError(
                f"scoring task {task_id!r} {metric_name}.score does not match label {label!r}"
            )
    if metric_name == "code_quality" and label == "insufficient_evidence":
        if score is None:
            return label, None
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        raise AggregationError(
            f"scoring task {task_id!r} {metric_name}.score must be numeric"
        )
    score = float(score)
    if not math.isfinite(score) or not 0.0 <= score <= 1.0:
        raise AggregationError(
            f"scoring task {task_id!r} {metric_name}.score must be between 0 and 1"
        )
    return label, score


def _validate_cost_classification(task, task_id):
    costs = task.get("cost_classification")
    if not isinstance(costs, dict) or set(costs) != COST_KEYS:
        raise AggregationError(
            f"scoring task {task_id!r} cost_classification must contain exactly "
            + ", ".join(sorted(COST_KEYS))
        )
    for name, value in costs.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise AggregationError(
                f"scoring task {task_id!r} cost_classification.{name} "
                "must be a nonnegative integer"
            )


def _curve(score):
    return 0.5 + 0.5 * score


def aggregate_scores(inventory, scoring):
    """Return deterministic aggregate scores for matching inventory tasks."""
    inventory_version = inventory.get("methodology_version")
    scoring_version = scoring.get("methodology_version")
    if inventory_version == 2 and scoring_version != 2:
        raise AggregationError(
            "scoring.methodology_version must be 2 for a methodology v2 inventory"
        )
    strict_contract = inventory_version == 2 or scoring_version == 2
    known_skills = None
    if strict_contract:
        skill_records = inventory.get("skills")
        if not isinstance(skill_records, list) or any(
            not isinstance(skill, dict)
            or not isinstance(skill.get("name"), str)
            or not skill["name"]
            for skill in skill_records
        ):
            raise AggregationError("inventory.skills must list named skills for methodology v2")
        known_skills = {skill["name"] for skill in skill_records}

    inventory_ordered, inventory_by_id = _indexed_tasks(
        _sampled_inventory(inventory), "inventory"
    )
    scoring_ordered, scoring_by_id = _indexed_tasks(scoring, "scoring")

    inventory_ids = set(inventory_by_id)
    scoring_ids = set(scoring_by_id)
    if inventory_ids != scoring_ids:
        missing = sorted(inventory_ids - scoring_ids)
        unknown = sorted(scoring_ids - inventory_ids)
        details = []
        if missing:
            details.append(f"missing scoring IDs: {', '.join(missing)}")
        if unknown:
            details.append(f"unknown scoring IDs: {', '.join(unknown)}")
        raise AggregationError("task IDs do not match; " + "; ".join(details))

    efficiency_scores = []
    code_quality_scores = []
    failed = set()
    eligible_tasks = 0
    covered_tasks = 0
    eligible_skill_opportunities = 0
    covered_skill_opportunities = 0

    for task_id, score_task in scoring_ordered:
        _efficiency_label, efficiency_score = _metric(
            score_task, "efficiency", task_id, strict_contract
        )
        code_quality_label, code_quality_score = _metric(
            score_task, "code_quality", task_id, strict_contract
        )
        if strict_contract:
            _validate_cost_classification(score_task, task_id)

        efficiency_scores.append(efficiency_score)
        if efficiency_score < 0.5:
            failed.add(task_id)
        if code_quality_label != "insufficient_evidence":
            code_quality_scores.append(code_quality_score)
            if code_quality_score < 0.5:
                failed.add(task_id)

        eligible = _skill_set(
            score_task, "eligible_skills", "scoring", task_id
        )
        used = _skill_set(
            inventory_by_id[task_id], "skills_used", "inventory", task_id
        )
        if strict_contract:
            unknown_eligible = sorted(eligible - known_skills)
            unknown_used = sorted(used - known_skills)
            if unknown_eligible:
                raise AggregationError(
                    f"scoring task {task_id!r} names unknown eligible skill(s): "
                    + ", ".join(unknown_eligible)
                )
            if unknown_used:
                raise AggregationError(
                    f"inventory task {task_id!r} names unknown used skill(s): "
                    + ", ".join(unknown_used)
                )
        if eligible:
            eligible_tasks += 1
            eligible_skill_opportunities += len(eligible)
            covered_skill_opportunities += len(eligible.intersection(used))
            if eligible.intersection(used):
                covered_tasks += 1

    raw_efficiency = sum(efficiency_scores) / len(efficiency_scores)
    raw_code_quality = (
        sum(code_quality_scores) / len(code_quality_scores)
        if code_quality_scores
        else None
    )
    efficiency = _curve(raw_efficiency)
    code_quality = _curve(raw_code_quality) if raw_code_quality is not None else None

    skill_coverage = (
        covered_skill_opportunities / eligible_skill_opportunities
        if eligible_skill_opportunities
        else None
    )
    weighted_scores = [(0.5, efficiency)]
    if code_quality is not None:
        weighted_scores.append((0.35, code_quality))
    if skill_coverage is not None:
        weighted_scores.append((0.15, skill_coverage))
    total_weight = sum(weight for weight, _score in weighted_scores)
    overall = sum(weight * score for weight, score in weighted_scores) / total_weight

    return {
        "raw_scores": {
            "efficiency": raw_efficiency,
            "code_quality": raw_code_quality,
        },
        "scores": {
            "efficiency": efficiency,
            "code_quality": code_quality,
            "skill_coverage": skill_coverage,
            "overall": overall,
        },
        "coverage": {
            "eligible_tasks": eligible_tasks,
            "covered_tasks": covered_tasks,
            "eligible_skill_opportunities": eligible_skill_opportunities,
            "covered_skill_opportunities": covered_skill_opportunities,
            "code_quality_evidence_tasks": len(code_quality_scores),
        },
        "failed_tasks": [
            task_id for task_id, _task in inventory_ordered if task_id in failed
        ],
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", help="path to inventory.json")
    parser.add_argument("scoring", help="path to scoring.json")
    parser.add_argument("--out", required=True, help="aggregation JSON output path")
    return parser.parse_args(argv)


def _read_json(path, label):
    try:
        return json.loads(path.read_text())
    except OSError as exc:
        raise AggregationError(f"cannot read {label} {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise AggregationError(f"invalid JSON in {label} {path}: {exc}") from exc


def main(argv=None):
    args = parse_args(argv)
    inventory_path = Path(args.inventory)
    scoring_path = Path(args.scoring)
    output_path = Path(args.out)

    result = aggregate_scores(
        _read_json(inventory_path, "inventory"),
        _read_json(scoring_path, "scoring"),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AggregationError as exc:
        raise SystemExit(f"error: {exc}")
