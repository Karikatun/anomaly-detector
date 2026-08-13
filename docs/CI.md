# Continuous Integration And Branch Protection

The repository workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
It runs for pull requests and pushes to `main`, `master`, and `mobile` without
production secrets.

## Current Mandatory Jobs

### `security-static`

The job runs independently of the build and test jobs:

- Gitleaks against the complete Git history with redacted output;
- the repository-owned high-confidence Semgrep rules;
- Trivy misconfiguration checks for Docker and repository infrastructure.

### `checks`

The job installs dependencies from `bun.lock` and runs:

- dependency audit and tracked-secret hygiene;
- typecheck, production builds, architecture boundaries, and client lint;
- deployment/tooling, contracts, webapp, adminapp, and backend tests;
- backend Docker smoke against isolated test infrastructure;
- Trivy vulnerability scanning of the exact image produced by Docker smoke.

### `e2e`

The job installs the Chromium revision owned by the locked `webapp` Playwright
workspace and runs `bun run e2e:webapp` through the real browser/backend/test
database stack.

All three jobs are required because local hooks can be bypassed, static and
supply-chain scans do not replace behavioral tests, and `checks` does not
replace the user-visible cross-layer signal protected by `e2e`.

## Scheduled Active Security

[`security-dynamic.yml`](../.github/workflows/security-dynamic.yml) runs weekly
and on manual dispatch. It creates an isolated `_test` PostgreSQL database and
temporary authenticated account, performs an active ZAP API scan, destroys the
test database, redacts the temporary token, and retains the sanitized report for
seven days. It is intentionally not a pull-request trigger because active DAST
builds a separate backend image and sends mutating attack payloads.

## Branch Protection

Use `dev` as the default branch for external contributions. Configure a GitHub
ruleset for every active release branch, including `master`:

1. require a pull request when the team's delivery process uses PR review;
2. require the current `security-static`, `checks`, and `e2e` status checks before merge;
3. require the branch to be up to date when a stale base can invalidate results;
4. reject merge while a required check is pending, skipped, cancelled, timed
   out, or failed;
5. limit bypass to named emergency maintainers and audit every use;
6. protect branch deletion and force pushes.

The repository-owned `Enforce master PR access` workflow closes a pull request
to `master` when its author does not have GitHub `write`, `maintain`, or `admin`
permission. It does not check out or execute pull-request code. This is a
routing control: GitHub itself still allows a public-repository user to create
such a PR. Contributors should target `dev`; maintainers decide which `dev`
changes are promoted to `master`.

A workflow file does not enforce merge policy by itself. The ruleset in GitHub
must name the actual current job checks. After renaming, adding, splitting, or
removing a job, update this document and the repository ruleset in the same
delivery task. Repository settings are external state and require explicit user
authorization.

## Local Equivalents

```bash
bun run check:commit
bun run check:push
bun run check
bun run security:gitleaks
bun run security:semgrep
bun run security:trivy:config
```

After building a backend image, scan that exact local tag with
`bun run security:trivy:image <image>`. Run `bun run security:zap` separately;
it is destructive only to the isolated `_test` database it creates.

- pre-commit scans the staged index for secrets and runs `check:commit`;
- commit-msg enforces the repository's Conventional Commit format;
- pre-push runs the full `check`, including integration, build, Docker smoke,
  and browser E2E.

Use local checks for fast feedback, but treat green required remote checks on
the exact release commit as the publication boundary.

## Diagnosing A Failure

1. Open the first failing job and step, or use `gh run view <run-id> --log-failed`.
2. Record the exact non-zero command and first causal error; do not attribute the
   failure to an unrelated warning.
3. Reproduce with the narrowest local equivalent while preserving isolated
   ports and `_test` database safeguards.
4. Fix the owning code, workflow, lockfile, or environment contract. Do not add
   retries, lower gates, skip tests, or use `--no-verify` as the fix.
5. Run the targeted check, then the affected job's full local equivalent, and
   confirm the remote job on the exact commit.

Do not repeatedly rerun an unexplained failure: a retry is evidence only when a
known transient external dependency has been identified and bounded.
