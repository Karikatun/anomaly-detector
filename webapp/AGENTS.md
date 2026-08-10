# Player Web Application Instructions

## Grounding And Boundaries

- Read root `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, and relevant ADRs before non-trivial work.
- Product contexts live in `webapp/src/features/<context>`. Routes and screens compose public feature APIs; endpoint-agnostic capabilities live in `webapp/src/platform`.
- Keep business rules out of routes, providers, shared UI primitives, and leaf components. Trace frontend bugs through route/layout, page orchestration, state or handler, contract/API, and persistence before compensating in a child.
- Reuse installed framework APIs, existing feature boundaries, shared primitives, tokens, and query conventions. Run `bun run architecture:check` when these boundaries change.

## UI Work

- Use `$anomaly-ui` for any substantial UI, UX, responsive, animation, design-system, cross-screen consistency, or rendered-flow task.
- A visual-only change is Direct. Use TDD-first when it changes behavior, accessibility semantics, navigation, validation, permissions, persistence, or meaningful state transitions.
- When touching routes or layouts, inspect public/protected flows, guards, parent orchestration, redirects, and navigation effects.
- When touching queries or mutations, inspect keys, invalidation, loading, empty, error, success, optimistic, stale, retry, and recovery states.

## Validation

- Follow `docs/TESTING.md`. Use Playwright only for important user-visible behavior with stable selectors and maintainable data setup.
- Do not assert cosmetic class names, CSS values, spacing, colors, radii, shadows, or animation timing in automated tests.
- A substantial UI task requires rendered desktop and mobile inspection through `$anomaly-ui`; compilation alone is not completion.
