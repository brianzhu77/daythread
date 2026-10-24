# B48 independent review

Final candidate: **256dc96**, design/phone-toolbar-keyboard. Reviewer: Ratchet, task #193.

**Pass for the fake-viewport checks. Real iPhone Safari and Home Screen confirmation remains pending.** Headless tests cannot establish that the native keyboard behaves as mocked.

## Findings and fixes

- On 9f7c5dd, scrolling an open paste menu to visual offset 320 left its top at 300, above the visible top. Independently reproduced in WebKit and Chromium. Jazz's 0d936f5 adds viewport scroll remeasurement and uses the same layout coordinates as the toolbar/visible window.
- On 9f7c5dd and unchanged in 0d936f5, keyboard detection subtracted offsetTop as well as height. With the keyboard still 336 px high, visual height 508 and offsetTop 240, it incorrectly selected the keyboard-down position: toolbar bottom 754, visible bottom 748. Reproduction: offset-check.mjs. 256dc96 detects the height shrink separately from its placement offset; toolbar bottom is now 740, 8 px above the visible bottom.

## Independent checks

Fresh disposable SQLite stores; 390 px, WebKit with touch and Chromium:

- Author's final fake-keyboard check passes independently in both engines: first, second and third focus; keyboard closes/reopens; caret moves between Events and Notes with keyboard still up; caret line stays above the toolbar; no-keyboard/external-keyboard fallback remains 90 px from bottom.
- Visual scroll offsets 180, 240 and the final author's full 336 px case keep the toolbar above the visible keyboard. Own offset-240 reproduction now passes in both engines.
- Aa remains above the toolbar; scrolling while Aa is open keeps the panel visible. The paste menu remains visible and clear of the toolbar when opened and while scrolling. Own offset-320 open-menu reproduction now passes in both engines: menu 449–560/561, visible top 320; toolbar 770–820, visible bottom 828.
- No page errors in these checks.
- Initial suite: **473 passed, 0 failed**, 11 skipped, 4 todo. The subsequent fixes touch only viewport placement/listeners and the check script; final typecheck and build pass. No claim of a second full suite run on the final head.

Final regression checks pass independently on 256dc96: B44 three-link tap and phone-bookmark (focus retained, notice Undo returns plain link/material) at 390 WebKit; phone-style-check in WebKit, including role heading disabled, style choices/task conversion, panel closing on blur and hide keyboard.

## Limits

No native keyboard, actual iOS visual viewport motion, Home Screen lifecycle, or IME was exercised. Brian's phone is the real-device check per Lead. Simulator permission remains the separate task #155; this review does not treat a mocked viewport as that permission or as native evidence. No production typing or writes.

Evidence: `tests/evidence/ratchet-b48/`, with the disposable runner already in `tests/evidence/ratchet-b44/run-author.mjs`. `offset-check.mjs` and `scroll-check.mjs` extend the original author check with the independently found failures. `popup-scroll-check.mjs` adds document scrolling while the popover is open. Final logs identify their measured coordinates.
