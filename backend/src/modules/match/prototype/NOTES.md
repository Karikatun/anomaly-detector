# Prototype Notes

**Question:** Does the round state machine make Access Slot conflicts, reverse Power planning, and phase order deterministic and understandable?

**Confirmed conflict rule:** a direct Access Slot request has priority over a team displaced from an earlier slot. With tie priority `A, B, C, D`, requests `A=1`, `B=1`, `C=2`, `D=6` resolve as `A=1`, `B=3`, `C=2`, `D=6`.

**Verdict:** Pending an interactive review.
