# PR #46 review in progress

Ratchet · task #249 · 2026-10-31. **Not passed yet.** Original head 91527b8; final candidate ddd8a40, tested alone and combined with PR47 0f17f6c + main 40da378.

## Confirmed findings and revisions

1. **Apply all discarded edited suggestion text (91527b8).** Reproduced with the real hook in built Chromium 1280 and WebKit 390: edit new-task band, Apply all, original words saved. A shared edit store in 8a9e429 fixes this exact case in both engines (`edits-8a.log`).
2. **No-heading bands/more-open had no host (91527b8).** Null/empty anchor was dropped by the widget/UI. 8a9e429's position-1 host fixes it: both engines show the top band and expandable more-open and Apply works (`bare-8a.log`). A first check matched both old card and draft's Add buttons; scoped the selector to `.draft-more` before accepting.
3. **Ready draft replacement resurrects skipped new lines (91527b8).** Skip a line, store same proposed line with a new generation/item id; it returns. Current source protection keys by task id or item id, so only existing-task dispositions survive. Lead 98cb503a and subsequent refinement: first ready wins; failed fallback may Retry until first Apply/Skip, then it becomes final. Fixed in ddd8a40 and independently re-probed: ready drafts cannot be replaced; moved carried-task anchors relocate safely.
4. **Filtering stale anchors breaks coverage (91527b8).** Generate an item, move its anchor out of planning before `set-draft`. Normalization removes the band but `moreOpen` was computed earlier and omits its Task. Local domain probe confirms both lists empty. Recompute coverage after filtering against current state. Fixed in ddd8a40 and independently re-probed: ready drafts cannot be replaced; moved carried-task anchors relocate safely.
5. **Typing → Apply all → Undo leaves stale editor rows (91527b8 and 8a9e429).** After typing in a paragraph, Apply all, Undo, the draft is restored in workspace/title. On 91527b8 bands have no host because fills changed ids. With 8a9e429 slot ids preserved, bands return, **but applied editor rows remain visible beside them until reload**. The restored page document equals `lastSent` (the preceding flush), triggering `page-editor.tsx`'s early return even though the editor now holds Apply's document. This needs correct echo-versus-replacement detection; don't remove dirty/conflict protection. Initial harness expected Undo after reload (notice no longer exists) and initially mistook the 3s Show hold for missing bands; corrected before reporting the actual stale-row defect. Tight final replay asserts actual editor Task titles, not only band count.

**Known scope limit accepted by Lead 718baab1:** a reflection-only template whose first checkbox is under reflection is structurally classified as planning; actual model anchors and Apply can reach it. The model prompt and explicit Apply remain safeguards. Wording must be “writes only what he applies,” not a structural guarantee for any template. No new template metadata requested.

## Evidence obtained so far

- Original head: full suite 208 pass, 0 fail, 3 skipped; typecheck/build pass.
- Actual captured five experiment choices replayed through `itemsFromModel`, `withFallback`, `set-draft`, `draftView` using neutral aliases/dates. Task/journal titles omitted from Git. This is a deterministic replay of captured output choices, not a new model call. Historical input leakage still prevents predictive-quality conclusions.
- With real v2 plan rows, tasks already planned for the target are already on that page and are intentionally not proposed again. Coverage counts on 91527b8:

| Target | Raw choices | Visible bands | Other-open | Already placed on target |
| --- | ---: | ---: | ---: | ---: |
| Oct 27 | 1 | 1 | 2 | 0 |
| Oct 28 | 3 | 1 | 2 | 2 |
| Oct 29 | 2 | 1 | 1 | 1 |
| Oct 31 | 1 | 0 | 1 | 2 |
| Nov 1 | 2 | 2 | 0 | 0 |

All captured input tasks were covered by a band, more-open or existing target placement; planned-today ones remain on target. Product subsequently narrowed more-open to yesterday/overdue/due-today, so the final replay must use that revised eligibility, keeping future tasks on Tasks rather than counting them as missing.

- Built real-hook flows show immediate pre-Apply typing survives Apply and reload. Mixed Apply all uses one domain Undo; the remaining defect is the editor's visible reconciliation, not the stored Undo transaction.
- After an intercepted apply committed server-side but returned 503, the workspace refresh showed one remaining band and the generic “Not saved … Retry” notice. Final test still needs to assert retry id/receipt and task count, not merely inspect that notice.
- No new provider calls, no production data or writes. All fixtures invented except the explicitly authorized read of the previously shared experiment attachment. Source attachment and raw title text remain outside Git.

## Checks still required on final head

Corrected findings above; captured-output coverage under narrowed eligibility; mixed Undo with actual editor title assertions; uncertain-commit Retry; stale task/current-title/paused/deleted behavior; failed editor flush and composition; combined band geometry/alignment; hidden draft boundaries/owner changes and concurrency. Lead independently owns Worker/throwaway Postgres + real-provider verification; do not represent that as my own rerun. Cuts/Tomorrow migration is a separate PR and separate acceptance. Physical iPhone/Home Screen remain unverified.

## Final combined verification (22:12Z)

All five earlier findings are fixed on ddd8a40. The one-line editor reconciliation fix passes the strict check: after typing, Apply all and Undo, the actual editor task titles are only the empty slot, both bands return, and pre-Apply typing survives reload. Both Chromium 1280 and WebKit 390 pass.

- Same browsers: committed Apply response replaced with 503, generic Retry sends the same operation id, one new Task row remains. Failed editor save blocks Apply and retains both typed words and bands.
- Captured model choices pass again through the actual converter/fallback/normalizer/view, with narrowed morning eligibility and existing target placements counted. Actual dates, alias choices and yesterday-open flags are transcribed; no private titles/journal are in Git. Under the narrowed rule Oct 27's two future-only Tasks stay on Tasks, not more-open.
- Author `look.mjs` independently rerun on final #46: 68/68, both browsers/schemes, including edit forwarding, top host, held arrival and Show scroll (0px). It uses the stand-in store; real-hook tests above do not.
- Combined full suite 214 pass, 0 fail, 3 skipped; typecheck/build pass. Combined alignment on invented fixtures: 175 passed, 0 failed, 0 missing at 1280 and 390.
- PR47 migration and combined removal checks are in `draft-cuts-ratchet.md`.

**One remaining finding:** carried existing-task bands are editable, but explicit edits are ignored in `apply-draft`'s existing-task branch. Built reproduction in both engines: type “My renamed carry” over “Existing carry” in the band; per-item Apply saves “Existing carry”. Make these bands read-only for this release if renaming is not intended, or explicitly rename the same Task. Finding 64b1602e; `carried-edit.mjs` / log.

Not independently exercised here: actual provider/Worker transport (Lead ran a throwaway Postgres/Worker with model), native Pinyin/physical iPhone/Home Screen, true multi-account authenticated browser switching or two-device model-request races. Domain current-state/ready-disposition checks and existing account repository tests provide narrower evidence, not those unrun scenarios. Reflection-only template semantics remain an explicitly accepted limitation. No app code changed by reviewer.
