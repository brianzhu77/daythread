# B19 alignment correction — independent acceptance, task #88

**112b499: PASS.** Independent worktree built with source/scripts identical to 112b499 (`git diff 112b499 -- src scripts` empty), on an isolated real-data SQLite copy. No production writes or paid calls.

## Reusable geometry gate

`check-alignment.mjs` across Oct 18, Oct 19, today, the official Dec 31 fixture, and the reviewer's Oct 25 fixture: **238 passed, zero failed, zero missing**, at 1280 and 390. Coverage includes open/done/cancelled tasks, headings, bullets/nested bullets/empty rows, preview/no-preview page cards, link cards and hovered handles. Values are judged without rounding. The nested dot check measures the marker line, not raster glyph bounds; Lead accepted this limit.

## Independent measurements and browser evidence

- Baseline independently reproduced the reported defect: page icon and chevron 9px below title first line; title column 17px left on desktop, phone task/bullet text 2px apart.
- Final real-data title column is 465px / 65px and matches task/bullet text. Card icon/title/chevron centres differ by zero in the reviewer's raw geometry measurements.
- Reviewer-created fixture, using real domain commands, includes a 130-character Chinese page title and a resolved link card. The title wraps to four/eight measured lines at 1280/390, with clientWidth = scrollWidth (628/258px), and its icon/arrow stay on the first line with zero offset. Link title remains single-line and its external-open icon is also centred with zero offset.
- Reviewer assertions passed **13/13**: wrapping/clipping, marker centres, link single-line behavior, no render-time writes, genuine open/cancelled/done `data-status` values, and no console/page errors. Screenshots inspected for real content and the long-title fixture.
- Build and typecheck passed. Enabled suite: 286 total, 282 passed, four TODO, no failures/skips.

The previous visual acceptance missed the card's leading alignment. This review supersedes that part of B19's earlier conclusion. It also independently found long titles silently clipped by inherited `white-space: nowrap`; 48c6861 closes that finding. The standing standard is recorded in `docs/validation/visual-geometry-acceptance.md` and the shared checklist.

The official fixture's link creation order was flagged during review; Roadbuster corrected it in script-only 7b58ba9. This release's normal link card was additionally tested using the reviewer's save-card-then-paste command fixture. The `Cancelled` label is still A12 work; its status and geometry are checked here. Floating controls covering text at 390 remain tracked as B20. Physical phone/Safari behavior was not tested.

Evidence: `tests/evidence/ratchet-align-88/`. Lead owns backup/deployment and Brian's acceptance. No reviewer implementation changes; do not merge the entire reviewer branch.
