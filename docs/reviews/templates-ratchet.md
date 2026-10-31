# B70 part 1 and B71 independent review

**Final verdict: PASS — PR #33 `ac4dfba` combined with PR #34 `6077763`.** The initial findings below are resolved by the consolidated revision. Ready for Lead release review.

Review task #234. Baseline B70 PR #33 `745f2f2` (application `24e5cae`), B71 PR #34 `6077763`. Combined in the review-only branch `review/ratchet-templates`. This review uses invented data on isolated SQLite copies and a loopback Postgres 17 database. No production or user data is read or changed.

## Initial result: changes required

**Confirmed task-isolation defect:** cutting a real task into a template leaves its original taskId in the live editor. Saving normalizes the stored template row but does not repair that live editor state. The template's checkbox therefore calls `task-status` on the original task. A normal keyboard cut/paste reproduced the same control as an internal-payload replay. Clicking it changed the original Task's stored status/version. `EditorTask` also exposes Plan for today and task menus whenever that original ID resolves. Reported in Raft `b0315979`; request normalizing pasted task props and guarding every real-task control on templates.

Jazz independently identified the second-Day-after-None and missing mobile return path issues and supplied `adf1462`. Lead accepted both. They await the author's consolidated revision with the isolation fix.

## Independent checks

- Postgres round trip: create/save template, fresh repository reload at every command, new day copies retained words/fresh block IDs/empty tasks, default clear/Undo. Type and target persisted as `template`/`days`. Two throwaway account workspaces with overlapping page IDs retain independent templates/defaults. Schemas removed afterwards. This exercises the Postgres repository, not the deployed Worker transport.
- Baseline and combined suite: 165 passed, 0 failed, 3 credential-dependent skips. Typecheck and combined build pass.
- Chromium 1280 and WebKit 390: template typing persists through reload; None/Day pages selections persist. Additional layout/creation replay covers both browsers at both widths.
- Combined full alignment fixture plus actual template screen: 241 passed, 0 failed, 0 missing, 1280 and 390. `results/alignment.log` includes template rows directly. Account row checked separately on the template list: links present, centres aligned, no horizontal overflow at both widths/browsers.
- B71 independently passes: sidebar + centre/colour/right action edge in light/dark; Enter creates top-level untitled page and focuses title; phone Pages + does the same. A fixture with only day children shows “No pages yet” in the sidebar, while those children remain discoverable on Pages. No old DayPagesHint or bottom New page action remains.

## Replay and interpretation

Evidence lives in `tests/evidence/ratchet-b70/`. `postgres.ts` intentionally uses only a fixed loopback test database; `seed.ts`, `no-roots.ts` and the browser scripts target fixed `/tmp/ratchet234-*` copies/ports. Some scripts mutate their fixture and require reseeding for a clean replay. `cut.mjs` uses actual keyboard selection/cut/paste. `ui.mjs` also isolates the internal authenticated cut payload. Screenshots show invented words only.

Initial harness corrections are not application defects: first Postgres connection used a nonexistent local role; attempting Undo of `ensure-day` failed because that operation intentionally has no Undo. The final Postgres test exercises the user-visible default assignment Undo. Playwright `.check()` initially complained that the pasted checkbox did not stay checked; the underlying task update nevertheless persisted, confirmed from SQLite. The final cut replay uses click and inspects stored task state.

## Limits

Physical iPhone, installed Home Screen mode, third-party keyboards, and actual Worker/Postgres network transport are not exercised here. Stage 2 template creation/deletion/subpage defaults are outside this part 1 review. Cut/paste leaving an original task without a placement is an accepted existing limitation; this does not excuse task mutation from the template. Old-build rollback/cached-client display of templates as ordinary pages is documented by the author and must be included in the release/rollback assessment.

**Second confirmed issue:** a normal double-click on the initial Edit, with 600 ms request latency, queues two `create-template` actions with different page IDs and creates two Day rows. The first-phase UI offers no Delete. Reported as `f0e1b4fd`; request single-flight creation with a stable retry identity. This is distinct from Jazz's None → Edit duplication fix.

The accepted cut-placement limitation was verified more precisely: removing the final placement leaves the open task in `getDayView(...).openPool` (Tasks → Open), but not in `handoffTasks` or `carry` for the next day. It therefore does not reappear on the morning suggestion card merely by virtue of remaining open. This was explicitly relayed to Product and Lead; it does not represent loss of the stored Task.

## Consolidated revision `ac4dfba`

Re-reviewed the complete revision diff, combined with PR #34 `6077763`.

- **Task isolation resolved.** The template row context never resolves a real Task; pasted foreign IDs are normalized in the live editor outside Undo history. Actual keyboard cut/paste followed by clicking every template checkbox leaves the entire stored Tasks array unchanged. No real-task checkbox label, Plan action or row menu remains. See `cut-final.mjs` and `results/cut-final.log`.
- **Double Edit resolved.** Single-flight UI and server default reuse prevent duplicate Day rows. Delayed double-click leaves one template in Chromium and WebKit. None then the Templates crumb returns to one row with no Edit action. A failed create/retry keeps its page identity (captured from the actual serialized POSTs).
- **Navigation and layout:** Templates crumb returns to the list. Rechecked actual template screen plus full fixture: **247 passed, 0 failed, 0 missing** at 1280 and 390. Separate account-row geometry and template title/meta columns pass in Chromium/WebKit at both widths; no horizontal overflow. WebKit 390 typing/reload and target selections pass again. B71 creation/title-focus and sidebar geometry pass again on the combined revision.
- **Storage and checks:** repeated independent Postgres round trip and account A/B isolation pass. Final combined suite **166 passed, 0 failed, 3 skipped**; typecheck and build pass. This revision changes no database schema or production configuration.

A retry-test harness initially searched for plain JSON `pageId`, but TanStack serializes POSTs as keyed value arrays. Reading the captured UUID values confirmed the same page ID in both requests; the corrected extraction is in the replay. This was not a product failure.

The failed-request replay initially missed WebKit requests once its service worker took control: the trace contained zero intercepted POSTs and the template was created successfully. Blocking service workers for this network-fault test made the injected 503 deterministic; both Chromium and WebKit then retry with the same page ID and create exactly one template. The regular editing/layout runs retain the normal app environment. This is a harness correction, not a failed save in the application.
