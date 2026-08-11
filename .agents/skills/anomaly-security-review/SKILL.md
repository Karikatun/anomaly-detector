---
name: anomaly-security-review
description: Review Anomaly Detector changes and architecture for concrete security threats, authorization gaps, IDOR, replay, race conditions, unsafe input, data exposure, denial of service, and recovery failures. Use for threat modeling or security review requests and whenever work changes authentication, sessions, OAuth, permissions, player privacy, operator access, cryptography, rate limits, audit events, personal data, storage, production network boundaries, migrations, backup or restore, or legal and security copy.
---

# Anomaly Security Review

Produce an evidence-backed threat review for this repository. Treat scanners as leads and tests as boundary evidence; never infer security from a green tool alone.

## Workflow

1. Read `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, the applicable `AGENTS.md`, owning module, shared contracts, migrations, and directly coupled clients.
2. Identify the exact revision and scope. Preserve unrelated changes and keep vulnerability details out of public issues, logs, screenshots, and ordinary chat.
3. State the protected data, action, resource, or invariant. Enumerate unauthenticated user, outsider, participant, owner, operator, background worker, and external provider where applicable.
4. Trace each entry point through request validation, authentication, application authorization, transaction or persistence, projection or serialization, client consumption, audit logging, and retry or recovery.
5. Draw only the relevant trust boundaries. Apply STRIDE to each crossing and state a concrete attacker action and impact; discard checklist-only threats without a plausible path.
6. Complete the actor-resource and concurrency matrices below. Use `references/review-template.md` when writing a durable review.
7. Select the smallest evidence set that can prove the boundary. Run targeted tests before broader scanners or suites.
8. Report confirmed findings, rejected hypotheses, residual risks, and coverage gaps separately. Never label an unvalidated suspicion as a vulnerability.

## Required Matrices

For every object identifier, test or inspect:

- missing or invalid authentication;
- owner or intended participant;
- authenticated outsider;
- participant from another Tender or room;
- operator where the surface permits it;
- absent object versus existing but forbidden object;
- path, body, token, and persisted actor identity disagreement.

For every state-changing operation, test or inspect:

- duplicate delivery and command ID reuse;
- parallel requests through real PostgreSQL and, when relevant, multiple app instances;
- replay after success, logout, revocation, expiry, reconnect, and restart;
- deadline or timeout racing the command;
- ambiguous response followed by retry;
- partial failure, rollback, idempotent recovery, and audit consistency.

For every external input and stored payload, test or inspect:

- strict schema, unknown fields, empty values, Unicode, numeric and collection bounds;
- identifier validation before database or provider access;
- request body and resource limits before expensive work;
- persisted-event and provider-response validation on read;
- output projection that excludes another actor's private state;
- logs and reports that redact tokens, cookies, passwords, personal data, and private Tender state.

## Tool Routing

- Run `bun run security:gitleaks` for Git-history secret detection and retain only exact fingerprint exceptions for proven test fixtures.
- Run `bun run security:semgrep` for versioned high-confidence source rules. Inspect the complete source-to-sink path before reporting.
- Run `bun run security:trivy:config` for Docker and infrastructure configuration. After building the exact backend image, run `bun run security:trivy:image <image>`.
- Run `bun run security:zap` only against its isolated `_test` database. It performs active attacks, must never target production, and does not prove authorization or race safety.
- Prefer contract and PostgreSQL integration tests for auth, permissions, persistence, IDOR, concurrency, replay, stable errors, and privacy. Use E2E for valuable browser or realtime journeys.
- Run `bun run architecture:check` when module, contract, platform, or UI dependency boundaries change.

## Finding Bar

Report a finding only with:

- attacker and prerequisite;
- reachable entry point and attacker-controlled input;
- missing, bypassed, or mis-scoped control;
- protected asset or invariant and concrete impact;
- affected source locations;
- reproduction or strongest available evidence;
- root-layer remediation and regression-test boundary.

Do not report generic hardening advice as a vulnerability. Do not publish exploit details. Do not weaken authentication, authorization, validation, rate limits, encryption, auditability, or production safeguards to make a scan pass.

## Completion Contract

Lead with the highest-impact result. Include `Primary signal status`, exact secondary checks, unresolved hypotheses, residual risk, and whether active DAST was run. State explicitly when no finding was proved or when coverage is incomplete.
