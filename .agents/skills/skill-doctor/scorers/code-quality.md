---
name: Code Quality
description: "Whether the code, tests, and comments the agent produced are well-designed and consistent with the target repo's conventions."
labels:
  - value: "approve"
    description: "The agent produced well-designed, correct code that is consistent with repo conventions, adequately tested, and clean of smells; a senior reviewer would approve it outright, with at most trivial nits."
    score: 1
  - value: "block"
    description: "The agent produced code with at least one defect a reviewer would insist on fixing before merge: a correctness or concurrency bug, a missed edge case, an inconsistent pattern, weak or missing tests, or mixed-in artifacts that do not belong."
    score: 0.2
  - value: "insufficient_evidence"
    description: "The transcript shows no code diff, or too little of one to judge."
    score: null
---
**Rubric**

You are scoring one user-request task extracted from a local coding-agent conversation. Evaluate the actual code artifact — the visible edits themselves, not the process, the agent's final claims, or green test output. Judge it the way a careful senior reviewer would review the same diff using the target repository's conventions.

The verdict is binary when evidence exists: `approve` means the visible artifact could be merged as-is, while `block` means at least one concrete defect requires a fix. Use `insufficient_evidence` whenever the transcript contains no diff, only a truncated or partial edit, or only summaries and checks. Passing tests can support a visible diff but cannot substitute for it. An inventory marker such as `artifact evidence: partial` therefore cannot receive `approve` or `block`. Exclude `insufficient_evidence` from aggregation. The bullets below are common quality dimensions, not an exhaustive checklist.

Assess:

- **Design.** The shape of the change fits the codebase; it isn't premature abstraction, scope creep, or a change that belongs somewhere else (a library, a config value, a separate service).
- **Correctness.** The change does what it claims, including edge cases (nil/empty inputs, boundaries) and concurrency safety (races, unsafe shared state, spawned work that outlives request-scoped values).
- **Complexity.** No function, type, or expression is doing more than it needs to; no speculative genericity or indirection added for a need that doesn't exist yet.
- **Repo conventions.** Follows the same idioms as similar code in the same package or module — error handling, type placement, naming schemes, and any other established pattern visible in the surrounding code. An unexplained deviation from a clear local pattern is a defect even if the new code works.
- **Code smells.** Magic numbers or strings without a named constant, copy-paste that should be a shared function, commented-out code, vague or stale TODOs, workarounds that patch a symptom instead of the root cause, silently swallowed errors, deep nesting that early returns would flatten.
- **Tests.** Present for the change, and actually verify the behavior they claim to (a broken implementation would fail them) rather than asserting trivia or mocking away the logic under test; cover the error and edge paths, not just the happy path; not so tightly coupled to internals that unrelated changes would break them.
- **Naming.** Every new identifier communicates what it represents, at a length that's unambiguous without being noisy.
- **Comments.** Explain why, not what; a doc comment on an exported symbol describes its purpose and constraints without narrating its implementation; no comment describes an edit, a refactor, or a prior state of the code rather than its current behavior.
- **Diff hygiene.** The change contains only the edits that are intended to be committed — no temporary or transient text, scratch scripts, debug prints, or other verification scaffolding left alongside it.
- **Documentation.** READMEs, guides, or API docs are updated in the same change when the change affects how the software is built, tested, or used.
- **Corrections.** A defect the user pointed out mid-conversation counts against the artifact regardless of whether it was ultimately fixed; needing an external correction at all is a negative signal, not just a defect left unresolved.

Out of scope: how directly the agent worked (scored under Efficiency), and whether it followed instructions or skills. Judge the artifact on its own merits.

**Reason**

One to three sentences citing the specific visible file, pattern, or defect that drove the grade. Name what would have caught it: a lint rule, repository convention, or test case. For `insufficient_evidence`, say what was unavailable — for example, no diff was captured or the artifact was truncated. Do not infer quality from a commit, final summary, scanner, or successful gate alone.
