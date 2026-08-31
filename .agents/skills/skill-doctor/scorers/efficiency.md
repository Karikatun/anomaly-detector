---
name: Efficiency
description: "Whether the agent worked directly toward its result, or wasted effort on redundant steps, avoidable rework, or unnecessary back-and-forth."
labels:
  - value: "highly_efficient"
    description: "The agent took a direct path: nothing re-read or re-run, independent steps batched, no work redone."
    score: 1
  - value: "mostly_efficient"
    description: "The agent slipped once or twice: a duplicated read, an early retry, or a small correction — with no knock-on cost."
    score: 0.8
  - value: "mostly_inefficient"
    description: "The agent wasted effort repeatedly, or caused a round of rework an earlier check would have prevented."
    score: 0.4
  - value: "highly_inefficient"
    description: "The agent's waste dominated the run: the same defect reworked across cycles, repeated user correction, or extended flailing / looping."
    score: 0.2
---
**Rubric**

You are scoring one user-request task extracted from a local coding-agent conversation. Evaluate the cost of reaching that task's result: the steps the agent took, avoidable rework it caused, and human attention it consumed. Do not charge work from earlier or later requests in the parent conversation to this task.

The navigation statistics are leads, not verdicts. A high total tool-call count, repeated wait/poll calls, or a failure-like output never proves inefficiency by itself. Classify the concrete events before scoring:

- `avoidable_rework`: a preventable retry, redundant read, wrong turn, or repeated correction;
- `required_wait`: proportionate polling for a long command, CI run, or delegated task;
- `environment_denial`: a sandbox, permission, network, or unavailable-runtime constraint; penalize only avoidable handling after the boundary was known;
- `expected_red`: an intentional failing test in a test-first cycle; penalize only redundant or misdiagnosed reruns;
- `unclassified`: ambiguous evidence that must not be treated as waste without task context.

Score against what a competent engineer with the same tools and constraints would have needed. A preventable mistake still counts when better tooling, a skill, or an earlier check would have avoided it. The bullets below are common sources of waste, not an exhaustive checklist.

Assess:

- **Rework from mistakes.** Work redone because the agent got it wrong the first time: a test or build failure a local check would have caught, edits to the wrong file, a misread requirement later reverted.
- **Cost to the human.** Repeated correction or steering from the user is the most expensive waste. A question asked up front is cheap; the same question asked after building the wrong thing is not.
- **Information gathering.** Re-reading, re-running, or re-searching for something already found; reading a large file end to end when a targeted search would answer it.
- **Routine-step overhead.** A roundabout way of doing something that's a standard, repeated part of this agent's job — more steps, more calls, or a broader operation than the task needs — when a more direct path was available. Do not count required waits or expected test-first failures as overhead.
- **Batching.** Independent reads, searches, or workstreams run serially across turns instead of together.
- **Flailing.** Retrying a failing approach unchanged, or guessing when reading the code or docs would have settled it. An abandoned path only counts against the agent when the information to avoid it was already available.
- **Verification timing.** Checks run once, early enough to catch a defect before declaring done, not deferred until after or re-run redundantly.

**Reason**

One to three sentences naming the dominant avoidable source of waste with a rough count (three fix-test cycles, four redundant reads, two repeated user corrections), the relevant cost category, and the likely fixable owner. Name a skill only when its trigger and current instructions clearly applied to this task.
