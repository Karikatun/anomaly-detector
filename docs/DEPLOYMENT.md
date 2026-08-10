# Release And Deployment Entry Point

Use this document only after the user has explicitly requested deployment or a
cloud-resource change. The current production provider is Yandex Cloud; the
provider-specific procedure is in [YANDEX_CLOUD.md](YANDEX_CLOUD.md).
[DIGITALOCEAN.md](DIGITALOCEAN.md) is a maintained alternative runbook and is not
the default production path.

## Release Scope

Before changing external state, identify:

- the surfaces in this release: backend/API, worker, webapp, website, adminapp,
  or a deliberately selected subset;
- the target environment and public/private hosts;
- whether the release changes contracts, Prisma schema, storage, auth,
  permissions, privacy, rate limits, Caddy, or monitoring;
- whether a maintenance window or user-facing communication is required;
- the exact primary signal and the internal/public checks that will prove it.

Do not ask the user to reselect a cloud provider during routine releases. A
provider change is a separate architecture, cost, security, migration, and
rollback decision.

## Release Source Preflight

Before building or deploying:

```bash
git remote -v
git status --short --branch
git rev-parse HEAD
git rev-parse @{upstream}
```

Continue only when all of the following are true:

- `origin` is the intended Anomaly Detector repository;
- the intended release branch is checked out and tracks the expected upstream;
- the worktree has no modified, deleted, or untracked files;
- the exact release commit is pushed and the branch is not ahead, behind, or
  diverged;
- mandatory CI is green for that exact commit;
- the release scope and rollback target are unambiguous.

Stop on ambiguity or dirtiness. Do not use reset, checkout, clean, stash, amend,
or another history/worktree mutation to manufacture a releasable state.

## Required Evidence

Before release approval, complete [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
and record:

- full commit SHA, immutable image digest/tag, and static release checksums;
- exact successful local gates and CI run/status checks;
- current and rollback Compose/release/image references;
- Prisma migration state and compatibility with the rollback application;
- latest backup identifier plus the result of a recovery drill;
- active and rollback volume identities, including the PostgreSQL data volume;
- internal API and worker health, public health, main player route, operator
  concealment/auth, logs, and monitoring state.

Do not print secret values. Record required environment key names and whether
they are present, not their contents.

## Release Order

The provider runbook owns exact commands. The invariant order is:

1. verify the immutable release source and green checks;
2. capture active/rollback artifacts, volumes, migrations, backup, and health;
3. build immutable artifacts from the exact commit and record checksums;
4. verify backup/recovery readiness;
5. apply backward-compatible Prisma migrations before switching stateless
   application components;
6. switch API/worker, then verify container-internal health and logs;
7. publish static player/public/operator artifacts only after their owning
   backend contract is healthy;
8. verify public HTTPS, CORS, WebSocket/reconnect, player privacy, operator
   protection, checksums, alerts, and disk state;
9. clean up only exact artifacts proved outside the active and immediate
   rollback sets.

Never stop PostgreSQL for a routine release. Never run
`docker system prune --volumes`, `docker volume prune`, or delete a volume merely
because Docker reports it as unused.

## Provider Runbooks

- Current production: [Yandex Cloud](YANDEX_CLOUD.md)
- Explicit alternative: [DigitalOcean](DIGITALOCEAN.md)
- Persistent objects and media: [Storage](STORAGE.md)
- Local and recovery database procedures: [Local PostgreSQL](LOCAL_DATABASE.md)
- CI protection: [CI](CI.md)
- Vulnerability and security policy: [Security](../SECURITY.md)
