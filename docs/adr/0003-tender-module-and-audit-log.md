# Tender Module And Audit Log

The Tender Module is the sole application seam for Tender creation, player commands, participant-scoped views, and due-time advancement. It owns room lifecycle, Anomaly Configuration, phase rules, timers, Rating, and audit events behind `createTender`, `execute`, `readTenderView`, and `advanceDueTenders`; HTTP and realtime adapters do not implement game rules.

The public module index composes adapters and exports the facade. The injected
application service orchestrates commands and deadlines through `TenderStore`;
it does not import database clients or concrete stores. Independently changing
rules such as Contract eligibility, phase timing, final ranking, and access-slot
resolution are pure domain modules. Audit and cross-context read models are
separate application projections. This keeps the four-operation facade stable
without making its public index the owner of policy.

PostgreSQL stores current Tender state as the write model, while an append-only audit log records accepted commands and resolved events for deterministic participant replays. This is deliberately not event sourcing: the audit log exists for fairness, explanation, and recovery, without making every application read path reconstruct state from events.

## Public Interface

The public application interface consists of exactly four asynchronous methods:

```ts
type TenderModule = {
  createTender(input: CreateTender): Promise<{ tenderId: TenderId }>
  execute(command: TenderCommand): Promise<CommandReceipt>
  readTenderView(query: TenderViewQuery): Promise<TenderView>
  advanceDueTenders(input: { now: Date; limit: number }): Promise<AdvanceResult>
}
```

`TenderCommand` always contains a `commandId`, `tenderId`, and authenticated `actorId`, followed by a discriminated command payload. `commandId` supports idempotent retry and audit correlation. `execute` returns only an acceptance receipt and the resulting Tender version; realtime transport obtains a separately projected view for each participant and does not receive another participant's private data as a command result.

`TenderViewQuery` contains `tenderId` and the authenticated participant identity. `readTenderView` is the only read path for a live Tender, so it applies the participant's visibility rules before returning public state and authorised private data.

`advanceDueTenders` is called by the worker for deadlines and reconnection-safe timeout resolution. It owns timer consequences and writes the corresponding audit records; adapters must not resolve timeouts themselves.

The API's realtime hub synchronises the versions of actively subscribed Tenders from the shared store. This lets clients receive a timeout update when a separate worker performed the commit; it is a delivery mechanism only and does not implement or duplicate game rules.

Realtime uses private close code `4404` with the generic reason `Unavailable` for a concealed missing-Tender, non-participant, or forfeited-player denial. Operational read failures close with `1011` so the client reconnects and refetches its authorised view. Clients keep the formerly overloaded `4403` retryable during rolling deployment and rollback; old/new pairs may reconnect until both sides have drained, but they do not turn an operational failure into a permanent access denial. A failed established subscription is removed and closed, while other subscribers continue independently; disconnect during initial subscription must also release any late-created subscription.

The initial in-memory implementation establishes this public interface for TDD. Milestone 1 replaces its storage with PostgreSQL and an audit log without changing the interface shape.

Cross-context reads do not expand this command/view facade. Tender separately
implements consumer-shaped read ports composed in the application root:

- Profile's `CompletedTenderSummaryReader` receives completed participant and
  performance summaries;
- Room's `TenderLifecycleReader` receives phase, ruleset, completion reason, and
  participant forfeit state.

These readers decode Tender persistence through `TenderStore`. Profile and Room
do not read Tender JSON state or raw audit payloads, and an incompatible stored
match fails visibly at the Tender boundary instead of disappearing from derived
statistics.

## Internal Persistence Seam

`TenderStore` is an internal seam owned by the Tender Module, not a cross-context interface. It has two adapters: the in-memory adapter used by focused TDD and the PostgreSQL adapter used by the application runtime. The Tender Module remains the owner of rules, visibility projection, command validation, and timer consequences; a store never decides game outcomes.

```ts
type TenderStore = {
  create(input: StoredTenderCreation): Promise<void>
  read(tenderId: TenderId): Promise<StoredTender | null>
  commit(change: TenderCommit): Promise<TenderCommitResult>
  findDue(input: { now: Date; limit: number }): Promise<TenderId[]>
}
```

`commit` is the only write operation after creation. In one database transaction it checks the expected Tender version, records the command fingerprint and receipt, writes the next current state, and appends audit events. It returns either a committed result, a prior command receipt with its fingerprint, or a version conflict. This keeps retry, idempotency, optimistic concurrency, and audit ordering inside the adapter instead of leaking them to HTTP, WebSocket, worker, or game-rule callers.

PostgreSQL stores one current-state Tender row with indexed `dueAt` and version, command records unique by Tender and `commandId`, and audit events ordered by an increasing sequence per Tender. Current state is a structured JSONB write model for the evolving rules; the audit log remains append-only and is not used to reconstruct normal reads.

## Audit Event Contract And Compatibility

The Tender application owns the discriminated union of audit event kinds and
payloads. Raw audit events are not public API contracts: producers compile
against the application-owned union, and both in-memory and PostgreSQL adapters
validate the event before accepting a commit.

New persisted payloads use this JSON envelope:

```json
{
  "formatVersion": 1,
  "data": {}
}
```

The adapter validates the envelope, event kind, and matching payload when it
reads a current event. Invalid format version `1` data fails closed with a
diagnostic error instead of being mistaken for historical incompatibility.
Rows written before the envelope was introduced remain readable through one
explicit legacy decoder and are marked as format version `0` in the internal
stored-event model.

Each read model then accepts only the documented version `0` semantics it can
faithfully project. The participant audit validates every legacy event against
the current event contract or an explicit historical projection variant. If an
unsupported version or legacy payload cannot produce a complete audit, the
outer completed Tender view remains available but omits `audit`; the player
client treats that backward-compatible shape as a terminal unavailable-audit
state. It never publishes a partial audit. Current projection corruption and
operational or programmer errors still propagate. Sparse historical events may
remain valid for a narrower read model, such as profile statistics, without
being accepted as complete participant-audit evidence.

Adding or changing an event requires updating the application union, its
projector classification and semantic validation, producer tests, and the
in-memory/PostgreSQL store contract tests. Existing versions remain immutable;
a future incompatible format gets a new version and a deliberate decoder or
upcaster.
