# Security Policy

## Reporting A Vulnerability

Do not disclose an exploitable vulnerability, credentials, private player data,
session material, or reproduction details in a public issue, pull request, chat,
log, or screenshot.

Use GitHub private vulnerability reporting when it is enabled for
`Karikatun/anomaly-detector`. Otherwise contact the repository owner through an
already verified private channel and share only the minimum information needed
to establish a secure follow-up channel. `support@anomaly-detector.ru` must not
be advertised as the vulnerability channel until inbound and outbound delivery
has been verified and the owner has explicitly assigned incident handling there.

Before the controlled public test, the owner must record a tested private
reporting channel and an incident owner here or in GitHub repository security
settings.

## Security Invariants

- Authentication, permissions, ownership, deadlines, game rules, scoring, and
  private/public Tender projections are enforced by the backend. Client guards
  and hidden UI are not security boundaries.
- All external request and response data is validated through shared contracts
  at producer and consumer boundaries.
- Secrets remain outside Git and static bundles. `.env.example` files contain
  key names and safe placeholders only.
- Logs, fixtures, screenshots, traces, exports, and support diagnostics must not
  contain tokens, cookies, passwords, private Tender state, raw personal data,
  or secret-bearing provider payloads.
- Browser auth uses exact allowed origins and server-side origin enforcement;
  wildcard credentialed CORS is forbidden.
- Production images and actions are pinned immutably. A release requires an
  exact commit, green mandatory CI, backup/recovery evidence, health checks, and
  a verified rollback path.
- Security controls must not be weakened to make a test, release, demo, or
  integration pass.

`bun run security:secrets` scans tracked repository content. The staged scan in
the pre-commit hook checks the exact future commit without printing a detected
secret. GitHub Actions repeats secret hygiene and runs the dependency audit
independently of bypassable local hooks.

The remote static-security job also runs full-history Gitleaks, repository-owned
Semgrep rules, and Trivy configuration checks. After Docker smoke builds the
exact backend image, Trivy scans its OS and application packages for high and
critical vulnerabilities. Scanner containers are versioned and digest-pinned in
`.security/tools.json`; Gitleaks exceptions identify only reviewed historical
test-fixture fingerprints.

Use [`docs/AUDIT_GUIDE.md`](docs/AUDIT_GUIDE.md) to select security and adjacent
product, architecture, UX, release, and operational checks by lifecycle stage.
Agents must record their selection and coverage gaps through
[`docs/agents/audit-checklist.md`](docs/agents/audit-checklist.md); a scanner
result without the owning behavioral or runtime evidence is not a completed
audit.

`bun run security:zap` performs authenticated active attacks against a temporary
backend and isolated `_test` PostgreSQL database. It removes the account-delete
operation from its generated scan document, destroys its test data afterward,
and redacts the temporary access token from reports. Never point this command or
the scheduled Dynamic Security workflow at production or shared development
data.

## Mandatory Threat Review

A task requires an explicit threat review when it changes authentication,
sessions, OAuth, permissions, player privacy, operator access, cryptography,
rate limits, audit events, personal-data handling, storage, production network
boundaries, migrations, backup/restore, or legal/security copy.

Answer at least:

1. Which data, action, resource, or invariant is protected?
2. Who is the actor, and which backend permission or ownership check applies?
3. What can an unauthenticated user, non-participant, participant, and operator
   observe or change?
4. Can replay, race, duplicate delivery, reconnect, timeout, or retry apply the
   action twice or reveal stale/private state?
5. What is logged or audited, and can it contain secrets or personal data?
6. How do denial, partial failure, recovery, deletion, and rollback behave?
7. Which contract, integration, E2E, or manual isolation check proves the
   boundary?

## Incident Handling

For a suspected incident:

1. preserve evidence without publishing or broadly copying sensitive data;
2. identify affected accounts, sessions, Tender data, releases, and time range;
3. contain through the narrowest reversible control;
4. rotate or revoke only credentials proven or reasonably suspected exposed;
5. verify application and infrastructure health after containment;
6. assess notification, personal-data, legal, and support obligations;
7. document root cause, recovery, and a test or enforceable guard before closure.

Do not destroy logs, reset production data, rotate unrelated credentials, or
redeploy blindly before the affected boundary and recovery consequences are
understood.
