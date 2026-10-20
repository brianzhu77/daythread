# Final verdict: A2 41e2f5c — PASS

All four independently found defects are closed. No blocking finding remains in the accepted scope. This acceptance covers code and isolated-copy verification; Lead owns the production release.

- Reviewer-authored reproductions for other-save Undo, host-case Material identity, and real 21eb45b nested-note rollback all pass on 5fa5158. Those paths are unchanged in 41e2f5c.
- Final 41e2f5c: enabled full suite **266 total, 262 pass, 4 TODO, no failures or skips**; typecheck and build pass.
- Final reviewer-authored clipboard browser checks: **9/9 pass** (`final-clipboard.log`). Plain URL, HTML+URL, HTML+label (label title), browser wrappers and uri-list make pages; sentence/multiple anchors, image inside anchor and image beside anchor remain normal pastes. This closes the mixed-content loss defect.
- 5fa5158 built-app harness independently rerun on own fresh real-workspace copy: **59/59 pass**, including actual nested Notes bullet, typing/pending-save/two-device Undo, Good Stuffs Undo-save-reload and 390px layout. Author harness rerun, distinct from the reviewer-authored reproductions.
- Actual old-build roundtrip independently rerun: **22/22 pass** against separately built 21eb45b. The additional reviewer-authored nested-note case also passes. Final source diff changes only clipboard parsing and its checks/docs; no migration/data/Undo path changed, so prior roundtrip evidence carries forward per Lead 06f5a617.
- Initial server-stop/retry harness independently rerun: **6/6 pass**. A5 tests are included in the full suite; the independent A5 host-case regression is specifically closed.

Evidence directory: `tests/evidence/ratchet-links-82/`. Earlier failed logs below are retained as history. No production writes or paid provider calls by reviewer. Physical iPhone/input method and native Safari clipboard remain untested; the clipboard formats above are simulated in Chromium.

---

# A2 independent acceptance — task #82

**Initial 13cbcdd: NOT PASS.** Three independently reproduced defects (reviewer-authored reproductions; actual domain/save paths):

1. `typed-save-undo.ts/log`: first Good Stuffs paste creates URL page; another day types that URL in Good Stuffs; Undo of the first paste deletes the page even though the second Material source survives. `followUpUsed` ignores other sources. Preserve page identity when another save uses it.
2. `rollback-children.ts/log`: actual old 21eb45b saves a nested note under the compatibility URL line while on layout 4. Re-upgrade drops the line's whole editor node including children. Sections still have the note but editorJSON/editorSeed hide it; a later save can discard it. Keep the compatibility line if it has children (Lead/Product decision).
3. `material-host-edit.ts/log`: Good Stuffs typed URL changes only host case; `linkMaterialLines` finds the same Material as owner, removes it, and leaves the block referencing a missing Material. Same-owner match must preserve identity.

## Initial candidate checks

- Independently reran suite: 262 total, 250 passed, 8 skipped (future-days switch), 4 TODO. No failures in existing suite; it misses the three cases above.
- Build succeeded. Independently reran author's built-app browser harness: all 51 checks passed on own fresh real-data copy, including nested bullet, Undo typing and two-device existing tests. No console/page error or external request. This is a harness rerun, not independently authored UI tests.
- Reviewer-authored clipboard simulation: address-bar plain URL and HTML `<a>` + plain URL both make a URL page; HTML `<a>` + its non-URL label currently makes no page (`clipboard.mjs/log`). Lead aa5d532f now accepts that additional shape with the label as initial title; implementation/recheck pending. Mixed sentence/other HTML must stay normal paste.
- Author's real old-build roundtrip independently rerun on separate 21eb45b checkout, all 22 checks passed (roundtrip.log). Initial runner failures were test setup: old checkout not built and stale owned preview port, not product findings.

No production writes, actual provider calls or implementation modifications by reviewer. Evidence: `tests/evidence/ratchet-links-82/`. Followup candidate must close the three findings and Lead/Jazz's clipboard/style changes before final acceptance. A5 regression rerun is included in the suite and remains required on final candidate.

## Followup 5fa5158

The three initial independent reproductions now pass. Enabled full suite: 266 total, 262 pass, four TODO. Real old-build roundtrip: 22 checks pass again. The built-app UI harness completed all 59 checks successfully.

**One new confirmed clipboard boundary defect:** `clipboard-boundaries.mjs/log` tests 7 payloads. Six pass (plain URL, HTML+URL, HTML+label, uri-list, sentence link, two links); HTML consisting of a single anchor plus a sibling image is wrongly converted to a link page and the image is discarded. `copiedLink` checks only remaining textContent, so non-text content outside the anchor is missed. Lead's rule requires exactly the link and no other content. Reported 2aea0960; fixed in 41e2f5c, verified below.
