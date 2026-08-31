#!/usr/bin/env python3
"""Render a skill-doctor report.json into one shareable HTML report.

Output (next to report.json):
  report.html - scorecard, findings, and suggested skill edits in a single
                self-contained page, with a "share as png" button that draws
                a 1200x675 share image client-side and downloads it.

Python 3.9+, stdlib only. Uses system fonts so the page and the exported PNG
render the same everywhere.
"""

import argparse
import base64
import html
import json
import re
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

GRADES = [
    (0.97, "A+"), (0.93, "A"), (0.90, "A-"),
    (0.87, "B+"), (0.83, "B"), (0.80, "B-"),
    (0.77, "C+"), (0.73, "C"), (0.70, "C-"),
    (0.60, "D"), (0.0, "F"),
]

DIFFS_BUNDLE_PATH = (
    Path(__file__).resolve().parent.parent / "assets" / "pierre-diffs.js"
)

# Collapsed height of a diff before the "show more" toggle takes over.
DIFF_CLAMP_PX = 320


class PrivacyError(ValueError):
    """Raised when shareable report data contains local-only material."""


class ReportContractError(ValueError):
    """Raised when report.json diverges from deterministic aggregation."""


PRIVATE_PATTERNS = (
    ("local path", re.compile(r"(?<![\w:/.])/(?:[^\s<>\"']+/)*[^\s<>\"']+")),
    ("local path", re.compile(r"(?<![\w])~/(?:[^\s<>\"']+/)*[^\s<>\"']+")),
    ("local path", re.compile(r"\b[A-Za-z]:\\(?:[^\\\s<>\"']+\\)*[^\\\s<>\"']+")),
    ("local path", re.compile(r"\b[A-Za-z]:/(?:[^/\s<>\"']+/)*[^/\s<>\"']+")),
    ("local path", re.compile(r"\\\\[^\\\s<>\"']+(?:\\[^\\\s<>\"']+)+")),
    ("local path", re.compile(r"\bfile://[^\s<>\"']+", re.I)),
    ("local identifier", re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)),
    ("secret-like token", re.compile(r"\b(?:ghp_|github_pat_|sk-|xox[baprs]-|AKIA|ASIA)[A-Za-z0-9_-]{16,}\b")),
    ("secret-like token", re.compile(r"\bAIza[A-Za-z0-9_-]{35}\b")),
    ("secret-like token", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("secret-like token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*", re.I)),
    ("secret-like assignment", re.compile(r"\b(?:api[_-]?key|password|secret|token|(?:rails[_-]?)?master[_-]?key|encryption[_-]?key|signing[_-]?key|fernet[_-]?key)\s*[:=]\s*[^\s,;]{8,}", re.I)),
    ("secret-like header", re.compile(r"\b(?:(?:Proxy-)?Authorization|Cookie|Set-Cookie)\s*[:=]\s*\S+", re.I)),
    ("credential URI", re.compile(r"\b[a-z][a-z0-9+.-]*://[^/@\s]*:[^/@\s]+@", re.I)),
    ("secret-like token", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
)


def _report_strings(value, pointer="$"):
    if isinstance(value, str):
        yield pointer, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _report_strings(item, f"{pointer}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _report_strings(item, f"{pointer}[{index}]")


def validate_report_privacy(report, exact_sensitive_values=()):
    """Fail closed before local-only identifiers enter shareable HTML or PNG."""
    exact_values = {
        " ".join(value.split()) for value in exact_sensitive_values
        if isinstance(value, str) and len(value) >= 8
    }
    for pointer, text in _report_strings(report):
        normalized_text = " ".join(text.split())
        if any(value in normalized_text for value in exact_values):
            raise PrivacyError(
                f"report privacy validation failed at {pointer} (local identifier)"
            )
        for label, pattern in PRIVATE_PATTERNS:
            if pattern.search(text):
                raise PrivacyError(
                    f"report privacy validation failed at {pointer} ({label})"
                )


def _transcript_user_values(path, strict=False):
    """Return verbatim user blocks/lines that may not enter a shareable report."""
    try:
        lines = path.read_text().splitlines()
    except (OSError, UnicodeError) as exc:
        if strict:
            raise ReportContractError(
                "inventory transcript is unavailable or unreadable"
            ) from exc
        return set()
    values = set()
    block = []

    def flush():
        if not block:
            return
        joined = "\n".join(block).strip()
        if len(joined) >= 8:
            values.add(joined)
        for line in block:
            stripped = " ".join(line.split())
            if len(stripped) >= 8:
                values.add(stripped)
            if len(stripped) >= 24:
                values.update(
                    stripped[index:index + 24]
                    for index in range(len(stripped) - 23)
                )

    for line in lines:
        if line.startswith("[user] "):
            flush()
            block = [line[len("[user] "):]]
        elif block and re.match(r"^\[(?:assistant|tool|output)(?::[^]]+)?\]", line):
            flush()
            block = []
        elif block:
            block.append(line)
    flush()
    return values


def inventory_sensitive_values(inventory, report_path: Path):
    """Extract local identifiers and paths that must not appear in the report."""
    values = {str(report_path.parent.resolve())}
    sensitive_keys = {
        "task_id", "id", "parent_session_id", "conversation_id", "cwd", "repo",
        "repos", "file", "path", "transcript_path", "claude_home", "codex_home",
        "warp_databases", "database", "home", "project_relative_path",
    }

    def collect(value, key=None):
        if isinstance(value, dict):
            for child_key, child in value.items():
                collect(child, child_key)
        elif isinstance(value, list):
            for child in value:
                collect(child, key)
        elif isinstance(value, str) and (
            key in sensitive_keys
            or (
                isinstance(key, str)
                and (key.endswith("_id") or key.endswith("_ids"))
            )
        ):
            values.add(value)

    collect(inventory)
    report_root = report_path.parent.resolve()
    strict_v2 = inventory.get("methodology_version") == 2
    for task in inventory.get("tasks", []):
        if not isinstance(task, dict):
            continue
        transcript_path = task.get("transcript_path")
        if strict_v2 and task.get("sampled") is True and not isinstance(
            transcript_path, str
        ):
            raise ReportContractError(
                "sampled inventory task is missing a transcript reference"
            )
        if isinstance(transcript_path, str):
            candidate = Path(transcript_path)
            if strict_v2 and candidate.is_absolute():
                raise ReportContractError(
                    "inventory transcript must be relative to the report directory"
                )
            if not candidate.is_absolute():
                candidate = (report_root / candidate).resolve()
                try:
                    candidate.relative_to(report_root)
                except ValueError:
                    if strict_v2:
                        raise ReportContractError(
                            "inventory transcript escaped the report directory"
                        )
                    continue
            values.update(_transcript_user_values(candidate, strict=strict_v2))
    return values


def validate_report_schema(report, inventory):
    """Validate the model-authored v2 surface before rendering or card export."""
    allowed_top_level = {
        "methodology_version", "title", "generated_at", "harness", "handle",
        "stats", "scores", "coverage", "failed_task_aliases", "top_findings",
        "workflow_recommendations", "skill_edits",
    }
    if set(report) != allowed_top_level:
        raise ReportContractError("report schema mismatch at $")
    expected_scalars = {
        "methodology_version": 2,
        "title": "Agent Skill Report",
        "harness": inventory.get("harness"),
        "handle": inventory.get("repo_name"),
    }
    for key, expected in expected_scalars.items():
        if report.get(key) != expected:
            raise ReportContractError(f"report schema mismatch at $.{key}")
    generated_at = report.get("generated_at")
    if not isinstance(generated_at, str):
        raise ReportContractError("report schema mismatch at $.generated_at")
    try:
        datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReportContractError(
            "report schema mismatch at $.generated_at"
        ) from exc

    expected_stats = {
        "tasks_analyzed": inventory.get("stats", {}).get("tasks_sampled"),
        "conversations_scanned": inventory.get("stats", {}).get(
            "conversation_records_in_window"
        ),
        "skills_found": inventory.get("stats", {}).get("skills_found"),
        "skills_used": inventory.get("stats", {}).get("skills_used"),
        "window_days": inventory.get("window_days"),
    }
    if report.get("stats") != expected_stats:
        raise ReportContractError("report schema mismatch at $.stats")

    finding_keys = {"summary", "disposition", "reason"}
    dispositions = {"workflow_recommendation", "skill_edit", "no_change"}
    findings = report.get("top_findings")
    if not isinstance(findings, list) or len(findings) != 3:
        raise ReportContractError("report schema mismatch at $.top_findings")
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict) or set(finding) != finding_keys:
            raise ReportContractError(
                f"report schema mismatch at $.top_findings[{index}]"
            )
        if finding.get("disposition") not in dispositions or any(
            not isinstance(finding.get(key), str) or not finding[key].strip()
            for key in ("summary", "reason")
        ):
            raise ReportContractError(
                f"report schema mismatch at $.top_findings[{index}]"
            )

    workflow_keys = {"owner", "change", "evidence", "expected_effect"}
    owners = {"collector", "workflow", "repository", "harness"}
    recommendations = report.get("workflow_recommendations")
    if not isinstance(recommendations, list):
        raise ReportContractError(
            "report schema mismatch at $.workflow_recommendations"
        )
    for index, recommendation in enumerate(recommendations):
        if (
            not isinstance(recommendation, dict)
            or set(recommendation) != workflow_keys
            or recommendation.get("owner") not in owners
            or any(
                not isinstance(recommendation.get(key), str)
                or not recommendation[key].strip()
                for key in ("change", "evidence", "expected_effect")
            )
        ):
            raise ReportContractError(
                f"report schema mismatch at $.workflow_recommendations[{index}]"
            )

    edits = report.get("skill_edits")
    if not isinstance(edits, list):
        raise ReportContractError("report schema mismatch at $.skill_edits")
    edit_keys = {"skill", "change", "evidence", "proposed_path", "diff"}
    for index, edit in enumerate(edits):
        if not isinstance(edit, dict) or set(edit) != edit_keys or any(
            not isinstance(edit.get(key), str) for key in edit_keys
        ):
            raise ReportContractError(
                f"report schema mismatch at $.skill_edits[{index}]"
            )
        proposed_path = edit["proposed_path"]
        skill_name = edit["skill"]
        if not re.fullmatch(r"[A-Za-z0-9._-]+", skill_name):
            raise ReportContractError(
                f"report schema mismatch at $.skill_edits[{index}].skill"
            )
        if proposed_path != f"proposed/{skill_name}/SKILL.md":
            raise ReportContractError(
                f"report schema mismatch at $.skill_edits[{index}].proposed_path"
            )
        diff_lines = edit["diff"].splitlines()
        if not diff_lines:
            raise ReportContractError(
                f"report schema mismatch at $.skill_edits[{index}].diff"
            )
        if diff_lines[0] != "---":
            expected_headers = [
                f"--- a/{skill_name}/SKILL.md",
                f"+++ b/{skill_name}/SKILL.md",
            ]
            if diff_lines[:2] != expected_headers:
                raise ReportContractError(
                    f"report schema mismatch at $.skill_edits[{index}].diff"
                )


def _same_contract_value(actual, expected):
    if actual is None or expected is None:
        return actual is expected
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual is expected
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return abs(float(actual) - float(expected)) <= 1e-12
    return actual == expected


def validate_report_aggregation(report, aggregation, inventory):
    """Bind public v2 report metrics and failed aliases to aggregation.json."""
    for section in ("scores", "coverage"):
        expected = aggregation.get(section)
        actual = report.get(section)
        if not isinstance(expected, dict) or not isinstance(actual, dict):
            raise ReportContractError(f"report contract mismatch at $.{section}")
        if set(actual) != set(expected):
            raise ReportContractError(f"report contract mismatch at $.{section}")
        for key, expected_value in expected.items():
            if not _same_contract_value(actual.get(key), expected_value):
                raise ReportContractError(
                    f"report contract mismatch at $.{section}.{key}"
                )

    aliases_by_id = {}
    for task in inventory.get("tasks", []):
        if not isinstance(task, dict):
            continue
        task_id = task.get("task_id")
        alias = task.get("report_alias")
        if isinstance(task_id, str) and isinstance(alias, str):
            aliases_by_id[task_id] = alias
    failed_ids = aggregation.get("failed_tasks")
    if not isinstance(failed_ids, list) or any(
        not isinstance(task_id, str) or task_id not in aliases_by_id
        for task_id in failed_ids
    ):
        raise ReportContractError("aggregation contract mismatch at $.failed_tasks")
    expected_aliases = [aliases_by_id[task_id] for task_id in failed_ids]
    if report.get("failed_task_aliases") != expected_aliases:
        raise ReportContractError(
            "report contract mismatch at $.failed_task_aliases"
        )


def grade_for(score: float) -> str:
    for threshold, letter in GRADES:
        if score >= threshold:
            return letter
    return "F"


def pct(score) -> int:
    return round(float(score) * 100)


def format_generated_at(value) -> str:
    if not value:
        return ""
    raw = str(value)
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    if re.search(r"[+-]\d{2}$", normalized):
        normalized += ":00"
    try:
        generated_at = datetime.fromisoformat(normalized)
    except ValueError:
        return raw
    suffix = ""
    if generated_at.tzinfo is not None:
        generated_at = generated_at.astimezone(timezone.utc)
        suffix = " UTC"
    time = generated_at.strftime("%I:%M %p").lstrip("0")
    return (
        f"{generated_at.strftime('%B')} {generated_at.day}, "
        f"{generated_at.year} at {time}{suffix}"
    )


def open_report(report_path: Path) -> bool:
    try:
        return bool(webbrowser.open(report_path.absolute().as_uri(), new=2))
    except (OSError, webbrowser.Error):
        return False


def esc(v) -> str:
    value = v if v is not None else ""
    return html.escape(str(value))


def render_diff(diff_text: str, proposed_path: str = "") -> str:
    if not diff_text:
        return ""
    encoded = base64.b64encode(diff_text.encode("utf-8")).decode("ascii")
    filename = Path(proposed_path).name if proposed_path else "SKILL.md"
    return (
        '<div class="diff-wrap" data-collapsed="true">'
        f'<div class="diff-view" data-pierre-diff data-diff="{encoded}" '
        f'data-filename="{esc(filename)}">'
        f'<pre class="diff-fallback">{esc(diff_text)}</pre></div>'
        '<button class="diff-toggle" type="button" hidden>show more</button>'
        "</div>"
    )


def render_workflow_recommendation(recommendation) -> str:
    if not isinstance(recommendation, dict):
        return f"<li>{esc(recommendation)}</li>"

    owner = recommendation.get("owner")
    change = recommendation.get("change") or recommendation.get("recommendation", "")
    lead = f"<b>{esc(owner)}</b> — " if owner else ""
    evidence = recommendation.get("evidence")
    expected_effect = recommendation.get("expected_effect")
    evidence_html = (
        f'<div class="muted">Evidence: {esc(evidence)}</div>' if evidence else ""
    )
    effect_html = (
        f'<div class="muted">Expected effect: {esc(expected_effect)}</div>'
        if expected_effect else ""
    )
    return f"<li>{lead}{esc(change)}{evidence_html}{effect_html}</li>"


def render_finding(finding) -> str:
    if not isinstance(finding, dict):
        return f"<li>{esc(finding)}</li>"

    summary = finding.get("summary", "")
    disposition = finding.get("disposition")
    reason = finding.get("reason")
    disposition_html = (
        f'<div class="muted">Disposition: {esc(disposition)}</div>'
        if disposition else ""
    )
    reason_html = (
        f'<div class="muted">Reason: {esc(reason)}</div>' if reason else ""
    )
    return f"<li>{esc(summary)}{disposition_html}{reason_html}</li>"


def render_skill_edit(skill_edit) -> str:
    if not isinstance(skill_edit, dict):
        return f"<li>{esc(skill_edit)}</li>"

    return f"""<li><b><code>{esc(skill_edit.get('skill'))}</code></b> — {esc(skill_edit.get('change'))}
        {('<div class="muted">Evidence: ' + esc(skill_edit['evidence']) + '</div>') if skill_edit.get('evidence') else ''}
        {render_diff(skill_edit.get('diff', ''), skill_edit.get('proposed_path', ''))}</li>"""


def embedded_diffs_script() -> str:
    if not DIFFS_BUNDLE_PATH.exists():
        raise RuntimeError(
            f"@pierre/diffs bundle missing: {DIFFS_BUNDLE_PATH}; "
            "restore it from warpdotdev/skill-doctor, which builds the bundle "
            "with `pnpm build:diffs`"
        )
    bundle = DIFFS_BUNDLE_PATH.read_text()
    return re.sub(r"</script", r"<\\/script", bundle, flags=re.IGNORECASE)


# Warp pixel mark (../assets/warp-pixel-icon.svg), inlined so the page stays
# self-contained. The same path data is redrawn on canvas for the share image.
WARP_VIEWBOX = (37, 35)
WARP_PATHS = [
    ("M5.3135 2L30.9247 2.00011L30.9208 3.79847L32.5185 3.79657L32.5145 5.43448L34.2294 5.44055L34.2286 28.6954H32.5239C32.507 29.1933 32.5153 29.7328 32.5106 30.2357L30.9319 30.2411C30.9297 30.4979 30.9757 31.7709 30.8834 31.8934C28.193 31.9264 25.4541 31.9005 22.7582 31.9013H5.30484L5.30653 30.2425L3.72927 30.2364L3.73053 28.6969L2 28.6933L2.0009 5.43272C2.57577 5.43872 3.15074 5.4375 3.72561 5.42899L3.73161 3.79621L5.30915 3.79222L5.3135 2Z", "#ffffff"),
    ("M32.5146 5.43457L32.5186 3.79688L30.9209 3.79883L30.9248 2H5.31348L5.30957 3.79199L3.73145 3.7959L3.72559 5.42871C3.15075 5.43722 2.57581 5.43861 2.00098 5.43262L2 28.6934L3.73047 28.6973L3.72949 30.2363L5.30664 30.2422L5.30469 31.9014H22.7578C24.7798 31.9008 26.8265 31.9149 28.8584 31.9082L30.8838 31.8936C30.976 31.7707 30.9295 30.4984 30.9316 30.2412L32.5107 30.2354C32.5154 29.7326 32.5066 29.1931 32.5234 28.6953H34.2285L34.2295 5.44043L32.5146 5.43457ZM36.2285 30.6953H34.5068L34.4922 32.2285L32.8643 32.2334C32.8528 32.2884 32.8385 32.3523 32.8184 32.4209C32.7937 32.5048 32.7066 32.7965 32.4805 33.0967L31.8896 33.8809L30.9082 33.8936C28.2026 33.9268 25.4275 33.9007 22.7588 33.9014H3.30273L3.30371 32.2344L1.72754 32.2285L1.72949 30.6924L0 30.6895L0.000976562 3.41211L1.7334 3.42969L1.73926 1.80078L3.31348 1.79785L3.31836 0H32.9287L32.9248 1.79688L34.5234 1.79395L34.5186 3.44043L36.2295 3.44727L36.2285 30.6953Z", "#000000"),
    ("M29.3721 5.42529C29.889 5.44429 30.4337 5.42268 30.96 5.43213L30.9551 7.04248C31.4775 7.03408 32.01 7.03929 32.5332 7.03857C32.4937 9.42093 32.5257 11.8903 32.5254 14.2798L32.5273 27.1108L30.9609 27.1089L30.959 28.7026L29.375 28.6987C29.3772 29.13 29.3813 29.5667 29.373 29.9976C29.3705 30.1337 29.3832 30.1651 29.3057 30.2358L6.91699 30.2378C6.89889 29.7353 6.91168 29.2118 6.91699 28.7075C6.3669 28.7025 5.8167 28.7025 5.2666 28.7075L5.26465 27.1099L3.68457 27.1089L3.68652 7.04639C4.2055 7.03529 4.7404 7.03916 5.26074 7.03564L5.2666 5.43018C5.80821 5.42385 6.35003 5.42572 6.8916 5.43506C6.88988 4.88796 6.892 4.34052 6.89746 3.79346H29.3711L29.3721 5.42529ZM9.33887 10.6978C9.18647 10.9765 9.21901 11.161 9.22461 11.4819C9.07998 11.4801 8.94005 11.4569 8.8291 11.5347C8.80072 11.622 8.80582 11.6213 8.81152 11.7144C8.68917 11.8074 8.60774 11.7932 8.44434 11.7866C8.36301 11.8515 8.30578 11.9057 8.30176 12.0259C8.28478 12.536 8.29109 13.0721 8.29102 13.5825L8.29297 21.5659C8.29326 22.3844 8.28546 23.2155 8.30371 24.0337C8.30778 24.2156 8.35142 24.2999 8.43848 24.4575C8.64083 24.5041 8.98427 24.4882 9.2041 24.4878C9.19663 24.7586 9.20523 25.128 9.30859 25.3823C9.48375 25.4631 17.0821 25.4211 17.8965 25.4204C17.9026 25.0264 17.915 24.6167 17.9082 24.2241H16.7715C15.5491 24.2241 14.2971 24.2119 13.0771 24.228C13.0791 24.0268 13.0716 23.637 13.1133 23.4565C13.2509 23.3435 13.2926 23.4911 13.3193 23.3413C13.3427 23.2103 13.2843 23.1435 13.3555 23.0181L13.501 22.9917C13.5902 22.8227 13.538 22.0611 13.5391 21.8169L13.9902 21.813C13.989 21.1612 13.9793 20.4819 13.9971 19.8325L14.5029 19.8267C14.5003 19.1758 14.5017 18.5244 14.5068 17.8735L14.9639 17.8696C14.9614 17.3226 14.861 16.4429 15.1162 16.0063C15.2178 15.9719 15.2439 15.9747 15.3477 15.9692C15.4618 15.8341 15.4034 14.2978 15.4043 14.0024L15.9121 14.0005C15.9243 13.3773 15.9407 12.7118 15.9258 12.0903L16.3555 12.0786L16.3506 10.6968C14.0515 10.6966 11.6291 10.6614 9.33887 10.6978ZM18.3584 8.38721C18.3588 8.86591 18.3663 9.36324 18.3584 9.84033L17.9102 9.84229L17.9043 11.48L17.375 11.478L17.374 14.0005L16.8447 14.0015L16.8418 15.9761L16.3652 15.981C16.3592 16.2914 16.413 17.4264 16.3115 17.5913C16.2316 17.6037 16.1517 17.6171 16.0723 17.6323C16.0557 17.7205 16.0531 17.753 16.0479 17.8394C15.9931 17.8723 15.9824 17.8775 15.9229 17.8999C15.8611 18.2051 15.899 19.4273 15.8906 19.8267L15.415 19.8335C15.4087 20.1999 15.4041 21.3175 15.3438 21.604C15.1385 21.7756 14.9409 21.8339 14.9404 22.0278C14.9396 22.3503 14.9419 22.6858 14.9414 23.0083L26.9736 23.0093C26.9722 22.6145 27.0284 22.4491 27.1084 22.0679C27.2287 21.9942 27.4175 22.067 27.4541 22.0269C27.6718 21.7854 27.5123 21.8049 27.9785 21.8228L27.9805 13.7983C27.9805 12.5388 28.0332 10.7775 27.96 9.54639C27.8386 9.54865 27.6757 9.56604 27.5723 9.51611C27.5224 9.2171 27.4479 9.21398 27.1523 9.16064C26.9526 8.99617 26.9654 8.6242 26.9736 8.38623L18.3584 8.38721Z", "#000000"),
]
WARP_MARK = (
    f'<svg class="mark" viewBox="0 0 {WARP_VIEWBOX[0]} {WARP_VIEWBOX[1]}" fill="none" '
    'aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'
    + "".join(f'<path d="{d}" fill="{fill}"/>' for d, fill in WARP_PATHS)
    + "</svg>"
)

# Attribution shown only in the exported share image.
SHARE_STAMP_NAME = "Agent skill report"
SHARE_STAMP_SUB = "skill-doctor · methodology v2"

# Design tokens lifted from warp.dev/factories (factories-landing.css):
# white ground with a dot grid, Matter-Mono-ish monospace, #2a1eff accent,
# hairline rgba(13,10,61) rules, square corners, lowercase labels,
# uppercase wide-tracked meta bars.
PAGE_CSS = """
* { box-sizing: border-box; }
body {
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --fg: #1a1522; --muted: #5d5966; --muted-2: #918d9a; --accent: #2a1eff;
  --line: rgba(13, 10, 61, 0.16); --line-soft: rgba(13, 10, 61, 0.07);
  --page-bg: #fff; --surface: #fff; --bg-panel: #f6f5fb; --yellow: #eef17c;
  --button-fg: #1a1522;
  font-family: var(--mono-font);
  background: radial-gradient(circle at 1px 1px, var(--line-soft) 1px, transparent 0) 0 0 / 22px 22px, var(--page-bg);
  color: var(--fg); max-width: 900px; margin: 0 auto; padding: 48px 24px;
  line-height: 1.65; font-size: 13px; color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  body {
    --fg: #f4f1f8; --muted: #bbb5c2; --muted-2: #928b9b; --accent: #9188ff;
    --line: rgba(239, 235, 255, 0.2); --line-soft: rgba(239, 235, 255, 0.08);
    --page-bg: #0f0d14; --surface: #17141d; --bg-panel: #211d29;
    color-scheme: dark;
  }
}
::selection { background: var(--accent); color: #fff; }
h1 { font-weight: 500; letter-spacing: -2px; font-size: 34px; margin: 4px 0 0; }
h2 { font-weight: 500; letter-spacing: -1px; font-size: 20px; margin: 40px 0 8px; }
p { color: var(--muted); font-weight: 500; }
a { color: var(--accent); }
code { background: var(--bg-panel); border: 1px solid var(--line-soft); padding: 1px 5px; }
li { margin-bottom: 10px; }
.tag { font-size: 11px; color: var(--accent); text-transform: lowercase; }
.tag::before { content: "# "; }
.muted { color: var(--muted-2); font-size: 12px; }
.stamp { display: flex; align-items: center; gap: 11px; }
.stamp .mark { width: 27px; height: 26px; flex: none; display: block; }
.stamp-name { font-size: 15px; font-weight: 600; letter-spacing: -0.03em; }
.stamp-sub { font-size: 11px; color: var(--muted-2); text-transform: lowercase; letter-spacing: 0.02em; }
.stamp-row { border: 1px solid var(--line); background: var(--surface); padding: 12px 16px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.title-row { margin-top: 4px; }
.title-row h1 { margin: 0; }
.cta-button { font-family: inherit; font-size: 13px; font-weight: 600; color: var(--button-fg);
  background: var(--yellow); border: 1px solid var(--button-fg); padding: 8px 14px;
  text-decoration: none; white-space: nowrap; flex: none; cursor: pointer; }
.cta-button:hover { background: #f4f79f; }
.cta-button[disabled] { cursor: default; opacity: 0.65; }
.scorecard { display: flex; align-items: center; gap: 48px; border: 1px solid var(--line);
  background: var(--surface); padding: 26px 28px; margin-top: 20px; }
.grade-col { text-align: center; flex: none; width: 170px; }
.grade { font-size: 96px; font-weight: 600; line-height: 1; letter-spacing: -5px; color: var(--accent); }
.grade-label { font-size: 11px; color: var(--muted-2); margin-top: 8px; text-transform: uppercase; letter-spacing: 0.14em; }
.bars { flex: 1; display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.bar-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 7px; font-weight: 500; }
.bar-name { text-transform: lowercase; }
.bar-val { font-weight: 600; font-variant-numeric: tabular-nums; }
.bar-track { height: 8px; background: var(--line-soft); box-shadow: inset 0 0 0 1px var(--line); }
.bar-fill { height: 100%; background: var(--accent);
  animation: skill-doctor-fill 700ms cubic-bezier(0.22, 1, 0.36, 1) var(--metric-delay) both;
  transform-origin: left; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line);
  border-top: none; background: var(--bg-panel); }
.stat { padding: 16px 24px 14px; border-left: 1px solid var(--line); }
.stat:first-child { border-left: none; }
.stat .num { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.stat .lbl { font-size: 12px; color: var(--muted); margin-top: 2px; text-transform: lowercase; }
.diff-wrap { margin: 10px 0 4px; }
.diff-view { display: grid; gap: 10px; max-width: 100%;
  --diffs-font-family: var(--mono-font); --diffs-header-font-family: var(--mono-font); }
.diff-view > * { min-width: 0; }
.diff-fallback { background: var(--bg-panel); border: 1px solid var(--line); padding: 13px 16px;
  color: var(--muted); font-size: 12px; line-height: 1.7; overflow-x: auto; margin: 0; white-space: pre; }
.diff-wrap[data-overflowing="true"][data-collapsed="true"] .diff-view {
  max-height: __CLAMP__px; overflow: hidden;
  -webkit-mask-image: linear-gradient(#000 calc(100% - 72px), transparent);
  mask-image: linear-gradient(#000 calc(100% - 72px), transparent);
}
.diff-toggle { font-family: inherit; font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent); background: var(--surface);
  border: 1px solid var(--line); padding: 5px 10px; margin-top: 6px; cursor: pointer; }
.diff-toggle:hover { border-color: var(--accent); }
@keyframes skill-doctor-fill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bar-fill { animation: none; }
}
"""


def render_page(r) -> str:
    validate_report_privacy(r)
    scores = r["scores"]
    stats = r.get("stats", {})
    tasks_analyzed = stats.get(
        "tasks_analyzed",
        stats.get("tasks_sampled", stats.get("sessions_analyzed", 0)),
    )
    grade = r.get("grade") or grade_for(scores["overall"])
    generated_at = format_generated_at(r.get("generated_at"))

    metric_scores = [
        ("Efficiency", scores.get("efficiency", 0)),
        ("Code Quality", scores.get("code_quality", 0)),
        ("Skill Coverage", scores.get("skill_coverage", 0)),
    ]
    bars = "".join(
        f'<div class="bar-row"><div class="bar-head"><span class="bar-name">{esc(name)}</span>'
        f'<span class="bar-val">{"N/A" if val is None else pct(val)}</span></div>'
        f'<div class="bar-track"><div class="bar-fill" '
        f'style="width:{0 if val is None else pct(val)}%;--metric-delay:{180 + index * 110}ms"></div></div></div>'
        for index, (name, val) in enumerate(metric_scores)
    )
    stat_cells = "".join(
        f'<div class="stat"><div class="num">{esc(value)}</div><div class="lbl">{esc(label)}</div></div>'
        for value, label in [
            (tasks_analyzed, "tasks scored"),
            (stats.get("skills_found", 0), "skills installed"),
            (stats.get("skills_used", 0), "skills used"),
        ]
    )
    findings = "".join(render_finding(finding) for finding in r.get("top_findings", []))
    workflow_recommendations = "".join(
        render_workflow_recommendation(recommendation)
        for recommendation in r.get("workflow_recommendations", [])
    ) or "<li>No workflow recommendation cleared the bar for this window.</li>"
    skill_edits_data = (
        r["skill_edits"] if "skill_edits" in r else r.get("suggestions", [])
    )
    skill_edits = "".join(
        render_skill_edit(skill_edit) for skill_edit in skill_edits_data
    ) or "<li>No skill change cleared the bar for this window.</li>"

    card_data = json.dumps({
        "title": r.get("title", "Agent Skill Report"),
        "eyebrow": "skill-doctor",
        "handle": r.get("handle") or "agent skill report",
        "harness": r.get("harness", "codex"),
        "grade": grade,
        "grade_label": f"overall {pct(scores['overall'])}",
        "bars": [
            [name, None if value is None else pct(value)]
            for name, value in metric_scores
        ],
        "meta": f"{tasks_analyzed} tasks scored \u00b7 "
                f"last {stats.get('window_days', 45)} days",
        "stats": [
            [str(tasks_analyzed), "tasks scored"],
            [str(stats.get("skills_found", 0)), "skills installed"],
            [str(stats.get("skills_used", 0)), "skills used"],
        ],
        "stamp": [SHARE_STAMP_NAME, SHARE_STAMP_SUB],
        "paths": [{"d": d, "fill": fill} for d, fill in WARP_PATHS],
        "viewbox": list(WARP_VIEWBOX),
    })

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>{esc(r.get('title', 'Agent Skill Report'))}</title>
<style>{PAGE_CSS.replace('__CLAMP__', str(DIFF_CLAMP_PX))}</style></head><body>
<div class="tag">skill-doctor</div>
<div class="row title-row">
  <h1>{esc(r.get('title', 'Agent Skill Report'))}</h1>
  <button class="cta-button" id="share-png" type="button">Share</button>
</div>
<p class="muted">Generated {esc(generated_at)} &middot; harness: {esc(r.get('harness', 'codex'))}</p>
<div class="scorecard">
  <div class="grade-col"><div class="grade">{esc(grade)}</div>
    <div class="grade-label">overall {pct(scores['overall'])}</div></div>
  <div class="bars">{bars}</div>
</div>
<div class="stats">{stat_cells}</div>
<h2>Findings</h2><ul>{findings}</ul>
<h2>Workflow recommendations</h2><ol>{workflow_recommendations}</ol>
<h2>Suggested skill changes</h2><ol>{skill_edits}</ol>
<script>{embedded_diffs_script()}</script>
<script>{page_script(card_data)}</script>
</body></html>"""


def page_script(card_data: str) -> str:
    """Diff collapsing plus a canvas-drawn 1200x675 share image."""
    script = r"""
(function () {
  var CARD = __CARD__;
  var CLAMP = __CLAMP__;

  // --- collapsible diffs -------------------------------------------------
  // scrollHeight is the full content height whether or not the view is
  // currently clamped, so this measures the same either way. Only diffs that
  // actually overflow get clamped, so short ones never pick up the fade.
  function syncToggle(wrap, button) {
    var view = wrap.querySelector('.diff-view');
    if (!view) return;
    var overflowing = view.scrollHeight > CLAMP + 24;
    wrap.dataset.overflowing = overflowing ? 'true' : 'false';
    button.hidden = !overflowing;
  }

  document.querySelectorAll('.diff-wrap').forEach(function (wrap) {
    var button = wrap.querySelector('.diff-toggle');
    var view = wrap.querySelector('.diff-view');
    if (!button || !view) return;
    button.addEventListener('click', function () {
      var collapsed = wrap.dataset.collapsed === 'true';
      wrap.dataset.collapsed = collapsed ? 'false' : 'true';
      button.textContent = collapsed ? 'show less' : 'show more';
      if (!collapsed) wrap.scrollIntoView({ block: 'nearest' });
    });
    syncToggle(wrap, button);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { syncToggle(wrap, button); }).observe(view);
    }
  });

  // --- share image -------------------------------------------------------
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var FG = '#1a1522', MUTED = '#5d5966', MUTED2 = '#918d9a', ACCENT = '#2a1eff';
  var LINE = 'rgba(13,10,61,0.16)', LINE_SOFT = 'rgba(13,10,61,0.07)';
  var PANEL = '#f6f5fb';
  var W = 1200, H = 675;

  function drawMark(c, x, y, size) {
    var scale = size / CARD.viewbox[0];
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    CARD.paths.forEach(function (path) {
      c.fillStyle = path.fill;
      c.fill(new Path2D(path.d), 'evenodd');
    });
    c.restore();
  }

  function drawCard(scale) {
    var canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    var c = canvas.getContext('2d');
    c.scale(scale, scale);

    function font(weight, size) { c.font = weight + ' ' + size + 'px ' + MONO; }
    function track(value) { try { c.letterSpacing = value; } catch (e) {} }
    function rule(x, y, w, h) { c.fillStyle = LINE; c.fillRect(x, y, w, h); }
    function text(str, x, y, align) {
      c.textAlign = align || 'left';
      c.textBaseline = 'middle';
      c.fillText(str, x, y);
      c.textAlign = 'left';
    }
    function dots(x, y, w, h, step) {
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.fillStyle = LINE_SOFT;
      for (var i = x; i < x + w; i += step) {
        for (var j = y; j < y + h; j += step) {
          c.beginPath();
          c.arc(i + 1, j + 1, 1, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }

    c.fillStyle = '#fff';
    c.fillRect(0, 0, W, H);
    dots(0, 0, W, H, 22);

    var fx = 48, fy = 40, fw = 1104, fh = 595;
    c.fillStyle = '#fff';
    c.fillRect(fx, fy, fw, fh);
    rule(fx, fy, fw, 1);
    rule(fx, fy + fh - 1, fw, 1);
    rule(fx, fy, 1, fh);
    rule(fx + fw - 1, fy, 1, fh);

    // meta bar
    var barBottom = fy + 38;
    rule(fx, barBottom, fw, 1);
    font('400', 11);
    track('1.1px');
    c.fillStyle = MUTED2;
    var handle = CARD.handle.toUpperCase();
    text(handle, fx + 16, fy + 19);
    var handleEnd = fx + 16 + c.measureText(handle).width + 14;
    var harness = CARD.harness.toUpperCase();
    var harnessW = c.measureText(harness).width + 12;
    var harnessX = fx + fw - 16 - harnessW;
    c.strokeStyle = LINE;
    c.lineWidth = 1;
    c.strokeRect(harnessX + 0.5, fy + 8.5, harnessW - 1, 21);
    text(harness, harnessX + 6, fy + 19);
    var meta = CARD.meta.toUpperCase();
    var metaX = harnessX - 14 - c.measureText(meta).width;
    text(meta, metaX, fy + 19);
    rule(handleEnd, fy + 19, Math.max(0, metaX - 14 - handleEnd), 1);
    track('normal');

    // body
    dots(fx + 1, barBottom + 1, fw - 2, 404, 26);
    font('400', 11);
    track('0.4px');
    c.fillStyle = ACCENT;
    text('# ' + CARD.eyebrow, fx + 36, barBottom + 18);
    font('500', 34);
    track('-2px');
    c.fillStyle = FG;
    text(CARD.title, fx + 36, barBottom + 52);
    track('normal');

    var mainMid = barBottom + 74 + (405 - 74) / 2;

    font('600', 170);
    track('-8px');
    c.fillStyle = ACCENT;
    text(CARD.grade, fx + 186, mainMid - 15, 'center');
    track('normal');
    font('400', 11);
    track('1.5px');
    c.fillStyle = MUTED2;
    text(CARD.grade_label.toUpperCase(), fx + 186, mainMid + 88, 'center');
    track('normal');

    var bx = fx + 392;
    var bw = fx + fw - 36 - bx;
    var rowH = 35, gap = 28;
    var top = mainMid - (3 * rowH + 2 * gap) / 2;
    CARD.bars.forEach(function (bar, index) {
      var y = top + index * (rowH + gap);
      font('500', 14);
      c.fillStyle = FG;
      text(bar[0].toLowerCase(), bx, y + 9);
      font('600', 14);
      var barValue = typeof bar[1] === 'number' ? bar[1] : null;
      text(barValue === null ? 'N/A' : String(barValue), bx + bw, y + 9, 'right');
      c.fillStyle = LINE_SOFT;
      c.fillRect(bx, y + 27, bw, 8);
      c.strokeStyle = LINE;
      c.strokeRect(bx + 0.5, y + 27.5, bw - 1, 7);
      c.fillStyle = ACCENT;
      c.fillRect(bx, y + 27, bw * Math.max(0, Math.min(100, barValue || 0)) / 100, 8);
    });

    // stats
    var sy = barBottom + 405;
    c.fillStyle = PANEL;
    c.fillRect(fx + 1, sy, fw - 2, 96);
    rule(fx, sy, fw, 1);
    var colW = (fw - 2) / 3;
    CARD.stats.forEach(function (stat, index) {
      var cx = fx + 1 + index * colW;
      if (index) rule(cx, sy, 1, 96);
      font('600', 40);
      c.fillStyle = FG;
      text(stat[0], cx + 24, sy + 40);
      font('400', 12);
      c.fillStyle = MUTED;
      text(stat[1], cx + 24, sy + 72);
    });

    // footer
    var gy = sy + 96;
    c.fillStyle = '#fff';
    c.fillRect(fx + 1, gy, fw - 2, fy + fh - gy - 1);
    rule(fx, gy, fw, 1);
    drawMark(c, fx + 16, gy + 15, 27);
    font('600', 15);
    track('-0.45px');
    c.fillStyle = FG;
    text(CARD.stamp[0], fx + 54, gy + 20);
    track('normal');
    font('400', 11);
    c.fillStyle = MUTED2;
    text(CARD.stamp[1], fx + 54, gy + 37);

    return canvas;
  }

  function slug(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent';
  }

  var button = document.getElementById('share-png');
  button.addEventListener('click', function () {
    var label = button.textContent;
    button.disabled = true;
    var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
    ready.then(function () {
      drawCard(2).toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = slug(CARD.handle) + '-skill-report.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        button.disabled = false;
        button.textContent = 'saved \u2713';
        setTimeout(function () { button.textContent = label; }, 2000);
      }, 'image/png');
    });
  });
})();
"""
    return script.replace("__CARD__", card_data.replace("</", "<\\/")).replace("__CLAMP__", str(DIFF_CLAMP_PX))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "report_path",
        help="Path to the report.json file",
    )
    parser.add_argument(
        "--inventory",
        help="inventory.json used to reject local IDs and paths from shareable output",
    )
    parser.add_argument(
        "--aggregation",
        help="aggregation.json used to verify deterministic v2 scores and coverage",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        dest="open_browser",
        help="Open the generated report in the default browser",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    report_path = Path(args.report_path).expanduser()
    if not report_path.exists():
        print(f"error: {report_path} not found", file=sys.stderr)
        sys.exit(1)
    r = json.loads(report_path.read_text())
    sensitive_values = set()
    inventory = None
    if args.inventory:
        inventory_path = Path(args.inventory).expanduser()
        if not inventory_path.exists():
            print(f"error: inventory not found", file=sys.stderr)
            sys.exit(1)
        inventory = json.loads(inventory_path.read_text())
        sensitive_values = inventory_sensitive_values(
            inventory,
            report_path,
        )
    elif r.get("methodology_version") == 2:
        print("error: methodology v2 reports require --inventory", file=sys.stderr)
        sys.exit(1)
    if r.get("methodology_version") == 2:
        if not args.aggregation:
            print("error: methodology v2 reports require --aggregation", file=sys.stderr)
            sys.exit(1)
        aggregation_path = Path(args.aggregation).expanduser()
        if not aggregation_path.exists():
            print("error: aggregation not found", file=sys.stderr)
            sys.exit(1)
        aggregation = json.loads(aggregation_path.read_text())
        validate_report_schema(r, inventory)
        validate_report_aggregation(r, aggregation, inventory)
    validate_report_privacy(r, sensitive_values)
    r["grade"] = grade_for(r["scores"]["overall"])

    out_path = report_path.parent / "report.html"
    out_path.write_text(render_page(r))
    print(f"report: {out_path.absolute().as_uri()}")
    if args.open_browser:
        if open_report(out_path):
            print("        opened in the default browser")
        else:
            print(
                "warning: could not open the report in the default browser",
                file=sys.stderr,
            )
    print('        use "share as png" for a 1200x675 share image')


if __name__ == "__main__":
    main()
