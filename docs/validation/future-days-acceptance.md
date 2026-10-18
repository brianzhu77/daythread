# R1–R9 acceptance — Ratchet r1
Status: **plan/scaffold, implementation not accepted**. Baseline c424bb2. Authoritative rules: product/date-rules24ab5d3 `docs/design/date-navigation-rules.md`; Jazz design/drag-and-dates d6c809f §4 and thread0efc5f66; scope clarified by Product54554196 and Leadf3ae9770.

R10 is excluded from this round. Empty past days keep their current behavior. R11 was a completed one-time audit, not new code. Old document headers (wait for prototype, Wheeljack ownership) are stale. Global “ensureDay only today or explicit create” is **future-day restriction only** until R10 is decided. The separate pending R10 default/independent commit must not be silently included here. Never change frozen3002 or real3000 data during these checks.

## Test setup and evidence
Use a fixed reviewed commit in a separate worktree, loopback port, private SQLite and seed. Seed today's page, one missing future day with planned Task A and due-only Task B, another existing future page with edited user text/editor JSON, and one missing past date. Derive today in America/Vancouver; record system time/date and repeat boundary logic with an injected clock if implementation supports one (do not change OS time). Browser widths1280/390. Record page IDs/count, revision, receipt IDs, Task/Placement identity and JSON fingerprint before/after. “No write” means no persisted mutation, including no new receipts/revision, not merely no new visible page. Observe actual command requests and SQLite snapshots; an app-render-only test cannot prove no mutation.

| Case | Action | Required result / evidence | Execution |
|---|---|---|---|
| R1 | Open today absent; refresh twice | Exactly one daily page with standard template; ordinary page editor works. After initial create, repeat read never resets text. Existing today content unchanged. | Not run |
| R2 | On today, hover and Tab to next arrow; Enter/Space/click | Dimmed inactive next; explanatory tooltip `Future days open from the Calendar`; single disabled control in accessibility tree. No future URL or write. On yesterday, next reaches today. Header positions remain fixed. | Not run |
| R3 | Open date-title picker; click/keyboard-select future date | Future cells disabled, no navigation or write. Existing future pages still aren't selected from this header picker; Calendar/URL are their entry points. Escape returns focus. | Not run |
| R4 | Open Calendar, inspect missing future date containing planned A/due B; activate cell | Cell is grey but actionable, both task types shown; no Empty page link/editor and no write. Desktop HeroUI Popover; phone AlertDialog. Copy includes date + hasn't happened yet + normal-template explanation. | Not run |
| R6 | Cancel / Escape / outside click; repeat; refresh Calendar | No page, revision or receipt change, tasks/placements unchanged; focus returns to cell/trigger where applicable. Dialog opening is not consent. | Not run |
| R7 | Paste missing future /day/YYYY-MM-DD URL; reload; browser back/forward | Page-sized dashed missing-day state with Create page and planned tasks. No blank editor; no automatic ensure-day/write. Test missing future even if another future page already exists. | Not run |
| R5 | Confirm Create from Calendar and direct-URL state | Exactly one page using ordinary template, existing planned placements shown once with same taskId/date/role; due-only task stays due-only. Open editor can save user text normally. | Not run |
| R5 retry/race | Double click Create rapidly, two tabs create same date, abort response after server commit then Retry | Exactly one page; no duplicate plan rows/tasks. Operation replay safe; stale-revision branch gives recoverable UI, no overwritten content. New unique operation must not reset an existing page. | Not run |
| R8 | Open already-created future page by Calendar and direct URL; refresh; reopen confirm from stale tab | Open directly with no prompt and no template overwrite. User text, editor JSON/block IDs and plan task IDs survive. Existing blank future page also opens directly; do not reinitialize because it is blank. | Not run |
| R9 | Plan task onto missing future date via each implemented entry point; also assign future deadline alone | Placement/deadline saved, destination page absent. Calendar shows planned/due items. Due-only does not become placement. Preserve Task ID/status/deadline and placement history. Replanning same task does not duplicate destination placement. | Not run |
| R9 → R5 | After no-page planning, explicitly create page; then reopen | Same task materializes once in correct plan section. No orphan placement or second Task; template rows remain ordinary rows. | Not run |
| Scope regression | Open missing past date; use existing daily note; copy/cut/Undo smoke | Past behavior matches baseline (R10 not implemented); no changes to editor source/styles. No raw-day-domain fields lost through SQLite. | Not run |

## Domain scaffold and binding
`tests/future-days.contract.test.ts` contains8 executable domain assertions plus4 explicit TODO boundary groups. Run opt-in:

```sh
FUTURE_DAYS_CONTRACT=1 node --test tests/future-days.contract.test.ts
```

Default run skips the8 new contract assertions until implementation is ready; TODO browser groups are **not passing evidence**. The scaffold uses existing `plan-task`, `add-task`, `getDayView` and an explicit-create binding `confirmedCreate()` currently calling `ensure-day`. If the engineer introduces a new create action or intent parameter, change that single binding to the actual action/schema, not production code to fit a speculative test API. Do not treat `getDayView` purity as proof that DayScreen/Calendar never dispatch a command. R2/R3/R4/R6/R7 need actual browser integration and request/SQLite evidence.

The explicit-create “once” contract concerns one page and one materialized task row. Repeated independent create commands may record receipts; R6/no-consent reads must not. Lost-response replay with the same operationId is required to be exactly unchanged. Confirm the actual new command shape against command-schema as part of implementation review.

## Baseline scaffold validation (performed, not implementation acceptance)
On c424bb2, opt-in suite:4pass /4fail /4TODO. All4failures stop at the existing known future-planning side effect (`place` creates a page); this is the intended negative control. Today template, due-only, command replay, existing-page preservation pass. Default invocation:8skip /4TODO /0fail. No browser implementation checks in the table have run yet. Raw baseline output: tests/evidence/future-days/baseline-contract.log.
