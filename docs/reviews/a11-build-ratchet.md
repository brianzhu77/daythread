# A11 step 2 independent build review

Ratchet · task #146 · candidate **f672ba9**, accepted plan 8b808a5 and step-1 pass 04990a7. **FINAL BUILD REVIEW PASS at 6d9b25f.** All three independently reproduced URL defects are resolved. Earlier revision findings below are retained as history, not current blockers.

## Final recheck at 6d9b25f

Inspected the complete delta from ca70168. The server returns a page address derived from its own loaded workspace; editor and Trash use a full route load when the destination is absent from their snapshot. This does not change persisted workspace shape or chip styles.

Independently executed on this build:

- Production build and type check pass.
- **New target race, live source:** a second repository creates Nov 1 after client load, moves the task and releases the resolver request. Browser loads Nov 1 on fresh data and the exact moved row tints. Pass.
- **Same race, trashed source:** next run creates Nov 2 after client load; browser loads Nov 2 and the moved row tints. Pass. The reusable repro now accepts optional `trash` mode.
- Original resolver/trash/reload suite **4 pass**; three-mode critical suite **18 pass**; independent tag/Retry suite **10 pass** at 1280 and 390 touch. This includes original URLs with/without task=, exact failed-lookup notice, retained parameters, Retry and reload recovery, actual Tags-list source-page navigation, canonical copied-link task following, absent tag-row fallback and explicit task identity without row memory.

Prior independently executed 370-unit suite, complete 387/0/0 alignment, 48 stable/actions/caret checks and interaction reruns remain valid for unchanged areas. The last two diffs were inspected; no application CSS/domain state transition changed. Lead be5d2713 additionally reports a fresh final-head alignment gate 318/0/0; Jazz 175b16af independently reports the final race landing in Chromium/WebKit at 1280/390, tinted, no focus and no old-page row tint. Their execution is attributed separately.

No reviewer blocker remains. Lead owns final authenticated/deployed checks and promotion; this report does not claim a deployment. Phone drag and real Chinese IME remain outside demonstrated execution. The author's narrow-screen multi-selection assertion is now an honest skip; this reviewer previously verified a real phone handle selection of a two-block section with no Copy link.

## Follow-up history at ca70168

Both original failures are fixed. Independent original URL failure/reload probe: **4 pass**; three-mode critical probe: **18 pass**. A separate independent 1280/390-touch script: **10 pass**, including actual Tags-list click to its document, canonical line URL from the same existing row following the task, gone tag row fallback, explicit task without remembered source metadata, exact failed-lookup text, retained URL/top and successful Retry. Production build/typecheck pass. No domain or chip CSS changes, so earlier unit and baseline/layout evidence carries over. Independently reran the expanded author interaction suite at 390 touch: **81 ok, no page errors**. It explicitly skips phone drag and keyboard cut/paste.

**Remaining confirmed failure: newly created target page after the client's workspace load.** Intercept the first real resolver request; through a second actual SqliteWorkspaceRepository, create an unused future day and move the task there; then continue the request. The server correctly resolves the new page, but it is absent from the browser snapshot. PageEditor finds no `target`, attempts to locate the new row in the original page, and stays at the old URL without a notice. The second repository confirms the new plan day. Trash has the same snapshot lookup dependency. Repro: `new-page-race.mjs` with the independent synthetic manifest; report f4d74e0d. Lead 52e2ec46 directs a full fresh route load to the server's address when the client does not know its target page, for both editors and Trash. This must pass before the build review does.

The author's phone two-selected assertion is unconditionally true for widths below 900 and actually selected one row in this run. It is not proof of multi-selection suppression. Independently selected a two-block custom section through the real phone handle (heading plus its one paragraph); the actual phone bar showed section selected and Delete only, with zero Copy link buttons. Application behavior passes that independent case; strengthen the misleading assertion separately.

Jazz ffd56d5b reports ca70168 visual pass in Chromium/WebKit at both widths (menu flip, tags, lookup Retry); attribute her execution separately. She will recheck the concurrency fix's landing. Prior original report follows.

## Original confirmed findings (f672ba9)

1. **A task link made on a now-trashed document opens the wrong page.** Synthetic fixture: a task has its live planned row today and a reference row in a document. Trash the document, then open the document row's original canonical `/pages?page=…&block=…` URL in a fresh context. Both with and without `task=` stay on the trashed document. The same link's chip/domain resolver selects today's live task row. Reproduced at 1280, 390 and 390 touch. `TrashedPage/ReadOnlyBody` jumps locally before the server resolver ever runs. Route this URL through the same resolver before choosing a live/trashed page. Keep ordinary lines on their trashed page with Restore. Reported 5d503e19.
2. **A resolver failure silently converts a task-following link into a historical-row jump, and destroys retry information.** Route only the resolver request to HTTP 503, leaving every other request normal. The old-day history row flashes, address remains `/pages?page=day:2026-10-21`, `block/task` are removed, and no failure notice appears. Restoring the network and reloading cannot recover the intended task destination. The rejection callback calls `find(id)`, which treats the unresolved history row as authoritative. Show a resolution failure/retry state and retain the original target; do not silently jump to a potentially obsolete row. Reported 82bca5ff. This is an executed failure injection, not a guessed network risk.

Reproduce with the independent synthetic fixture and `tests/evidence/ratchet-a11-build/url-failures.mjs`. It records both trash URL forms, forced resolver failure, and reload recovery.

## Independently executed verification

- Candidate production build and type check: pass. Entire suite: **370 pass, 0 fail, 11 skipped, 4 todo** (385 total). Skipped/TODO are not executed evidence.
- Own prepared critical browser harness: **15 pass, 3 fail** across 1280, 390, 390 touch. Passes: fresh past-day history URL with/without task= reaches current day; ordinary chip jump with no editor focus, Enter and Back; long excerpt containment; ordinary trashed chip with Restore after reload. Three failures are finding 1, one per viewport mode.
- Independently reran the author's full interaction script at 1280 on a consistent copy of the supplied old workspace plus fresh A11 fixture: **74 ok, no page errors**. Exercises copy entry points, clipboard failure, MIME and own/foreign/malformed URL paste, task-title plain text, same-page repeated jumps, missing states, linked-from identity/time, edits, moves, drag and cut limitations. Author-authored script execution is distinguished from the separately authored critical/failure probes.
- Unchanged stable/actions/caret suites independently rerun on fresh isolated SQLite stores at **1280 and 390 touch: 48 ok**. Task deletion/Undo checks read actual stored identity and placement. Only the stable/actions scripts' fixed base URL was changed in the copied test harness; application code is unchanged.
- Independent alignment gate on old-data copy plus December-31 fixtures and line link: **387 pass, 0 fail, 0 missing** at 1280/390. First run had 375/0/2 missing because the preceding interaction suite emptied today's page, so it no longer had a Today dot. Added one synthetic note to today's page and reran the complete gate; this was fixture coverage, not an application defect.

Initial preparation used an overbroad chip selector that chose BlockNote's wrapper. That caused false keyboard and trash-marker failures. Calibrating to the actual `.line-ref` fixed those harness failures; they are not reported as product bugs. Preparation's early day-route fixture was also corrected to the accepted canonical `/pages?page=…&block=…` form before the final checks above.

Evidence logs and runnable failure probe are in `tests/evidence/ratchet-a11-build/`; seed and critical harness are in `tests/evidence/ratchet-a11-step2/`. All browser servers used loopback, synthetic or copied SQLite, auth off, no model calls. No application code, real workspace writes or deployment were performed by this reviewer.

## Changes and evidence owned by other teammates

Product f9fd41b8 accepts creating a line chip to a trashed page and plain-text paste when the target page is gone. Product 54096b19 changes the Tags rule: first open the actual line on the listed page; follow the task only if that row is gone. Copied line links always follow their task. Author 91820727 is implementing that distinction; f672ba9's document-task tag jump is not the final accepted behavior.

Lead c0b95be9 reports a separate complete alignment gate 318/0/0, candidate-to-live-450913a-to-candidate rollback on throwaway Supabase schema, and real revision-106 metadata maximum 4,676 B. Lead dropped the schema and did not change the real workspace. These are Lead's executed checks, not this reviewer's. Independent Postgres persistence checks from step 1 remain valid; final Supabase rollback and deployment are Lead's lane. Jazz's design check remains separate.

## Original remaining release boundary (superseded by final recheck above)

Re-review the tag and URL fixes at an identifiable new head, including resolver failure → recovery and original trash-task URLs with/without task=. Carry over unchanged unit/layout evidence only after inspecting the diff. Final auth/deployed smoke, exact rollback artifact and three-target deployment remain Lead's checks. A real phone drag/Chinese IME are not demonstrated by this review.
