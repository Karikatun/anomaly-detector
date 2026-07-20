# Tender Module And Audit Log

The Tender Module is the sole application seam for Tender creation, player commands, participant-scoped views, and due-time advancement. It owns room lifecycle, Anomaly Configuration, phase rules, timers, Rating, and audit events behind `createTender`, `execute`, `readTenderView`, and `advanceDueTenders`; HTTP and realtime adapters do not implement game rules.

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

The in-process implementation used by the initial Access Slot TDD cycle is a temporary shape. It must be brought to this interface before the next production Tender behavior is added.
