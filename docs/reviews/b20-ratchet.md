# B20 independent review

Final candidate 29d0056 (initial 615f957). Ratchet, 2026-10-21. Behaviour and visual rechecks passed on an isolated fresh VACUUM copy of Brian's data, port 3407. No production writes, data-format changes or model calls.

## Behaviour and visual evidence

- Original-data check: 12 assertions passed. The two named day-page sidebar links are keyboard-focusable in order, Tab moves between them, and Enter opens the exact corresponding /pages?page=… destination. At 390 and 1280 final written content scrolls clear. The + opens its capture sheet, which is solid white. No page errors.
- Added three isolated child-page fixtures (not root pages), including a long Chinese/English title. Five assertions passed: exactly three displayed rows, newest day first, Today label, correct 2-more count and destination, and long title truncation preserving the day label. The initial original two-page behaviour remains unchanged.
- Final 29d0056 visual recheck: four assertions passed. At 390, the last Review control on Oct 18 and Oct 19 ends 15.7px above the fade. A bright injected background behind the navigation capsule leaves its interior screenshot pixels identical, demonstrating no bleed-through between icons. Capture sheet remains opaque white. Inspected settled screenshots of the final page bottom and sidebar.

Initial harness used pathname alone when comparing links that carry a page query parameter, and an incorrect capture-sheet class; these harness assumptions were corrected before the final passing original-data log. They are not product defects. The final Review-control check supplements the earlier text-only end-of-page check.

## Validation

Build and typecheck passed on 29d0056. Source/scripts in this worktree match the final candidate. Full geometry results are recorded below after applying the official fixture generator with the QA server stopped. Tests and screenshots: tests/evidence/ratchet-b20-96/.

Guide line retained, per Lead's accepted B20 scope. This review does not include B23's separate save-conflict changes.

Full independent geometry gate with all fixtures on 29d0056: **298 passed, zero failed, zero missing**, at 1280 and 390. **PASS for Lead's B20 release.**
