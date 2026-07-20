# Prototype Notes

**Question:** Does the round state machine make Access Slot conflicts, reverse Power planning, and phase order deterministic and understandable?

**Подтверждённое правило коллизии:** прямой запрос слота имеет приоритет над игроком, сдвинутым из более раннего слота. При приоритете `A, B, C, D` заявки `A=1`, `B=1`, `C=2`, `D=6` дают результат `A=1`, `B=3`, `C=2`, `D=6`.

**Verdict:** Pending an interactive review.
