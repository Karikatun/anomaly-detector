---
name: anomaly-ui
description: Design, implement, review, or debug Anomaly Detector interfaces while preserving its established dark corporate sci-fi product language, design system, responsive hierarchy, motion discipline, and rendered visual quality. Use for substantial web or mobile UI/UX changes, responsive layouts, visual hierarchy, animation, design-system or foundation work, cross-screen consistency, rendered-flow inspection, and visual audits.
---

# Anomaly UI

Preserve the existing product while making the smallest coherent improvement. Treat real rendered behavior, not compilation or source inspection, as the primary visual signal.

## Ground The Task

1. Read root `AGENTS.md` and the affected module's `AGENTS.md`.
2. Read `docs/DESIGN_SYSTEM.md` and the applicable states in `docs/UX_CHECKLIST.md`.
3. For substantial UI/UX work, automatically define the player goal, primary action, server-accepted result, applicable failure/recovery states, and primary rendered signal. Do not require a pilot status or user reminder.
4. Create a stable CUJ/evidence matrix only for a new or materially redesigned critical flow, as defined by `docs/UX_CHECKLIST.md`; do not add that ceremony to a local fix or incremental existing flow.
5. For foundation, styling-system, or cross-screen consistency work, also read `docs/UI_FOUNDATION_AUDIT.md`.
6. Inspect the current rendered screen, adjacent screens, shared primitives, tokens, and directly coupled behavior before editing.
7. Preserve working flows and product semantics. Trace behavioral UI bugs through route/layout, orchestration, state or handler, contract/API, and persistence to the owning layer.

## Preserve Product Direction

- Keep the interface serious, technological, restrained, tactical, dense but readable, and game-like without becoming arcade-like.
- Avoid generic SaaS dashboards, excessive gradients or glassmorphism, pervasive neon glow, excessive rounded cards, giant typography, and decoration without function.
- Reuse existing components and patterns. Extend an established primitive with a small semantic variant before creating a parallel Button, Card, Badge, Dialog, selection, or loading pattern.
- Prefer parent padding and container gap over ad hoc margins. Treat shared visual components as closed units: use existing semantic props, then a small reusable prop, then a local feature wrapper.

## Apply The Foundation By Meaning

- Use existing semantic tokens whenever they express the role. Do not add raw colors, typography values, spacing, radii, shadows, z-index, durations, easing, or breakpoints unnecessarily.
- Follow the documented scales: spacing `4/8/10/12/16/20/24/32px`, radius `6/8/10/16px/full`, existing `Typography` variants, motion `120/160/220ms`, and main breakpoints `640/768/1024/1280px`.
- Add a global token only for one semantic role repeated in at least three places. Keep feature-specific accents scoped to their feature.
- Normalize by meaning, not by similar literals. Keep focus, local selection, saved draft, server-accepted action, disabled, and error states distinct, with more than color as the signal.
- After a foundation migration wave, update the audit baseline and align `docs/UI_FOUNDATION_AUDIT.md` and `docs/DESIGN_SYSTEM.md` with the rendered implementation.

## Protect Hierarchy And Responsiveness

For gameplay stages, prioritize:

1. current round and stage;
2. remaining time;
3. the player's key resource;
4. the primary action;
5. available actions;
6. current selection and submission status.

- Make secondary information quieter without obscuring status or recovery.
- Support at minimum `1440×900`, `1024×768`, and `390×844` when the affected surface exists at those sizes.
- Treat mobile as a distinct composition. Preserve primary action, phase, timer, resource, and status before secondary data.
- Prevent horizontal overflow, cramped controls, unsafe wrapping, sticky overlap, layout shift, and undersized touch targets.

## Keep Motion Intentional

- Do not animate ordinary scrolling or add `whileInView`, scroll reveals, IntersectionObserver entrances, decorative staggers, or `transition: all` by default.
- Animate from user action, state change, navigation, overlay transitions, or success/error feedback. Prefer `transform` and `opacity` over layout properties.
- Use roughly `120–180ms` for microinteractions, `160–220ms` for controls, and `200–280ms` for modals or panels. Respect `prefers-reduced-motion`.
- Reserve space for asynchronous content. Sticky elements must not jump, resize unexpectedly, or cover final interactive content.

## Validate The Rendered Result

1. Run the application without disturbing unrelated processes.
2. Inspect the actual affected flow and relevant loading, empty, error, success, disabled, waiting, retry, and recovery states; prove the server-accepted result where behavior crosses the client boundary.
3. Inspect desktop and mobile at the applicable required sizes, plus the supported intermediate viewport when it can expose a distinct composition or height constraint.
4. Exercise keyboard order, visible focus, focus trapping/return where applicable, and recovery after the relevant failure or interruption.
5. Run the quick UI QA and relevant state matrix from `docs/UX_CHECKLIST.md`.
6. Fix visible regressions in the owning layer and repeat the same rendered path before completing the task.

Do not declare a substantial UI task complete because code compiles, E2E is green, axe reports no violation, or screenshots exist. Report which sizes, states, focus path, and recovery path were actually rendered. Keep cognitive/usability judgment separate from automation, and do not claim real-player comprehension without real-player evidence. Do not add automated assertions for cosmetic CSS details; use stable E2E only for meaningful behavior.
