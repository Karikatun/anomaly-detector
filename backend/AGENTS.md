# Backend Instructions

## Grounding And Boundaries

- Read root `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and the relevant module, contract, storage, deployment, or ADR documents before non-trivial work.
- Product contexts live in `backend/src/modules/<context>`. Expose cross-context behavior only through `index.ts` or explicit application ports.
- Keep Hono/HTTP concerns in transport, orchestration in application, pure business rules in domain when real rules exist, and Prisma/provider SDKs in infrastructure.
- Fix the owning context. Do not bypass module boundaries, deep-import another context, access another context's Prisma model directly, or make transport depend on provider SDKs.
- Prefer existing ports and repository patterns. Do not add generic repositories, empty layers, CQRS, event sourcing, or services without current product need.

## Change Surface

- For contracts or schemas, inspect producers, consumers, serializers, generated clients, validation, and frontend callers.
- For auth, permissions, or sessions, inspect request validation, guards, application enforcement, persistence, session shape, serializers, and affected user-visible states.
- For persistence changes, inspect schema, migrations, transactions, concurrency, query semantics, read/write paths, and recovery behavior.
- For async work, inspect retries, idempotency, ordering, cancellation, side effects, and failure visibility.

## Prisma

- Express schema changes declaratively in `schema.prisma` and generate migrations with the repository workflow.
- Do not hand-write or customize `migration.sql` unless the user explicitly requests that exception.
- Put backfills, preconditions, rollout guards, and extra safety checks in the owning backend layer or an existing repository-supported workflow.
- Use `docs/LOCAL_DATABASE.md` and `docker-compose.yml` as the local PostgreSQL source of truth. Default to Docker Compose and never point isolated tests at a non-test database.

## Validation

- Follow `docs/TESTING.md` and use the highest-confidence practical boundary: contract/integration tests for API, auth, persistence, and transactions; unit tests for pure rules.
- Cover relevant success, validation, permission, persistence, conflict, concurrency, and recovery cases.
- Run targeted tests first. Run `bun run architecture:check` for boundary changes and validate every affected producer and consumer.
