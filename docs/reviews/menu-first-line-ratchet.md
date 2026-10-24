# B45 independent review

**Pass: 717d026**, task 183. Only task-row menu CSS changes.

On a fresh disposable synthetic store, at 1280 Chromium and 390 touch/mobile WebKit, measured all six Tasks → Today rows: short titles, a nested Chinese title (two lines desktop/four phone), two nested levels, and a four-line outside-parent child on phone. Every menu centre matches the title's first-line centre and checkbox centre exactly (0 px), with a 44 px button target. The menu on the long nested row opens within the viewport at both widths. No horizontal page overflow or page errors. Phone screenshot visually inspected: the menu is readable and anchored beside the first line. Build passed.

Evidence: `tests/evidence/ratchet-b45/{seed.ts,check.mjs,browser.txt}`. Screenshots `/tmp/ratchet183-menu-{1280,390}.png`.

The morning card uses `.mc-row`, not `.task-row` (`start-the-day.tsx`). These selectors do not change that card, so no morning-card correction or regression is claimed. Jazz separately exercised Upcoming/Open/Not today; those share the changed selector. No full domain suite was repeated for this four-line CSS change. Day-page editor alignment is outside the changed selector and was not rerun.

No app source or live data changed during review.
