# Domain Docs

This is a single-context repository.

Before substantial exploration or implementation, read these sources when they exist:

- Root `CONTEXT.md` for the project glossary and domain language.
- Relevant decisions under `docs/adr/`.
- `docs/GAME_DESIGN_BRIEF.md` for agreed game-product rules.

Use the terms defined in `CONTEXT.md` in issues, test names, code, and documentation. If a proposed change conflicts with an ADR, call out the conflict rather than silently overriding it.

`CONTEXT.md` and `docs/adr/` are created lazily by `domain-modeling` when the first durable glossary or architectural decision is needed.
