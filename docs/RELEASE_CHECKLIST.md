# Production Release Checklist

Production deployment requires the owner's explicit approval. This checklist
is the release gate; exact commands live in [DEPLOYMENT.md](DEPLOYMENT.md) and
the active provider runbook, currently [YANDEX_CLOUD.md](YANDEX_CLOUD.md).

## Product And UX

- [ ] Release scope and primary player-visible signal are explicit.
- [ ] MVP plan/issues and player-facing rules match the released behavior.
- [ ] Critical registration, login, room, Tender, reconnect, completion, history,
      and logout paths affected by the release are verified at the appropriate
      boundary.
- [ ] Relevant loading, empty, disabled, submitting, accepted, waiting, error,
      conflict, deadline, reconnect, recovered, and completed states are checked.
- [ ] Rendered desktop and mobile release matrix is complete for affected UI;
      keyboard, focus, text zoom, reduced motion, and long content are included
      where applicable.
- [ ] Isolated-player checks prove that a participant and non-participant receive
      only authorized public/private Tender data.
- [ ] Legal/support copy and contacts are published only when their operational
      channel and product contract are verified.

## Source And Quality

- [ ] `origin`, release branch, upstream, and full commit SHA are recorded.
- [ ] Applicable audit contours from [AUDIT_GUIDE.md](AUDIT_GUIDE.md) are
      recorded; every required, blocked, and not-applicable check has evidence
      or a reason and residual risk.
- [ ] Worktree is clean; the release commit is pushed and not ahead, behind, or
      diverged from its expected upstream.
- [ ] `bun run check` passed on the exact release commit.
- [ ] Mandatory GitHub Actions checks `checks` and `e2e` are green for that exact
      commit; branch protection did not rely on a manual bypass.
- [ ] Dependency audit and tracked/staged secret hygiene passed without exposing
      findings in logs.
- [ ] Backend image uses the full release SHA or immutable digest; static builds
      have recorded SHA-256 checksums and contain no localhost/test origins,
      secrets, or private data.
- [ ] Trivy scanned that exact backend image with the repository-owned pinned
      runner; the deployed API and worker image ID/digest will be compared with
      the scanned artifact after the switch.

## Data And Rollback

- [ ] Prisma migration set and production migration state are recorded.
- [ ] New migrations are backward compatible with the immediate rollback
      application; destructive contract steps are deferred to a later release.
- [ ] Latest production backup identifier and completion are recorded.
- [ ] `bun run drill:postgres:backup-restore` passed locally and the current
      production-like restore drill evidence is available.
- [ ] Current and immediate-rollback Compose, image, release directory, static
      artifacts, and configuration references are retained.
- [ ] Active and rollback volume names are recorded; PostgreSQL data volume
      identity is confirmed. No broad image, container, or volume prune is used.
- [ ] Rollback trigger, operator, command sequence, data consequences, and
      forward-fix alternative are understood before switching traffic.

## Runtime And Public Verification

- [ ] Prisma deploy completed exactly once before stateless application switch.
- [ ] API and worker container-internal `/health/live` and `/health/ready` pass;
      neither container is crash-looping.
- [ ] Public API readiness returns the documented status through HTTPS; worker
      health and service ports remain private.
- [ ] Webapp and website return expected checksums; the public root serves the
      website and returns `404` for unknown paths, while player route refreshes
      use only the player-host SPA fallback.
- [ ] `www` redirects to the public root; every fixed legacy player route keeps
      its path/query while moving to the player host; no arbitrary redirect
      target is accepted.
- [ ] Public canonical/robots/sitemap values contain no player/operator routes;
      the player host returns the release `X-Robots-Tag` noindex policy.
- [ ] CORS accepts only expected production origins; authentication cookies,
      refresh, logout, WebSocket ticketing, and reconnect work from the public
      player origin.
- [ ] `WEBAPP_ORIGIN` equals the player origin and is present in CORS; the public
      website is absent from credentialed CORS, OAuth rejects every other
      browser return origin, and provider success/error callbacks return to the
      player host while the registered callback remains on the API host.
- [ ] Adminapp is absent from public buckets, returns `401` without edge auth,
      and still enforces backend UUID allowlisting after edge authentication.
- [ ] Recent API, worker, PostgreSQL, Caddy, and system logs contain no new fatal,
      unhandled, migration, auth, or repeated reconnect errors.
- [ ] If SSH, VM image, host OS, firewall, network, or Security Groups changed,
      the applicable external ssh-audit, perimeter review, and Lynis host audit
      have current evidence or an explicit blocked/risk decision.
- [ ] Monitoring shows API/worker health, disk and PostgreSQL-volume free space,
      memory, restarts, and configured alerts; current values are recorded.
- [ ] Active and rollback artifacts remain recoverable after exact-name cleanup.

## Release Record

Record the full commit SHA, CI run, immutable image/digest, static checksums,
migrations, backup, active/rollback artifacts and volumes, health results,
monitoring snapshot, cleanup result, operator, start/end time, and remaining
risks. Never record secret values.
