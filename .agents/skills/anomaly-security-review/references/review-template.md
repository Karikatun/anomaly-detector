# Security Review Template

## Scope And Assets

- Revision and paths:
- Protected data, action, resource, or invariant:
- Entry points and trust boundaries:
- Actors and assumed capabilities:

## STRIDE Threats

| Boundary | STRIDE | Concrete attacker action | Impact | Existing control | Evidence or gap |
|---|---|---|---|---|---|

## Actor And Resource Matrix

| Operation and resource | Anonymous | Owner or participant | Authenticated outsider | Operator | Absent versus forbidden |
|---|---|---|---|---|---|

## Concurrency And Recovery Matrix

| Operation | Duplicate | Parallel | Replay | Deadline or retry | Persisted outcome and audit |
|---|---|---|---|---|---|

## Findings

For every confirmed finding record severity, attacker, entry point, broken control, impact, locations, evidence, root remediation, and regression-test seam.

## Rejected Hypotheses And Residual Risk

- Rejected hypothesis and counterevidence:
- Unresolved hypothesis and missing evidence:
- Residual operational or third-party risk:

## Validation

- Primary signal status:
- Targeted tests:
- Static and supply-chain scans:
- Active DAST target and isolation proof:
- Checks not run and reason:
