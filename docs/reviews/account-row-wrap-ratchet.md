# Account-row wrapping independent review

**Final verdict: PASS — PR #36 `9d312e7`.**

Task #237, PR #36. Initial head `714b201`; revised head `9d312e7`. Reviewed the complete component/CSS diff and tested on the isolated copy combined with B70 part 2.

**Finding:** the new blanket nowrap caused a valid long email to overflow the row. `reviewer@a-long-but-valid-company-domain.example` occupied 336 px in the 239 px sidebar, while restoring normal wrapping fitted the same address. Reported `fa0252c0`. The revised email span permits normal wrapping and breaks long addresses anywhere.

**Independent result on `9d312e7`:** Chromium and WebKit pass at row widths 150, 194, 239 and 350 px. The email, long hint/reminder text, buttons and separators fit within each row. Every visible separator remains on a line containing its preceding item; the last item has no visible separator. Rendering/empty-state control flow was inspected: hidden reminders and hints return null before creating AccountItem, so they leave no stray separator. Button labels and keyboard order are unchanged.

The browser fixture clones the actual AccountItem structure from the local row, then supplies invented long text in the same inner spans used by the real component. It exercises CSS and geometry without signing in or changing real account settings. Evidence: `tests/evidence/ratchet-account-wrap/`.

Physical iPhone and authenticated push/reminder operations were not exercised. This change only alters wrapping around their existing controls.

Combined with PR #35 `4e93918`: typecheck/build pass and the unit suite is 173 passed, 0 failed, 3 skipped. The account wrapping assertions cover eight browser/width combinations, including long email, reminder failure text, Home Screen instructions and final-item separators.
