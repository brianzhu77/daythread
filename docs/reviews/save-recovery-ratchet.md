# B35 task166 — final cea4e5f

**PASS.** The two confirmed loss defects from previous heads are fixed: copied opener tabs independently recover both drafts, and an unchanged parent's unsaved child is retained and nested. Checklist ticks and distinct same-word text/task identities pass the reviewer invariants. Source diff inspected through cea4e5f; own app changes: none.

Independent final evidence on newly seeded disposable stores:

- Full suite406 passed/0 failed/11 skipped/4 todo(421 total); typecheck and production build pass.
- Real-day writing replay10/10, plus cut/conflict/reload: original task id and done state retained.
- Reviewer nested-recovery, opener-slots and frozen-recovery browser scripts pass. Frozen tab is recovered once and resumes with one copy and the latest-loaded notice.
- Actual lost reply then close/reopen: normal/trailing-space/trailing-empty-line cases all retain one copy.
- Dedupe invariants4/4: unchanged-parent/new-child, intentional duplicate text, distinct same-word task, checklist tick.
- Save-on-leave gate12/12 on a fresh synthetic relative-day store, including refusal/recovery paths.
- Author tabs runner11/11 independently repeated **after one reviewer test-only fix**: scroll the Notes target into view before measuring/clicking. Original run failed6 cases because the target was below the viewport (y894, click906 in a900 viewport), activeElement was body and no marker was typed. This was diagnosed with actual selection/focus, then repeated on another fresh store. The test-only scroll fix needs author review before merging; it does not alter cea4e5f app code.

Final outputs are preserved under tests/evidence/ratchet-save-166/final-*.txt. Jazz9006449b confirms status/notice text unchanged from her862a5df390/1280 check. Hidden desktop10-minute timing and native WebKit/app-switcher kill behavior remain unverified, explicitly nonblocking per Product94a437ad/Leade3b62bd7; task155 holds native verification. No production writes/deployments by Ratchet. Lead owns release/integration.

## Prior-head findings and investigation

# B35 task166 — 862a5df follow-up

**REVISE: deduplication discards unsaved children and semantic changes.** The copied-tab identity blocker is fixed in actual Chromium: distinct ids, two slots, both markers recovered. This replacement introduces confirmed loss in `withoutSaved`: an unchanged parent's server node replaces the draft node together with all draft children. Reviewer browser run on fresh v4 fixture typed/nested a child under unchanged Parent note with saves blocked, closed/reopened: recovered=false, retainedInSlot=false, claimed=1. The words were gone from both UI and recovery storage. Script `nested-recovery.mjs` and output are preserved; the cursor offset11 confirms the unchanged parent text. Earlier attempts that split/cleared the parent were harness errors and excluded.

`dedupe-semantics.ts` independently executes the helper plus real mergeDraft: **2 pass, 2 fail**. Intentional same-words ordinary lines with distinct block ids survive; same-words tasks with distinct task ids survive (Lead0ce16749/Producta20ab60a cases). An unchanged parent's new child is lost, and an offline checklist tick with the same id/words is reverted. Dedupe must preserve children and semantic properties; text equality is insufficient. Reported2b858bf3 and c4a0d0f4. No app fixes by reviewer.

Independent current-head normal suite403 passed/0 failed/11 skipped/4 todo(418 total), typecheck/build pass. These do not cover the two additional failing recovery invariants. Prior-head10/10 real-day and cut/retry evidence below is not automatically a current-head pass. Hidden desktop timer check remains explicitly unverified/nonblocking; Product94a437ad accepts that gap. Jazz2d022b9d reports strings pass and WebKit page.close without closed mark may delay recovery10minutes; Lead e3b62bd7 assigns native app-switcher kill recovery to task155, nonblocking.

## Prior-head review

# B35 task166 — 6c7fad1 independent review

**REVISE: copied tab identities can still lose offline text.** Actual Chromium opener inherits the parent's sessionStorage, including `daythread.tab`. Two editors consequently write one localStorage key. Reviewer browser script `tests/evidence/ratchet-save-166/opener-slots.mjs` typed A and B into separate tabs with POST saves blocked, closed both and reopened: only B recovered. This is actual browser input, not a synthetic storage mock. Message66accf58 reports it; copied-id detection must preserve normal reload recovery and ensure concurrent live tabs have different identities. Recheck browser Duplicate Tab as well where available; that browser command was not executed by Ratchet.

## Independent executed evidence

- Full suite401 passed/0 failed/11 skipped/4 todo (416 total), typecheck and production build pass.
- Real-day replay10/10 on a freshly seeded disposable SQLite store: task identity, nesting, ticking, deleting text and a typed-then-cleared task, text/task cut-paste, historical task removal, two separately created tabs recovered, no page errors.
- Author's `b35/tabs-check.mjs` independently repeated:6 assertions pass, including frozen tab recovered and resumed without a duplicate and an ordinary live tab not claimed. Its shortened quiet interval is a test hook; not a ten-minute real background-timer observation.
- Lead62bf2071 lost reply followed immediately by close/reopen: reviewer `lost-close.mjs` passes normal text, trailing spaces, trailing empty line; each marker persists exactly once. Each route actually reaches the server before its response is dropped. Output preserved.
- Reviewer cut-recovery conflict mode: actual cut, blocked save, another repository changes the page, reload and Load latest retains original done task id and cutTaskIds.

## Remaining checks / limits

The requested10+ minute hidden desktop timer check is not verified: headed and headless Playwright both reported document.visibilityState='visible' even after foregrounding another page/minimizing the window, so the attempted harness stopped rather than claiming background coverage. Product94a437ad explicitly accepts the hidden-tab observation gap as nonblocking, with a user-report trigger to revisit the quiet cutoff. No native Safari/iPhone behavior claimed. Final candidate strings and recovery Undo are still pending Jazz/author changes. Saving retry/collision tests must be rerun on the replacement head. No production writes/deployments or app fixes by reviewer.
