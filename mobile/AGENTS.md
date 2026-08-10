# Mobile Application Instructions

## Grounding

- Read root `AGENTS.md`, `docs/TESTING.md`, the mobile README, and relevant contracts or ADRs before non-trivial work.
- Preserve the same product behavior and contract boundaries as the web client while treating mobile layout and interaction as a distinct composition.
- Use installed Expo and React Native patterns; do not introduce dependencies without approval.

## Maestro And Interaction

- Use Maestro for mobile E2E and stable `testID` constants from `mobile/src/constants/testIds.ts`; avoid coordinates and fragile text selectors.
- Run Expo dev-client flows against an installed development build, not Expo Go. Use `MAESTRO_DEV_SERVER_URL`, preflight backend and Metro reachability, and set `EXPO_PUBLIC_E2E=1` only in E2E bundles.
- Keep production password fields secure. Avoid `hideKeyboard`; center important CTA targets before taps and keep frequent or consequential touch targets around `44–48pt` or larger.
- Never stop unrelated processes for ports. Use isolated ports and explicit test configuration.

## Validation

- Cover meaningful behavior, permissions, validation, navigation, persistence, error/recovery states, and important state transitions rather than cosmetic layout details.
- After changing Maestro flows, runner inputs, or E2E-only app behavior, run `bun run --cwd mobile e2e:maestro:audit` with the relevant validation.
- For visual work, apply `$anomaly-ui` principles and inspect the rendered mobile result at `390×844` or the task's target device size.
