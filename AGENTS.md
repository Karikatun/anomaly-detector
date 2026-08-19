# AGENTS.md

## Operating Standard

- Answer in the user's language and communicate product impact without requiring technical expertise.
- Act autonomously by default: inspect, decide, implement, validate, and report. Ask only when ambiguity blocks a safe decision, a product choice is genuinely open, or an action is risky or destructive.
- Start from repository evidence. Trust current code, schemas, scripts, tests, and runtime output over assumptions or stale docs.
- Preserve unrelated user changes. Keep diffs focused and use the lightest workflow that can prove the result.
- Own architecture, implementation, quality, security, performance, maintainability, tests, and documentation for touched and directly coupled surfaces.

## Scope Routing

- Read `README.md`, root `CONTEXT.md`, relevant `docs/`, and applicable ADRs for non-trivial work. Discover the current structure rather than treating README as a file inventory.
- For backend, contract, persistence, auth, or API work, read `backend/AGENTS.md`.
- For player web application work, read `webapp/AGENTS.md`. For substantial UI, UX, responsive, animation, design-system, or rendered-flow work in any client, use `$anomaly-ui`.
- For mobile application or Maestro work, read `mobile/AGENTS.md`.
- For testing strategy and commands, use `docs/TESTING.md`. For deployment or infrastructure, read the relevant runbook in `docs/`, especially `DEPLOYMENT.md`, `STORAGE.md`, `LOCAL_DATABASE.md`, or `YANDEX_CLOUD.md`.
- For vulnerability handling and security-sensitive changes, read `SECURITY.md` and use `$anomaly-security-review`. For CI protection and release approval, use `docs/CI.md` and `docs/RELEASE_CHECKLIST.md`.
- For every non-trivial task, select the applicable product, architecture, quality, security, UX, performance, release, and operational checks from `docs/AUDIT_GUIDE.md`, then complete `docs/agents/audit-checklist.md`. Mark skipped checks `N/A` or `BLOCKED` with the reason and residual risk; never silently omit an applicable audit.
- Tasks and PRDs live in GitHub Issues. Use the workflow in `docs/agents/issue-tracker.md` and labels in `docs/agents/triage-labels.md`. Maintain domain docs according to `docs/agents/domain.md`.
- Use the repository package manager, scripts, test runner, formatter, linter, build tools, generators, existing utilities, and installed dependencies. Do not add dependencies without explicit approval unless the user requested that dependency by name.
- In Codex shell sessions, do not assume JavaScript tooling is on `PATH`; when needed use `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"`.

## Product Context

- Anomaly Detector is a dark, serious, restrained corporate sci-fi multiplayer game.
- Write player-facing, product, and domain documentation in Russian. Keep English for code identifiers, stable data keys, and required external technical terms.
- Keep durable product, architecture, infrastructure, deployment, storage, testing, and provider decisions in README files, `docs/`, ADRs, and owning scripts rather than this file.
- Prefer a monolithic backend and the progressive DDD-lite boundaries in `docs/ARCHITECTURE.md`. Do not introduce microservices, CQRS, event sourcing, state-machine libraries, empty layers, or generic repositories without a concrete product need.

## Git And Remote Safety

- Inspect `git remote -v` before branch, commit, push, PR, or deployment workflows. Work on `master` unless the user explicitly requests otherwise; do not create or switch branches without request.
- This is the established Anomaly Detector product repository. Do not remove or replace `origin` during documentation or repository cleanup; stop if it does not point to the expected product repository.
- Never bypass versioned hooks with `--no-verify` without explicit authorization.
- After a task changes project files and its mandatory checks pass, stage only that task's coherent diff and create one Conventional Commit. Do not commit unrelated user changes or a result whose primary signal or mandatory gate still fails.
- Do not amend, rebase, reset, stash, push, open a PR, deploy, delete files, or create worktrees unless explicitly asked. Preserve hooks and the repository's enforced commit format.

## Task Mode And Acceptance

- Classify before editing; state the mode only when it clarifies scope:
  - `Review`: read-only evaluation or recommendation. Report evidence and do not edit.
  - `Direct`: obvious local or visual-only change without behavioral impact. Inspect nearby usage and run narrow validation.
  - `Investigation`: unclear failure or performance problem. Reproduce or trace it, use the diagnosing workflow, and find the owning layer before patching. Reframe after two attempts that do not move the primary signal.
  - `TDD-first`: behavior, contracts, auth, permissions, persistence, validation, routing, state transitions, concurrency, or non-trivial user-facing behavior. Use the TDD workflow and start with the highest-value failing test at the highest-confidence practical boundary.
- Frontend visual-only work is `Direct` unless it changes behavior, accessibility semantics, navigation, validation, permissions, persistence, or meaningful state transitions.
- For non-trivial work, define 3–5 observable pass/fail criteria when useful. Identify the primary user-visible or runtime signal and the smallest relevant secondary checks.
- Proceed on obvious, low-risk local choices. Present at most two options and recommend one when product behavior, architecture, cost, ownership, data exposure, rollout risk, or timeline materially changes.
- Ask before destructive, irreversible, security-sensitive, privacy-sensitive, or broad data-affecting actions. Never declare success while the primary signal fails.

## Engineering Discipline

- Trace enough of the vertical path and its directly coupled consumers to find the owning layer. Do not turn research into wandering.
- Fix the owning layer. Do not hide upstream mistakes with leaf fallbacks, defensive state repair, duplicated decisions, flags, or wrappers.
- Prefer the smallest coherent change, local clarity, and decoupling over clever reuse or the smallest textual diff. Treat one-file fixes for cross-layer behavior as suspicious until proven otherwise.
- Add abstractions, helpers, services, folders, scripts, or generators only when they remove current complexity. Small intentional duplication is better than the wrong shared abstraction.
- When a contract or schema changes, inspect producers, consumers, serializers, generated clients, validation, and both read/write paths.
- For auth, permissions, async workflows, routes, queries, and persistence, inspect the relevant success, failure, boundary, loading, empty, retry, stale, ordering, idempotency, and recovery states.
- For legal, billing, privacy, security, or support copy, preserve the product contract and flag ambiguity.
- Do not move business rules into routes, screens, providers, or UI primitives to avoid defining their application or domain owner.
- For migrations or re-architecture, state scope, risks, compatibility, rollout order, and recovery path.

## Testing And Validation

- Run the smallest meaningful validation that covers the changed surface, using fast targeted feedback before broader suites.
- Run `bun run architecture:check` when module, feature, contracts, platform, or UI dependency boundaries change.
- Prefer stable user-visible confidence: maintainable E2E for critical cross-layer journeys, integration or contract tests for API/auth/persistence/contracts, and unit tests for pure rules and deterministic helpers.
- Do not add automated tests for cosmetic CSS details. Validate visual-only work through rendered inspection according to `$anomaly-ui`.
- Validate both producer and consumer sides of shared contracts. Treat non-zero exits, runtime errors, failed assertions, type/lint/build errors, and timeouts as failures.
- Green proxy checks do not override a broken primary signal. If validation is incomplete or impossible, report exactly what was and was not proved and the next useful check.

## Documentation And Operations

- Code is the implementation source of truth. Update README/docs only when changes materially affect architecture, setup, operations, contracts, user flows, or durable decisions; avoid documentation churn for self-evident changes.
- Before deployment or cloud changes, use repository runbooks and scripts, then verify remote, branch, exact commit, clean worktree, and synchronization. Stop on ambiguity or dirtiness; do not reset, clean, checkout, or stash to manufacture a releasable state.
- Keep durable storage and media decisions in `docs/STORAGE.md` and provider-specific deployment docs.

## Safety And Workspace Hygiene

- Never stop or kill unrelated processes to free ports; use isolated ports and test configuration.
- Do not introduce CI/CD, hosted automation, deployment ceremony, or dependencies unless requested or approved. Add automation only for demonstrated repeated pain.
- Never expose secrets, credentials, cookies, customer data, private keys, or raw `.env` values in code, fixtures, docs, screenshots, logs, tool output, or final reports.
- Put investigation artifacts under `./.scratch/` or a tool-owned artifact directory, not the repository root.
- Do not weaken auth, permissions, validation, encryption, rate limits, auditability, or production safeguards to complete a task.
- Do not manually edit generated files unless the repository requires it; update the source and run the generator.

## Learning Loop

- After non-trivial work, use `$learn-from-task` only for evidence-backed lessons likely to recur.
- Store repository rules in `AGENTS.md`, reusable procedures in skills, architecture decisions in ADRs, and enforceable invariants in tests, linters, or hooks. Do not persist temporary or uncertain information.
- Show the proposed diff and obtain explicit approval before writing any learning artifact.

## Completion Report

- Lead with what changed and why; include the root cause and affected layers when useful.
- Report `Primary signal status` and exact `Secondary signal status`; identify incomplete checks, risks, migrations, rollout notes, or documentation drift.
- For Direct or Review tasks, keep the report compact. A task is not complete if the visible symptom is hidden while the coupled mechanic remains inconsistent.
- After a completed task that changed project files, report `Commit: <short-sha> <title>` for the task-scoped Conventional Commit. For read-only work or a task without file changes, state that no commit was required.
