# Nested bullet markers — task #89

**59e4a1c: PASS.** Independently built and tested against an isolated copy of Brian's real database, with the updated fixture including a third list level. Guide lines remain per Lead db4692d0; 67e67e4 is excluded.

The reusable geometry gate independently reproduces **20 failures before the fix** (217 passed, no missing). The final candidate passes **237 checks, zero failures, zero missing** at 1280 and 390. Build/typecheck pass. This is a CSS-only change; the review does not cover A12.

Independent reviewer pixel analysis uses connected components from screenshots, with a wider marker zone than the shared checker so the entire nested ring is included. Both real Oct 18 content and the Dec 31 fixture were checked at both widths:

| Level | Before size / gap | Final size / gap |
| --- | --- | --- |
| Root dot | 6×6px / 19px | 6×6px / 19px |
| Level 2 ring | 4×4px / 12px | 6×6px / 19px |
| Level 3 square | 4×4px / 12px | 5×5px / 19px |

Final drawn centres are within 0.44px of the first text line, including empty nested rows and wrapped Chinese text. The square differs from the root dot by 1px, within the accepted tolerance. Pixel occupancy confirms the ring is hollow and the square filled. Shared gate checks confirm each deeper text column steps by 24px. Screenshots were inspected alongside Brian's Craft reference; the tiny glyph and cramped gap are resolved. No page errors in the independent capture.

No production writes, paid calls or reviewer implementation changes. Evidence: `tests/evidence/ratchet-markers-89/`. The standing visual standard now includes drawn marker size and marker-to-text gap; line-box centring alone is insufficient. Lead owns backup/deployment and Brian's acceptance. Physical phone/Safari were not tested.
