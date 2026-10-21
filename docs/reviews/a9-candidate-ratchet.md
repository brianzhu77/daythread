# A9a + B15 independent acceptance — task #84

## Final result

**26957da: PASS.** All three independently reproduced defects below are fixed and independently reverified.

- Enabled suite: 285 total, 281 passed, four TODO, zero failures or skips. Typecheck and production build passed.
- Final built-app UI harness: 42/42 passed, including prefix-first search, B15 deletion/move ordering, link clipboard identity, synthetic composition boundaries and 390px overflow checks; no page or console errors. Screenshots retained.
- Reviewer-authored heading checks pass: Linked from projection, delete/save/restore preserves `at` (6→6), both cut-first and paste-first cross-page moves preserve time, and missing/trashed-new/duplicate references are rejected for paragraph, heading, bullet, numbered and quote blocks.
- Actual old 32ef34b roundtrip: initial candidate 21/21 passed. Heading-specific old-build save/rollback/re-upgrade passed on e5b7361. These rollback results remain applicable: 26957da changes only heading metadata preservation in the save path, with no migration changes.

No production writes or paid calls. Real physical-phone, native Chinese IME and Safari clipboard behavior remain unverified; synthetic composition events do not establish those results. Lead owns release and Brian’s native keyboard follow-up.

## Findings history

**76aac7d: NOT PASS.** Reviewer-authored `tests/evidence/ratchet-refs-84/heading-ref.ts/log` confirms heading inline pageRef nodes persist in editorJSON but are omitted from domain reference projection. `projectDocument` handles headings before `refsOf`; Linked from omits them and A2 destructive Undo cannot see them. Validation of unknown/trashed targets and duplicate reference identity is also bypassed for headings. Lead 0552bbc0 requires all allowed inline-content blocks share validation/projection, rather than banning heading links.

Initial independent verification:

- Enabled suite: 281 total, 277 pass, four TODO, no failures or skips. Existing tests miss the heading case.
- New and actual old 32ef34b checkouts built successfully. Author's built-app UI harness independently rerun: 40/40 pass; actual old-build roundtrip: 21/21 pass. Both used own fresh real-data copies.
- Source review includes pageRef extraction/identity history, all reference readers, editor trigger/clipboard/create paths, B15 stamping and layout-6 held-link/card conversion.

No reviewer implementation changes, production writes or paid provider calls. Evidence is in `tests/evidence/ratchet-refs-84/`. Simulated IME events are distinct from a real Chinese keyboard test, which remains a release follow-up for Brian.

Second independently reproduced defect: `search-ranking.mjs/log`, built app with pages “needle start” and “other needle”, query `[[needle` puts the substring match first. `linkItems` reverses the start-of-title comparator. This violates accepted prefix-first ranking. Reported separately; fixed and reverified on the final candidate.

## Followup e5b7361

Initial heading reference projection passes and enabled suite is 284/280 passed/four TODO. Reviewer-authored `heading-old-roundtrip.ts/log` uses actual 32ef34b save and verifies heading reference identity/time and the unrelated note survive rollback/re-upgrade.

**New confirmed heading-history gap:** `heading-history.ts/log` deletes a heading and saves, then restores the same heading/refId. `at` changes from 6 to 8; deleted heading metadata is empty. The save path preserves blocks but not Section.refs. Consequently heading Undo or cut-first cross-page moves lose their original reference time. Reported 88a126ad; fixed and reverified on the final candidate. Final heading-history and cross-page move checks now pass on 26957da.
