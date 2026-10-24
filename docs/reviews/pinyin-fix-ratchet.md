# B49 independent review — 1991366

Pass. The actual native Simplified Pinyin keyboard in Mobile Safari (iPhone 17 simulator, iOS 26.4) reproduces the failure on main b162655 and passes on candidate 1991366. Used only disposable revision-362 copies.

## Native acceptance

- On a new nested bullet under 明天, software Return, w/a/n, tap first candidate 万: original ID and bullet kind stay, the word remains on its line, with no extra break or duplicate. A later h/e → 和 yields 万和 on that same line.
- On a new to-do made by Return after TRV, the same first and later candidates yield 万和, preserving the original block and task identity/kind. No Removed from tasks notice appears.
- After saving, direct read-only SQLite inspection confirms both original blocks contain exactly 万和, without newline. The bullet remains a child of 明天. The original task ID exists, open, with title 万和.
- Native toolbar Undo removes 和 first, then 万, keeping the to-do block empty. It does not expose the transient paragraph or require an extra repair-only undo step. Two Redos restore 万和; the saved-state assertions above pass afterwards.

## Independent regression checks

All four supplied WebKit/iPhone replay cases pass: bullet, nested, to-do and second word; each checks continued typing and saved content. Independent suite 478 passed / 0 failed (11 skipped, 4 todo), typecheck and build pass. Source review confirms repair is scoped to composition beginning on an empty line, with existing block kind/props retained. No deployment was performed by this reviewer.

Native traces and saved assertions are in tests/evidence/ratchet-b49/candidate. Main failing trace/driver: 9876f2c. Native toolbar three-cycle evidence: f747805. Home Screen installation, physical iPhone and third-party keyboards remain unverified. B31's separate plain input passes the native keyboard checks in report 2acb2c5.
