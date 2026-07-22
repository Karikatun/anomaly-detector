# Anomaly Detector: MVP Implementation Plan

## Goal

Deliver a synchronous, competitive browser game for 2-4 authenticated players. A Tender lasts five rounds and targets approximately 45 minutes. Players research a hidden Anomaly Configuration, compete for exclusive Contracts, and determine the winner or shared winners by Rating and deterministic tie-breaks.

The source of truth for product scope is [GAME_DESIGN_BRIEF.md](GAME_DESIGN_BRIEF.md). The game-server and data boundaries are defined in [ADR 0001](adr/0001-authoritative-match-server.md), [ADR 0002](adr/0002-russian-launch-data-and-auth-boundary.md), and [ADR 0003](adr/0003-tender-module-and-audit-log.md).

**Статусы:** `[x]` выполнено, `[-]` начато частично, `[ ]` не начато.

**Общий статус:**
- **Milestone 0 (Contracts)** — ✅ 100% завершён
- **Milestone 1 (Tender Foundation)** — ✅ 100% завершён
- **Milestone 2 (Game Core)** — 🔶 прежняя версия реализована; согласованная переработка правил ожидает реализации
- **Milestone 3 (Identity, Rooms, Realtime)** — 🔶 комнаты, парольный вход, Yandex ID, locale, удаление аккаунта, HTTP/WebSocket и reconnect готовы; остаётся VK ID
- **Milestone 4 (Game Interface)** — 🔶 реализован рабочий интерфейс прежнего набора правил: лобби, история матчей, экран партии и основные действия; для целевого набора правил нужны главная страница, справочник, UI-миграция, i18n и визуальная система
- **Milestone 5 (Operations, Beta)** — ❌ 0%

## Delivery Rules

- The backend is authoritative for hidden state, legal actions, timers, Rating, outcomes, and audit data.
- The Tender Module is the only application seam for game behavior: `createTender`, `execute`, `readTenderView`, and `advanceDueTenders`.
- PostgreSQL remains the source of truth for Tender state, commands, audit data, rooms, users, and match history. Keep current Tender state in JSONB, keep audit events append-only, and add indexes for `phase`, `dueAt`, participants, and status as query needs appear. Introduce object storage or analytics storage only for derived artifacts such as large replay exports, raw telemetry files, or aggregate reporting when a concrete scale or cost problem appears.
- Work in vertical slices. Each game rule starts with one red test through the public Tender Module interface, followed by the minimum green implementation.
- Update `CONTEXT.md` before introducing a new domain term; do not use competing names for existing terms.
- Every issue is independently deliverable, linked to its dependencies, and classified before implementation.
- Do not add chat, public matchmaking, bots, random events, permanent upgrades, monetization, native apps, PWA support, or public sharing to the MVP.

## Approved Ruleset Migration

`GAME_DESIGN_BRIEF.md` now describes the agreed target ruleset. The current Tender implementation is an older ruleset and must not be presented as matching it until this migration is complete.

1. [ ] Replace starting Samples and Analytical Reports with the new discovery model: no starting Samples; Samples only from Access Slots or Reconnaissance; unknown Signals are revealed when acquired or named by a Contract.
2. [x] Make Power allocation simultaneous and private after Access Slot resolution. Limit Model Analysis and Contracts to one Power; retain two-Power choices only for Reconnaissance and Laboratory.
3. [x] Implement Reconnaissance targets: Unknown Sector or an already revealed Signal. An acquired Sample must be usable in the same round's Laboratory phase.
4. [x] Add the permanent public scientific journal and Continuous private same/different-polarity telemetry.
5. [x] Replace the wrong-Thesis contract-power restriction with Corporate Review and spendable Research Certifications.
6. [x] Replace the Contract generator and bidding model with a seeded round deck of Light, Complex, and Scientific Contracts, target-Signal roles, permanent-but-single-use Contract Evidence, Rating-only rewards, and the revised Final Contract.
7. [x] Implement the revised final Scientific Model scoring: property points, per-complete-Signal points, and complete-model bonus.
8. [ ] Build the post-auth home page and the full Rules Reference. The reference must be reachable from the home page and as an in-game modal without leaving a Tender.

**Gate:** deterministic API simulations for 2, 3, and 4 players cover every new rule, including hidden Power planning, Corporate Review, one-use Contract Evidence, Contract deck reproducibility, and final scoring; browser tests cover the Rules Reference from the home page and from an active Tender.

## Milestone 0: Contract And Work Breakdown

**Outcome:** implementation can proceed through stable seams without embedding game rules in routes or realtime handlers.

1. [x] Bring the temporary Access Slot implementation to the asynchronous Tender Module contract in ADR 0003.
2. [x] Define shared command, receipt, view, error, and audit-event DTOs in `packages/contracts`.
3. [x] Require `commandId`, `tenderId`, and authenticated `actorId` for every Tender command.
4. [x] Define player-scoped `TenderView` projections and the error shape for invalid, forbidden, stale, or duplicate commands.
5. [x] Break this plan into tracer-bullet GitHub issues, including dependencies and acceptance criteria.

**Skills:** `tdd` for contract migration and behavior; `domain-modeling` for vocabulary; `to-issues` to create vertical slices; `triage` before work begins; `code-review` after the milestone.

**Gate:** unit and contract tests prove the four-method Tender Module seam, command idempotency boundary, and participant-scoped views.

## Milestone 1: Authoritative Tender Foundation

**Outcome:** the server can persist, resume, and audit a Tender without a browser client.

1. [x] Add PostgreSQL write models for Tender, players, current round/phase state, commands, and append-only audit records.
   - [x] Use PostgreSQL as the Tender source of truth, with JSONB current state and append-only audit events instead of a separate match database.
   - [x] Add focused indexes for `phase`, `dueAt`, participants, and status when the corresponding query paths are implemented.
2. [x] Implement Tender creation for 2-4 players with a server-generated seed and hidden Anomaly Configuration.
3. [x] Implement deterministic restoration after restart and idempotent command handling by `commandId`.
4. [x] Implement `advanceDueTenders` as the only timeout-resolution path.
5. [x] Build player-only audit projections; audit data is not public or shareable.

**Skills:** `tdd` for persistence, retries, deadlines, and visibility; `codebase-design` before repository and audit adapter boundaries; `domain-modeling` for audit terminology; `code-review` before proceeding.

**Gate:** backend integration tests prove persistence, restart recovery, duplicate command safety, and no private data leakage across participants.

## Milestone 2: Five-Round Game Core

**Outcome:** a complete Tender is playable through the authoritative API.

1. [x] Add five fixed rounds and the transitions between Access Slot selection, Power planning, four operational phases, and end-of-round calculation.
   - [x] Add current round number to Tender state and participant Tender views.
   - [x] Add end-of-round transition from round 1 through round 5.
2. [x] Resolve six secret Access Slots with rotating public tie priority and the confirmed direct-request rule: with `A=1`, `B=1`, `C=2`, `D=6`, results are `A=1`, `B=3`, `C=2`, `D=6`.
   - [x] Rotate direct-collision tie priority between rounds.
3. [x] Add four Power per player, a maximum of two per category, and open planning in Access Slot order.
4. [x] Add Reconnaissance: six persistent Signals, non-consumable Samples, and initiating-player Raw Telemetry.
5. [x] Add Laboratory: directed source-to-receiver tests with Impulse and Continuous Protocols, public results, and authorised Private Measurements.
   - [x] Validate Directed Test source/receiver Samples and reject self-tests through the shared command contract.
   - [x] Resolve Impulse and Continuous Protocols deterministically from the hidden Anomaly Configuration.
   - [x] Store authorised Continuous Private Measurements in participant-scoped Tender views.
   - [x] Project public Laboratory results into Tender views.
   - [x] Project Laboratory results into replay/audit views beyond the append-only audit event.
6. [x] Add Model Analysis: Working Model updates, public Theses, correct-rating reward, and wrong-thesis temporary contract-power restriction.
   - [x] Validate and resolve public Thesis submissions in Access Slot order.
   - [x] Project checked public Theses to every participant without exposing the hidden Anomaly Configuration.
   - [x] Apply the correct-Thesis Rating reward.
   - [x] Apply and expose the wrong-Thesis temporary Contract Power restriction.
   - [x] Clear the temporary Contract Power restriction after the player's successful Laboratory test.
   - [x] Implement player-owned Working Model updates.
   - [x] Implement extended verification marker for two Model Analysis Power.
7. [x] Add Contracts: player-count-plus-one exclusive choices, reservation, Bid assessment, Budget, and Corporate Trust.
   - [x] Create `players + 1` public normal Contracts for the round.
   - [x] Reserve Contracts publicly in Access Slot order.
   - [x] Reject reservation of already reserved Contracts.
   - [x] Add private Bid submission for a reserved Contract.
   - [x] Assess a reserved Bid by required Public Result fit and matching public Laboratory evidence.
   - [x] Keep Contract reservation and Bid submission in Access Slot order; Challenge is out of MVP scope.
   - [x] Add starting Budget and Access Slot budget cost/Remote compensation.
   - [x] Add Access Slot Sample compensation for slots 4 and 6.
   - [x] Add starting Analytical Report and Access Slot analytical-report compensation for slot 5.
   - [x] Add requested-funding Budget payout for awarded single-Bid assessment.
   - [x] Add Budget and Corporate Trust effects.
8. [x] Add Rating calculation, Final Contract, partial Scientific Model scoring, full-model bonus, and deterministic tie-breaks.
9. [x] Add conservative server defaults for missing players: no beneficial slot choice, reserve Power, and skipped unresolved target.

**Skills:** `tdd` for every rule and edge case; `prototype` for timing, planning order, and decision clarity before complex UI work; `domain-modeling` whenever new rules add vocabulary; `grill-me` only if a rule changes score balance or the victory condition; `code-review` after each phase family.

**Gate:** API-level simulated Tenders for 2, 3, and 4 players complete all five rounds, determine the winner or shared winners, and expose a deterministic participant-only audit replay.

## Milestone 3: Identity, Rooms, And Realtime

**Outcome:** real players can securely form and play a private live Tender.

1. [-] Implement Yandex ID and VK ID authentication. Keep Telegram outside MVP until a separate legal review permits it.
   - [x] Add provider-agnostic OAuth identities, PKCE transaction storage, application ports, and Yandex ID start/callback flow.
   - [ ] Complete and validate the VK ID start/callback flow.
2. [x] Enforce Russian-launch data policy: 16+ audience, account deletion that anonymises old match entries, and password registration through a unique login.
   - [x] Add `DELETE /api/auth/account` endpoint: revokes all sessions, anonymises user record
   - [x] Add `privacyConsent` and `ageConfirmation` fields to register schema (Zod validation rejects missing/falsy values)
   - [x] Display consent checkbox and age gate in the registration form
   - [x] Create privacy policy template for legal review
   - [x] Add `anonymizedAt` field to User model (Prisma migration applied)
3. [x] Implement profile locale preference, default and fallback `ru`.
   - [x] Add `locale` field to User model with Prisma migration (default `'ru'`)
   - [x] Include `locale` in `UserDto` and auth responses
   - [x] Add `PATCH /api/auth/profile` endpoint to update locale
   - [x] Display locale in the webapp profile page
4. [x] Implement private rooms with a host-selected fixed size from 2 to 4. Starting requires every seat to be filled and an explicit host confirmation.
   - [x] Allow an authenticated host to create a waiting room and occupy the first seat.
   - [x] Allow authenticated players to join open rooms in seat order and reject a full room.
   - [x] Allow a participant to leave a waiting room and join it again while a seat is free.
   - [x] Allow only the host to start a full room and atomically create its Tender.
5. [x] Add authenticated HTTP endpoints and WebSocket updates that only deliver each participant's authorised TenderView.
   - [x] Add authenticated HTTP reads and command submission through participant-scoped TenderView projections.
   - [x] Issue one-time, session-bound realtime tickets without exposing access tokens in WebSocket URLs.
   - [x] Stream each participant's authorised TenderView over ticket-upgraded WebSocket connections.
6. [x] Support reconnect without pausing the Tender and ensure the worker, not a browser connection, resolves deadlines.
   - [x] Add automatic advanceDueTenders loop to the server entry point
   - [x] Start and stop the loop on server lifecycle
   - [x] Reconnecting subscriber receives the current state after a timeout

**Skills:** `tdd` for authorization, room capacity, reconnect, and deadline behavior; `design-an-interface` before OAuth-provider and realtime protocol boundaries; `context7-mcp` when consulting Hono, Prisma, OAuth, or WebSocket documentation; `triage` and `code-review` for security-sensitive work.

**Gate:** integration and browser tests prove that a room cannot start with an empty seat, unauthorised users cannot view a Tender, and reconnecting users receive the current authorised state.

## Milestone 4: Mobile-First Game Interface

**Outcome:** players can finish a Tender from a portrait mobile browser while desktop remains efficient.

1. [x] Build login, profile, room creation, room waiting, and host-confirmation flows for the existing ruleset.
2. [-] Build the live Tender screen: the existing ruleset has timer, phase status, Access Slot order, Power planning, public Rating, and legal actions; migrate it to the target ruleset.
3. [-] Build Reconnaissance, Directed Test, Thesis, Contract, Bid, and Final Scientific Model interactions for the target ruleset.
4. [-] Build the interactive Working Model without exposing hidden Anomaly Configuration data; the private model exists, but needs the target interaction and mobile treatment.
5. [-] Build end-of-round score breakdown and the final participant-only audit view; a basic end screen exists, but replay and score explanation remain incomplete.
6. [-] Store every visible string in i18n chunks. Ship Russian copy first while preserving locale-selection architecture.
7. [-] Apply the realistic corporate sci-fi visual system: an orbital station operating around an unknown object.

**Skills:** `prototype` for the Working Model and dense mobile interactions; `browser:control-in-app-browser` for mobile and desktop verification; `imagegen` only when original raster assets are needed; `tdd` for client state that affects correctness; `code-review` for each completed journey.

**Gate:** Playwright covers sign-in, room creation, full room start, each action family, reconnection, final score, and participant-only audit access on mobile and desktop viewports.

## Milestone 5: Operations, Delivery, And Beta

**Outcome:** a secure Russian beta deployment runs on Yandex Cloud and provides actionable match evidence.

1. Configure Yandex Cloud using `yc`: Serverless Containers, Managed PostgreSQL, Object Storage only if required, secrets, logs, backups, and monitoring.
2. Keep production data and operational configuration within the Russian launch boundary.
3. Add deployment checks, migrations, environment validation, health/readiness endpoints, and rollback procedure.
4. Measure real matches with 2, 3, and 4 players; tune deadlines only when data shows the five-round target is materially missed.
5. Run a closed beta. Capture audit-derived defects, balance observations, and operational incidents as GitHub issues.

**Skills:** `tdd` for deployment configuration and privacy-sensitive deletion paths; `diagnosing-bugs` for nondeterminism, concurrency, or performance regressions; `improve-codebase-architecture` after several working verticals and before beta; `triage` for beta reports; `code-review` before release.

**Gate:** a production-like environment passes health, migration, backup/restore, access control, and end-to-end Tender acceptance checks.

## Release Acceptance

MVP is ready for closed beta only when all of the following hold:

- Two to four authenticated players can create a full private room and complete five live rounds.
- The server alone determines hidden configuration, timer outcomes, Rating, and the winner or shared winners.
- Every participant receives only public information plus their authorised private information until the final audit.
- Completed Tenders have a deterministic, participant-only replay and score explanation.
- Russian is the default UI language, and all visible text is loaded from i18n resources.
- Automated contract, backend, and browser coverage protects the critical flows.
- Yandex Cloud deployment, data handling, monitoring, and recovery procedures have been verified.
