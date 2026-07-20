# Round State Prototype

**PROTOTYPE - DELETE OR ABSORB AFTER REVIEW.**

Question: does the proposed round state machine make Access Slot conflicts, reverse Power planning, and phase-by-phase Action order deterministic and understandable for 2-4 teams?

Run with `bun run prototype:round`. This is an in-memory terminal tool, not production game code. It intentionally exposes every submitted choice so the state transitions can be inspected.

Use the prototype to try cases such as:

- every team requesting the same Access Slot;
- a team displaced from a contested slot into an already requested later slot;
- a late Access Slot planning first but acting later;
- teams with no Power in a phase being skipped.

Record the verdict in `NOTES.md` before deleting the TUI shell or moving the validated pure state machine into the real match module.
