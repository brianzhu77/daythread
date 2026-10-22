# Typing stability review — task #117

**PASS: 66b0b70 (a40a05f + final bounded tap-area fix).** Lead confirmed this exact combination as PR #9 final head (39a58f14). No remaining blocker found within the reviewed writing flows.

## Independently confirmed defects and revisions

7aa3973 fixed the daily empty-task jump. Independently ran the daily harness against a built server with fresh synthetic SQLite fixtures: 15/15 across 1280, 390 with hover, and 390 touch (five empty row types per mode).

Widened testing found that a document reference task on touch still grew from 38 to 50 px after the first text saved, and shrank from 50 to 38 px on completion. Measured cause: the newly appearing Plan for today button inherited a 44 px minimum height. This was not covered by the original daily-page checks.

The intermediate e09ccbc fixed that height but expanded the button into neighboring rows. Independently tapping at y=145, inside the first row (109–147), planned the SECOND task (second row 147–185), confirmed against synthetic database task IDs. 66b0b70 bounds the target vertically within its row; the short touch row remains 38 px overall. Its button target is 32 px tall, an explicit trade-off accepted by Lead, rather than the intermediate 45 px target.

The final JSX keeps the hidden Plan for today button's space for completed/cancelled document reference tasks, preventing title reflow on completion. It is disabled, excluded from tab order and marked aria-hidden.

## Final verification

- Independent expanded browser matrix: **42/42 passed**, across 1280, 390 hover, and 390 touch. Real document tasks (asserted empty before first typing), first save, check/uncheck, bullet save, second/third tasks created with Enter; daily Top 3 and Other second/third tasks and check/uncheck. Layout snapshots compare all existing visible blocks before and after saving/state changes. These tests use scoped section task IDs and await the actual checkbox state.
- Long document titles: **6/6 passed** in Chromium, check and uncheck at all three modes. All block positions/heights stayed unchanged. This includes the short touch case previously failing and long wrapping titles.
- Adjacent document tasks, 390 touch: **four boundary cases plus two button-centre checks passed**, independently in Chromium and WebKit. At ±2 px from the boundary, Chromium plans only the task owning the tapped row. WebKit padding taps plan neither task; tapping that task button centre then plans exactly the intended task. Task IDs and plannedOn were read from synthetic SQLite, not inferred from a toast. No tap planned a neighboring task.
- Final typecheck and production build passed. Final full suite: **339 passed, 0 failed, 11 skipped, 4 TODO** (354 total). This branch predates the independently reviewed PR #8 domain tests; the count does not replace the 343-test result recorded for PR #8.
- The initial daily 15-case evidence remains applicable: subsequent changes target document reference buttons and retaining their space; the original hover row-height fix remains intact.

No native assistive-technology session or physical phone was used. Touch cases use browser touch emulation. The final target is bounded to its own row, accepting a 32 px button height within the 38 px single-line touch row; it cannot claim a 44 px vertical target. Earlier async checkbox/fixture precondition failures were corrected in the harness and are not counted as product defects or passing checks. Own QA server on port 3429 stopped after verification.

Only independent local fixtures were mutated. No real user workspace, deployed app, production database, or credentials were used. Logs are in /private/tmp/ratchet117; scripts are in tests/evidence/ratchet-typing-117.
