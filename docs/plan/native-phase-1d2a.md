# Native app, phase 1d.2a (The day draft): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On today's page in the morning he sees, under the title, where the day's draft stands (`Preparing…`,
`3 suggestions · Apply all · Dismiss`, `Couldn’t draft · Retry`, `Offline`), and each open suggestion as a row in the
page where it would land, which he applies or skips one at a time or all at once, with the web's notices and Undo.
Every rule of which suggestion shows, and where, is the web's.

**Architecture:** The web gains `POST /api/v1/day-draft` over a plain server function that `prepareDayDraft` now calls
too, and its draft's pure words and commands move into `.ts` files whose answers become shared cases under
`fixtures/core/draft/`. `DaythreadCore` reads the draft's document (extending 1c's `DayDraft`), ports `draftView` and
the readings under it, the draft line's state and words, the notices, and the commands `apply-draft`, `skip-draft` and
`reopen-draft`. `DaythreadSync` asks the route outside passes and the outbox; `set-draft` goes through `perform` as it
is. `AppModel` owns the ask (when, at most twice by itself, `Retry`, the answer, holding `set-draft` while the Undo slot
is held) and the draft's decisions; the day screen works `DraftView` out per state, never per keystroke, from the one
`TodoIndex` it now shares with the list, draws the line as the first row of the 1d.1 strip, and hands the list the
page and its suggestions in one call. The list gains "guest rows", which know nothing of drafts.

**Tech Stack:** As 1d.1: Swift 6 language mode, UIKit, Observation, Swift Testing, XCTest; SwiftUI for `DayFactsView`
only. TypeScript only in Task 1's files.

**Spec:** `docs/design/native-phase-1.md` §13 (slice 1d.2), with §11.4 and §11.5 (how an action is sent; the notice and
Undo) and §12.3 and §12.4 (the strip, one action at a time) behind it. Executors read §13 in full, and §13.9 to know
what must stay possible. The builder's check with the rulings already made is
`.superpowers/sdd/native-phase-1d2/builder-check.md`; the web's behaviour, with exact strings, is in
`.superpowers/sdd/native-phase-1/web-facts-1d.md` §1 to §3 and §6 to §8. Where either disagrees with the code, the code
wins.

**Status (2026-11-27):** Not started. The spike on guest rows in the list has reported
(`.superpowers/sdd/native-phase-1d2a/spike-report.md`; its code on the never-merged branch
`spike/native-1d2-guest-rows`); Tasks 11 and 12 are written from it and the controller's rulings on what it left open.

## Questions the plan raised, answered (2026-11-27)

The controller may overrule any of these; each names the option taken first.

1. **The web pull request moves more than §13.2 names.** §13.2 moves `skippedLabel` and the draft line's words. The
   plan also moves the draft's notice words and the three commands (with the skip's ticket) out of `day-draft.tsx` and
   `use-day-draft.ts` into plain `.ts` files, so that the Core's command text and notice words are held to cases the
   web's own functions write, as 1d.1 did with `planOnAction`. The other option: the Swift tests hard-code the web's
   command text. Taken: the move.
2. **Which seeded server meets the draft in the UI tests.** The app asks for a draft whenever today's page is shown, so
   every earlier UI test would meet a draft line. Taken: the today server (3741) is seeded with a hand-written empty
   ready draft (no line shows; its tests do not move); the morning server (3743) is left to ask, so it shows the
   model-less `Couldn’t draft · Retry` (§13.10's check) above the strip, and its tests must still pass; a fourth server
   (3744) holds the draft's own world. The other options: one shared server for everything (the earlier tests move), or
   no failed-draft UI test (§13.10 asks for one).
3. **Hosted app tests and the ask.** Every hosted test that shows today would otherwise make a `dayDraft` call the
   `TestServer` script does not expect. Taken: `AppModel` takes `asksForDayDrafts: Bool` (true in the app);
   `TestModel.swift`'s helpers pass false unless a test opts in, so no earlier test changes. The other option: script a
   draft reply into every earlier test.
4. **When the first ask goes.** §13.3 says "once when the page is first shown". The web asks whenever the page becomes
   eligible and has never been asked for in the tab (`use-day-draft.ts:147-150`): coming online, or today's page being
   made, also start it. Taken: the web's rule (Corrections).
5. **A refusal of `set-draft` other than `This day already has its draft`.** The web's loop sends any non-success twice
   (`use-day-draft.ts:134-138`); §13.3 says a refusal is a failed ask. Taken: a refusal (a `400` among them) is a failed
   ask at once, with no second send (the same command is refused again); an offline or server failure is sent once
   more. The other option: the web's two sends for everything.
6. **A `404 not-found` from the route** (the page went to Trash between the state and the ask). Taken: a failed ask
   like any other. The other option: a quiet state; nothing in the web has one.
7. **The skip's ticket.** `seen` is read from the state that holds the skip's answer (the builder's ruling), not before
   the skip as the web does (`use-day-draft.ts:193-195`); `skip-draft` changes no plan, so the two agree unless another
   device moved the to-do in between, when the later reading is the right one to compare against.
8. **Apply all or Dismiss when, after his words are handed over, some suggestions are no longer shown.** Taken: the
   command names only those still shown (worked out again from the workspace at that moment); with none left, nothing
   is sent and the notice is `Not applied · changed elsewhere` (or `Not skipped · changed elsewhere`). The other option:
   send the old ids and let the server answer `Nothing to apply`.
9. **Carried from 1d.1: one `TodoIndex` shared by the list and the screen.** In this plan (Task 6): `draftView` would
   be a third reader of the same workspace, and the list's own index is what the 1d.1 cost notes found doubled. The
   screen's two-slot cache becomes the only builder; the list takes the index it is handed.
10. **Carried from 1d.1: re-checking after the hand-over of his words.** In this plan (Task 7): `AppModel.act` and
   `AppModel.plan` take a `still` check the screen supplies, run after `handOverHisWords` returns and before the command
   goes; the draft's decisions (Task 10) use the same shape.
11. **A guest whose block the list does not hold** (his typing removed the anchor line since the last state; the
   suggestion's place lags by one save, §13.5). Taken: not drawn until the next hand-over. The other option: drawn at
   the end of the page.
12. **The line's place in code.** It is a row of `DayFactsView` (§13.4); `DayFactsModel` holds a `DraftLine?` beside
   its `DayFacts`, and the strip is hidden only when both are empty.
13. **How `sameWords` lowercases.** `toLocaleLowerCase()` with no locale follows the host's (`day-draft.ts:70`). Taken:
   the fixture script asserts an English default locale, the app lowercases as JavaScript does in `en-US`, and the
   web on a device set to Turkish, Azeri or Lithuanian may read two lines as the same where the app does not; recorded.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes. Exempt here: Task 1 (the web: its files are
  the expectations later tasks fail against), Task 13 (a measurement) and Task 15 (his checks).
- **Merging, not overwriting (Brian, 2026-11-26)** binds every task that touches a draft, a save or a load.
- The app holds no TypeScript, no JavaScript engine and no web view. Apple frameworks only; no third-party packages.
- Minimum iOS 26 and macOS 26; Swift 6 language mode with complete concurrency checking; no `@unchecked Sendable` or
  `nonisolated(unsafe)`. Mac Catalyst must keep building.
- `DaythreadCore` imports Foundation only, and words no date with `DateFormatter` or `Date.FormatStyle`: the names
  are the web's `en-US` ones, written out, whatever the device's language, region or zone. `DaythreadSync` never
  imports UIKit. **`DayFacts` holds strings and ids only: nothing of UIKit or SwiftUI.** Nor do `DraftView`,
  `DraftLine` and `DraftTicket`.
- The server stays the authority. **The only change under `src/` is Task 1's**, and it changes nothing the web shows.
- Nothing predicted is stored as the server's, and **a row action or a strip action is never drawn ahead**: it is
  sent and waited for. Nor is a draft's decision: a suggestion stays drawn as it was until the state holding the answer
  arrives.
- **An action never sends while the page it writes has a draft** (§11.4 step 3): the row's page for a row action,
  today's page for a strip action; a strip action with no live page of today (in Trash) is sent with no page to wait
  for. A draft's decision does not overtake today's page; `set-draft` is sent with no page to wait for (it writes only
  the draft's page).
- **An Undo is never shown that the app already knows the server would refuse** (§11.5). A skip's Undo
  (`reopen-draft`) does not use the server's slot and is not withdrawn when the slot moves.
- **A row gains no control except the reference row's `Plan for today`.** A suggestion is not a row of the page.
- **The strip's facts are read when a state is drawn, never on a keystroke** (§12.1's anti-goal). So is `DraftView`.
- A keystroke awaits nothing. While a text view holds marked text, its row is not reconfigured, reloaded or changed
  from outside (the input-method rule of §10.4).
- Never rely on the order in which an actor's published state and the return of the call that published it arrive:
  count or version it (`SyncState.published`).
- Anything that waits and may be cancelled uses `SyncEngine.sleep` (`Task.sleep(nanoseconds:)`), in code and tests.
- "Today" is the app's today (`AppModel.today`, the workspace's time zone), never the device's clock.
- Every on-screen string is one of §11's, §12's or §13's, verbatim (the table below). Each is added to
  `docs/design/native-system.md` in the task that first shows it, with where it shows.
- Use the system component with its default appearance; configure, never restyle (`native-app.md` §9). SwiftUI is
  used for `DayFactsView` only; the page's list stays UIKit and is not touched by it.
- **What 1d.2b and 1d.3 need stays possible**: a guest row's place can later be "in the place of" a block
  (`GuestRow.Place` gains a case); a guest's actions can later hold a menu and the row a tap; `DraftView` already holds
  `moreOpen`, `moreOpenAfterId` and each suggestion's skipped days; the line's words already cover `Suggestions ready ·
  Show`; `AppModel.plan` serves `N more open`'s `Added`.
- Never start anything on, or point a test at, port 3000, and never read `.daythread-local/`. Simulator: only
  `name=iPhone 17,OS=26.5`, never launched against production. Screenshots are of seeded data only. Before an
  `xcodebuild` run, wait until `pgrep -x xcodebuild` is empty twice, 15 seconds apart (not `-f`, which matches the
  waiting command itself).
- Commit messages: `feat(native): …`, `test(native): …`, `docs(native): …`, English only.

### The strings this slice shows

| Where | Words |
|---|---|
| The line | `Preparing…` (U+2026, beside the system's small progress view); `1 suggestion`, `3 suggestions`; `Apply all`; `Dismiss`; `Couldn’t draft` (U+2019, the typographic apostrophe); `Retry`; `Offline` |
| A suggestion | its words; under them the age `Thu 11/19`, or `skipped Sat, Sun` / `skipped 5 times`; buttons `checkmark` labelled `Apply <words>` and `xmark` labelled `Skip <words>`; VoiceOver `Suggestion, <words>, <age>` or `Suggestion, <words>, skipped Sat 11/21, Sun 11/22`, actions `Apply` and `Skip` |
| Notices | `Applied`, `Applied 2` (the server's count), `Skipped`, `Skipped 3`, each with `Undo`; `Undone`; `Not applied · changed elsewhere`; `Not skipped · changed elsewhere`; `Can't undo · edited since` (ASCII apostrophe; a row's refused undo keeps `Can't undo · changed since`); `Not done · your text is kept`; `Couldn't undo · your text is kept` (ASCII) |

The middle dot is U+00B7 everywhere. `Skipped` stays 10 seconds; `Applied` 8, `Undone` 4, a failure 6.

## Corrections to the spec made by this plan

- **`seen` is keyed by the item, not the to-do** (§13.8 says "for every skipped to-do, the day it was planned for").
  The web writes one key per skipped item that has a `taskId`, the item's id, in the draft's item order, valued with
  `plannedOn` of its to-do (`use-day-draft.ts:194-195`); a skipped line has no key; `itemIds` holds every skipped item,
  lines included. `DraftTicket` (Task 4) follows the code.
- **The hand-made draft with `moreOpen: false` is at `scripts/export-core-fixtures.ts:302`** (the survey says 298). It
  becomes `moreOpen: []`; `fixtures/core/written-days/cases.json` is regenerated with it.
- **A `404` already exists on v1 paths, as text.** `appRoute` answers `Not found` (plain text, `src/server/auth/
  app-path.ts:29`) for a path the gate did not see as an app path; the app reads that as `refused(404, nil)`. The
  route's new `404 { "error": "not-found" }` reads as `refused(404, "not-found")`. Both are failed asks (Question 6).
- **The first ask is not only "when the page is first shown"** (§13.3): it goes whenever today's page is drawn
  eligible (online, signed in, its page live, no draft standing) and has not been asked for in this run
  (`use-day-draft.ts:147-150`); so it also goes when the app comes online, or today's page is made, with the page on
  screen. "At most twice by itself" counts failed or lost asks, as `AUTO_ASKS` does (`use-day-draft.ts:89,112`).
- **`sameWords` depends on the host's locale** (`day-draft.ts:70`, `toLocaleLowerCase()`); §13.7 reads it as fixed.
  See Question 13.
- **Apply all cannot exceed the command's 50 ids** (`command-schema.ts:130`): `set-draft` stores at most 50 items
  (`:127`) and a remake adds only decided items to them (`remadeItems`, `day-draft.ts:172-179`), so at most 50 are
  open. Nothing is cut; Task 10 asserts no more than 50 are sent and records it if a case ever finds more.
- **Swift's `lowercased()` is not JavaScript's `toLocaleLowerCase()`** (found in Task 2): `"ΟΔΟΣ".lowercased()` ends
  in `σ` where JavaScript, and so the case file, end in the final sigma `ς` (U+03C2). `sameWords` lowercases scalar by
  scalar with `lowercaseMapping` and applies Unicode's Final_Sigma rule itself; `İ` gives `i` and U+0307 on both.
- **A `since` or `until` the calendar does not hold** (`2026-02-30`, which the web's pattern accepts in a hand-made
  `set-draft`) reads as absent in the app: the suggestion shows no age (found in Task 2's review).
- **"While the save is held" is not when the re-check runs** (Task 7's brief): handing his words over only stores them
  in the engine, and the save is sent later, inside the pass. The tests hold back a load's state instead, so that it
  reaches the model before the state that ends the hand-over.
- **A merge costs the screen two indexes, not one** (Task 7): one for the behind state with his words drawn in, whose
  facts are read when it is drawn, and one for the merged page handed to the list. It was three.
- **A row action whose today changed while his words were handed over is not sent** (Task 7's review; §11.4 is silent
  on it): the command would be built in yesterday's terms. He reads `Not done · your text is kept`, as for the strip.
- **A 401 on the ask also asks for a pass** (Task 5's review; the brief said "outside passes"): the ask is still not
  made inside a pass and holds none, but the session it found refused is ended by a pass's own path.
- **The word VoiceOver reads before a guest row's words comes from the host** (`GuestRow.spokenKind`), so the list has
  no word of its own for a suggestion (§13.5: the editor knows nothing of drafts).
- A correction found while building is written here with its reason before the code that follows it.

## Review Focus

1. **Suggestions arriving, leaving or moving above the line he types in**: a state that brings a draft while the
   keyboard is up, an apply's state taking a suggestion out above his line, a merge that moves an anchor, a Retry's
   draft replacing a failed one, a composition in progress through any of these, guests of very different heights
   far off screen, a change while the list still decelerates. His line stays where it is on the screen, the keyboard
   stays, the marked text stays (in a merge that takes his line away, only the caret's landing on a line is promised).
   Tests in Task 11 (`guests_arriving_above_the_typed_line_keep_it_where_it_is`, `…_leaving_…`,
   `guests_of_very_different_heights_keep_the_typed_line`, `a_guest_change_while_the_list_decelerates_keeps_the_typed_line`,
   `guests_changing_while_he_composes_keep_his_marked_text`,
   `a_merge_that_takes_the_typed_line_away_with_guests_changing_leaves_the_caret_on_a_line`) and Task 12
   (`a_state_that_brings_suggestions_keeps_the_typed_line_where_it_is`).
2. **A tap on a suggestion that changed after it was drawn**: applied or skipped on the web, its to-do ticked or set
   aside here or elsewhere, its anchor line deleted by his typing, the whole draft replaced by Retry. Nothing wrong is
   sent, and the notice says which. Tests in Task 10 (`a_suggestion_gone_after_his_words_were_handed_over_sends_nothing`,
   `nothing_to_apply_says_not_applied_changed_elsewhere`, `nothing_to_skip_says_not_skipped_changed_elsewhere`).
3. **`set-draft` arriving while he is being offered an Undo**: after a row action, a strip action or an apply, while an
   action is out, with VoiceOver running (the notice never times out), and after a skip (whose Undo does not hold it).
   It waits exactly as long as the slot is held, then goes. Tests in Task 8 (`set_draft_waits_while_the_undo_slot_is_held`,
   `a_skips_notice_does_not_hold_set_draft`) and Task 10 (`after_an_apply_set_draft_waits_for_its_undo`).
4. **The account or the day changing while an ask is out**: another account signed in before the answer, the answer
   made from another account's workspace, midnight while the ask is out, today's page put in Trash. No `set-draft`
   goes into a workspace it was not made from, and the new today is asked for. Tests in Task 8
   (`the_answer_of_another_owner_is_dropped`, `an_account_change_while_set_draft_waits_sends_nothing`,
   `midnight_during_an_ask_asks_for_the_new_today`).
5. **Drafts as the web leaves them**: a document that does not parse, one marked `preparing`, an item with no `state`
   (it is not open), `moreOpen` or `items` of the wrong kind, an anchor that is a nested block's id, two items on one
   anchor, a line whose words differ from a decided one only by case, white space (JavaScript's `\s`) or a trailing
   stop, `İ` and a Greek final sigma. The app shows what the web shows. Tests in Task 2
   (`documents_are_the_webs`, `same_words_are_the_webs`, `a_field_of_the_wrong_kind_reads_as_absent`) and Task 3
   (`views_are_the_webs`), against cases Task 1 generates.

---

### Task 1: The route, the draft's words as functions the fixtures can run, and the shared cases

This task is its own pull request: it touches `src/` and deploys. The web behaves exactly as before.

**Files:**
- Create: `src/server/day-draft-reply.ts`, `src/routes/api/v1/day-draft.ts`, `src/components/draft-words.ts`,
  `src/components/draft-actions.ts`, `tests/api-v1-day-draft.test.ts`, `tests/draft-words.test.ts`,
  `tests/draft-actions.test.ts`
- Modify: `src/server/functions.ts:64-89` (`prepareDayDraft`), `src/server/api-v1.ts` (`dayDraftRouteReply`,
  `handleDayDraft`), `src/components/use-day-draft.ts` (the state expression at `:241-243`, the actions at `:175`,
  `:193-199`, `:215`, `DraftTicket` and `DayDraftState` re-exported), `src/components/day-draft.tsx` (`skippedLabel` at
  `:350-354` moves out; `DraftLine` at `:672-691` draws `draftLineWords`; the notices' words at `:139`, `:164`,
  `:255-264`, `:306-335` come from `draft-words.ts`), `scripts/export-core-fixtures.ts` (`:302`, the new areas, the
  locale check)
- Create (generated): `fixtures/core/draft/documents.json`, `recipe.json`, `planning.json`, `same-words.json`,
  `views.json`, `skipped.json`, `skipped-labels.json`, `line.json`, `notices.json`, `actions/*.json`; regenerated:
  `fixtures/core/written-days/cases.json`, `fixtures/core/README.md`

**The route.** `prepareDayDraft`'s decision table (`functions.ts:66-88`) moves, unchanged, into:

```ts
// src/server/day-draft-reply.ts
export interface DayDraftReply { setDraft: string | null; owner: string; modelOn: boolean; remakeFailed: boolean }
/**
 * The day's draft for `date`, as `prepareDayDraft` has always answered it; null when `date` has no live daily page.
 * Stores nothing. Logs `draft.prepare` (counts and timings only) as before. `run` and `newId` are for tests.
 */
export async function dayDraftReply(
  ws: Workspace, date: LocalDate, owner: string, config: ModelConfig | null,
  options: { operationId: string; zone?: string; newId?: () => string; run?: typeof runDayDraft },
): Promise<DayDraftReply | null>
```

- `prepareDayDraft` keeps its validator and calls `dayDraftReply(await getRepository().load(), data.date,
  currentOwner() ?? "local", await accountModel(), { operationId: data.operationId, zone: account?.timezone })`, and
  throws `new Error("Day page not found")` on null, as now.
- `api-v1.ts` gains `export const dayDraftRequestSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().min(1).max(200) })`, and `export async function dayDraftRouteReply(repo: ServerRepository,
  owner: string, config: ModelConfig | null, zone: string | undefined, body: unknown, run?: typeof runDayDraft):
  Promise<{ status: 200; body: DayDraftReply } | { status: 400; body: { error: 'bad-request' } } | { status: 404; body:
  { error: 'not-found' } }>`; an unexpected throw propagates (a 500). `handleDayDraft(request)` reads the body as
  `handleCommand` does, `context()`, `accountModel()` and `currentAccount()?.timezone`, and answers `json(reply.status,
  reply.body)`.
- `src/routes/api/v1/day-draft.ts` is `commands.ts` with `/api/v1/day-draft` and `handleDayDraft`.

**What moves where** (nothing is copied; an old importer imports from the new file):

| Function | From | To |
|---|---|---|
| `skippedLabel(days: readonly LocalDate[], on: LocalDate): { text: string; full: string }` | `day-draft.tsx:350-354` | `draft-words.ts` |
| `type DayDraftState` | `use-day-draft.ts:16` | `draft-words.ts`; `use-day-draft.ts` re-exports it |
| `draftLineState(view: Pick<DraftView, 'status' \| 'items'> \| null, ask: DraftAskSummary, offline: boolean): DayDraftState` (new: the expression at `use-day-draft.ts:241-243`), with `type DraftAskSummary = 'in-flight' \| 'lost' \| 'failed' \| 'done' \| null` (`lost`: asking, past `LOST_MS`) | `use-day-draft.ts` | `draft-words.ts`; the hook maps its `Ask` to the summary and calls it |
| `draftLineWords(state: DayDraftState, shown: number, held: boolean): DraftLineWords \| null` (new: `DraftLine`'s choice of words; `held` is `n > 0 && !shown` there) | `day-draft.tsx:672-691` | `draft-words.ts`; `DraftLine` draws its result |
| `draftWords` (`preparing: 'Preparing…'`, `ready: 'Suggestions ready'`, `show`, `applyAll`, `dismiss`, `failed: 'Couldn’t draft'`, `retry`, `offline`, `notApplied`, `notSkipped`, `cantUndo: "Can't undo · edited since"`), `appliedNotice(n: number): string`, `skippedNotice(n: number): string` | inline in `day-draft.tsx` | `draft-words.ts` |
| `applyDraftAction(pageId: string, itemIds: string[], today: LocalDate, edits?: Record<string, string>): Action`, `skipDraftAction(pageId: string, itemIds: string[]): Action`, `draftTicket(ws: Workspace, pageId: string, itemIds: string[], skippedBy: string): DraftTicket`, `reopenDraftAction(pageId: string, ticket: DraftTicket): Action`, and `interface DraftTicket` | inline in `use-day-draft.ts:175,193-199,215` | `draft-actions.ts`; the hook calls them |

`DraftLineWords` is `{ kind: 'preparing' } | { kind: 'held' } | { kind: 'segments'; count: string | null; failed: boolean;
offline: boolean }`, its words from `draftWords`; `count` is `1 suggestion` / `N suggestions`. The actions keep the web's
key order (`type`, `pageId`, `itemIds`, then `edits` when given, then `today`; `skippedBy`, `seen` last for
`reopen-draft`).

**Interfaces:**
- Produces, for Tasks 2 to 4 (every case built by running the functions above, `draftOf`, `draftView`, the readings of
  `src/domain/day-draft.ts` or the server's own `applyCommand` through `harness()`, never written by hand; workspaces
  through `forBrowser`; `today` is `2026-11-26`, a Thursday, unless a case says otherwise; each case names the web test
  it mirrors as `test` when it mirrors one):
  - `draft/documents.json`: `[{ name, document, draft, settled, stale }]`: `draft` is `draftOf`'s parse (null when it
    does not parse), `settled` and `stale` are `draftSettled` and `draftStale` (absent when `draft` is null). Cases:
    `ready` with items; `failed` with every item open; `failed` with one `skipped`; `preparing`; ready with no `recipe`
    (1: stale); recipe 4 `ready` (stale); recipe 4 `failed`, all open (not settled: stands); recipe 5 `ready`; an item
    with no `state` (settled: it is not open); `{"status":"ready"}` with no `items`; `not json`; the 302 case corrected.
  - `draft/recipe.json`: `{ "recipe": DRAFT_RECIPE }` (5).
  - `draft/planning.json`: `[{ name, test?, document, tasks, range: { start, end }, planningEnd, moreOpenAfter }]` from
    `planningRange`, `planningEndIndex(doc, tasks)` and `moreOpenAfterIndex(doc, planningEnd)`. Cases: the built-in
    template (`TODO`, an empty to-do row, `Events`, `Good Stuffs`, `Notes`) (test `the planning part is the outermost
    section holding the first to-do row, never the reflection`); a first to-do row under a level-2 heading under a
    level-1; a to-do row nested under a bullet; no to-do row (the first section); no heading, to-do rows (the whole
    page; `moreOpenAfter` the last block holding one); no heading, no to-do row; one and two closing dividers (test
    `"more open" goes at the end of the planning part, before a closing divider, never under the heading`); plan rows
    of a known and of an unknown task directly under the heading; a heading with no `level`.
  - `draft/same-words.json`: `[{ text, words }]` from `sameWords`: `Call Mom.`, `  call   mom  `, `CALL MOM!`,
    `Call mom。`, `Call mom！`, `Done. . `, `...`, `""`, `a b`, `a　b`, `a\u0085b`, `a​b`, `İstanbul`,
    `ΟΔΟΣ`, `Straße`.
  - `draft/views.json`: `[{ name, test, workspace, pageId, view }]`, `view` from `draftView(ws, page)` (null for none).
    Cases, in this order (the first set from `tests/day-draft.test.ts`, then `tests/draft-apply-order.test.ts`, then
    the "not twice" tests across days, then the odd drafts):
    - `the view shows each open item where it goes, with the task under its current title` (a renamed to-do);
    - `a to-do done, cancelled or set aside elsewhere drops out; a renamed one stays and keeps its new title`;
    - `a fill whose slot he already wrote in goes after it; a gone anchor goes to the planning end`;
    - `"more open" lists the open to-dos it holds, minus any now on the page or closed`;
    - `after a fill, the bands anchored on that slot stay right after the filled row`;
    - `a carried to-do whose anchor left the planning part goes to the planning end, never lost`;
    - `partial Apply then Apply all never applies an item twice` (the view after the partial apply);
    - `a database view in the template changes nothing about the draft`;
    - `B102: the suggestions still waiting are shown in their offered places around the rows applied`;
    - `B102: a row he deleted or moved away no longer counts; the next lands after the nearest earlier one still there`;
    - `B102: a line he typed right below an applied row stays below the rows that follow it`;
    - `B102: rows applied before rows were kept are still found: a to-do by its row, a line by its words`;
    - `B102: with an empty slot, the bands still waiting sit where their rows will land` and `… a missing anchor …`;
    - `B102: a line that can't fill the slot, offered before a to-do that can` (before, and after the to-do applied);
    - `B102: Undo of a single apply puts it back` (the view after the undo);
    - `B101: applied today, the old draft for the skipped day no longer offers it` (the old day's page);
    - `B101: applied on the old draft first, today's draft no longer offers it; skipped today, the old one doesn't either`;
    - `B101: between two new drafts the line is known by where it came from, so the same words written again aren't taken for it`;
    - `B101: a decision a remake kept from an older draft still counts by its words`;
    - `B101: the same words written again on a later page aren't taken for an old draft's line`;
    - `carry: once today's draft is stored, the skipped day's draft hands its to-do lines on; its plain line stays`;
    - `not twice: a stored draft that doesn't hold the line takes nothing over; the old draft keeps offering it`;
    - `B106: a line he decided yesterday is never offered again today, carried by its id or typed anew, as a to-do or a line`;
    - `skipped days: ✕ and Dismiss both count, by the drafts’ own days, oldest first` (an item's `skipped`);
    - odd drafts: one whose document does not parse (null); `failed`, all open (`status: 'failed'`); `failed` with one
      skipped (`status: 'ready'`); `preparing` (`status: 'preparing'`); the draft in Trash (null); today's page in
      Trash and a new page `day:2026-11-26:2` with no draft of its own (null); a carried to-do's `createdOn` absent (no
      `since`); a line item with `since`; two items on one anchor; an anchor that is a nested block's id (planning end).
  - `draft/skipped.json`: `[{ name, test, workspace, day, skipped: [[taskId, [days]]] }]` from `skippedDays` (the
    `Map`'s order), mirroring each test of `tests/draft-skipped-days.test.ts` from `:34` to `:117`.
  - `draft/skipped-labels.json`: `[{ days, on, text, full }]` from `skippedLabel`: one day; `Sat, Sun`; three days; four
    (`skipped 4 times`); a day seven days before `on` (`11/19`); six days before (its weekday); across a year.
  - `draft/line.json`: `[{ name, view, ask, offline, held, state, words }]` from `draftLineState` then `draftLineWords`
    with `shown` the view's item count; `view` is `{ status, items: <count> }` or null; `ask` is a `DraftAskSummary`.
    Every row of §13.4's table, and: in flight with suggestions already shown (`segments`, not `preparing`); lost with
    nothing stored (`failed`); failed with a stored ready draft (the draft's state); offline with a stored draft; ready
    with no suggestion (null); failed with suggestions (`count` and `failed`); held.
  - `draft/notices.json`: `{ applied: [[1, 'Applied'], [2, 'Applied 2']], skipped: [[1, 'Skipped'], [3, 'Skipped 3']],
    notApplied, notSkipped, cantUndo }` from the functions and `draftWords`.
  - `draft/actions/<name>.json`: `{ before, pageId, itemIds, today, action, receipt, refusal, after, ticket }`:
    `action` from the builders, applied as is (`receipt` null and `refusal` the message when refused; `after` through
    `forBrowser`, its Undo marker `{ operationId: "cmd-<name>", revision }`); `ticket` from `draftTicket(after, …,
    'cmd-<name>')` for a skip. Names: `apply-a-carried-to-do-after-its-anchor`, `apply-fills-an-empty-slot` (the row
    keeps the slot's block id), `apply-a-new-to-do` (a new task, `createdOn` today), `apply-a-line` (`brought:` id),
    `apply-all-partly` (three asked, one done since: `Applied 2`), `apply-nothing` (`Nothing to apply`),
    `skip-one` (a ticket with one `seen` key), `dismiss-a-mix` (two to-dos, one planned yesterday and one not planned,
    and a line: `Skipped 3`, `seen` `{ i1: '2026-11-25', i2: null }` in draft order, `itemIds` all three),
    `skip-nothing` (`Nothing to skip`), `reopen-after-a-skip` (`before` is `dismiss-a-mix`'s `after`: `Brought back 3`),
    `reopen-after-a-later-change` (applied since: `Cannot undo after later changes; current values kept`),
    `undo-an-apply` (`undo` of `apply-a-carried-to-do-after-its-anchor`: the item open again, the row gone).

- [ ] **Step 1: Write the tests** (Node's runner, beside the web's own):
  - `tests/api-v1-day-draft.test.ts`, over a SQLite repository as `tests/api-v1.test.ts` builds one:
    - `day-draft: a day with no draft gets the set-draft command as text, made without the model`: status 200;
      `JSON.parse(setDraft)` has `type: 'set-draft'`, the day's `pageId`, `status: 'failed'`, `recipe: 5`; `owner`
      `local`, `modelOn` false, `remakeFailed` false; the repository's revision unchanged (nothing stored).
    - `day-draft: a draft that stands answers setDraft null` (a stored `ready` recipe 5 draft).
    - `day-draft: a settled draft of an older recipe with no model answers remakeFailed` (recipe 4 `ready`, `config`
      null: `setDraft` null, `remakeFailed` true, `run` never called).
    - `day-draft: a settled older draft whose remake is not ready answers remakeFailed` (a `run` stub answering
      `failed`).
    - `day-draft: a date with no live day page is 404 not-found` (no page; the page in Trash).
    - `day-draft: a body that does not read is 400` (no `date`; `2026-1-1`; `operationId` empty and of 201
      characters; not JSON).
    - `day-draft: the route is wrapped in appRoute, and a body not said to be JSON is 415` (the existing "every route
      file" test covers the wrapping; this one calls the route's handler with `text/plain`).
  - `tests/draft-words.test.ts`: `skippedLabel(['2026-11-21', '2026-11-22'], '2026-11-26')` is `{ text: 'skipped Sat,
    Sun', full: 'skipped Sat 11/21, Sun 11/22' }`; a day seven days before reads `11/19`; four days read
    `skipped 4 times`; `draftLineState` gives each of §13.4's states as the hook did; `draftLineWords('preparing', 0,
    false)` is `{ kind: 'preparing' }`, `('ready', 3, false)` is `{ kind: 'segments', count: '3 suggestions', failed:
    false, offline: false }`, `('ready', 1, false)` counts `1 suggestion`, `('failed', 2, false)` has both, `('ready',
    0, false)` and `('none', 0, false)` are null; `draftWords.failed` is `'Couldn’t draft'`.
  - `tests/draft-actions.test.ts`: `JSON.stringify(applyDraftAction('day:2026-11-26', ['i1'], '2026-11-26'))` is
    `{"type":"apply-draft","pageId":"day:2026-11-26","itemIds":["i1"],"today":"2026-11-26"}`;
    `skipDraftAction` is `{"type":"skip-draft","pageId":"day:2026-11-26","itemIds":["i1","i2"]}`; `draftTicket` keys
    `seen` by item, only for to-do items, in the draft's order, `null` for one not planned; `reopenDraftAction` is
    `{"type":"reopen-draft","pageId":…,"itemIds":[…],"skippedBy":"op","seen":{"i1":"2026-11-25","i2":null}}`.
- [ ] **Step 2:** Write the route and move the functions as the tables say. `npm test`, `npm run typecheck`. Expected:
  all pass, the web's existing tests unchanged (`tests/day-draft*.test.ts`, `tests/draft-*.test.ts` among them).
- [ ] **Step 3:** Correct `:302` to `moreOpen: []`. Add the areas above to `scripts/export-core-fixtures.ts`, and before
  them a check that `Intl.DateTimeFormat().resolvedOptions().locale` starts with `en` (as the time zone is checked). The
  script asserts: every `views.json` case with a non-null view has the `test` it names among the web's test names
  (read from the test files); `apply-fills-an-empty-slot`'s row keeps the slot's id; `apply-all-partly` applied
  exactly two; `reopen-after-a-skip`'s `after` has those items `open` and without `by`. `npm run fixtures`,
  `node scripts/export-core-fixtures.ts --check`, `npm test`, `npm run typecheck`. Expected: all pass.
- [ ] **Step 4: Look**: the web's phone layout (a dev server from this checkout on a port that is not 3000, sign-in
  off, a scratch SQLite file) on today: `Couldn’t draft · Retry` as before; with a hand-written `set-draft`, the
  bands, `Apply all`, a skip's notice with `Move to`, and `skipped Sat, Sun` on a band, as before. Then `curl -X POST
  -H 'content-type: application/json' -d '{"date":"<today>","operationId":"look"}' http://127.0.0.1:<port>/api/v1/day-draft`
  answers the reply, and a date with no page answers 404 `{"error":"not-found"}`.
- [ ] **Step 5: Commit** `feat(native): POST /api/v1/day-draft; the draft's words and commands in files the fixtures
  run; shared cases for the day draft`.

### Task 2: Core: the draft's document, and where an item sits

**Files:**
- Modify: `native/Packages/DaythreadCore/Sources/DaythreadCore/DayDraft.swift` (the reader of 1c, extended),
  `…/DaythreadCore/TodoIndex.swift` (`readDrafts` keeps every draft; `isPlanned(_:after:)`)
- Create: `…/DaythreadCore/DraftPlanning.swift`, `…/DaythreadCore/SameWords.swift`, `…/DaythreadCore/Block+Rows.swift`
- Test: `…/DaythreadCoreTests/DayDraftTests.swift`, `…/DraftPlanningTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: `draft/documents.json`, `recipe.json`, `planning.json`, `same-words.json` (Task 1); `JavaScriptSpace`,
  `InlineText.plain`, `Document.blocks`, `CodeUnitKey`, `TodoIndex` (existing).
- Produces:

```swift
/// A day's draft (`DayDraft`, `src/domain/day-draft.ts:12-40`): the hidden page `draft:<day page id>`, whose document
/// is an object. Beyond parsing the web checks no shape, so a field of the wrong kind reads as absent.
public struct DayDraft: Hashable, Sendable {
  public enum Status: Hashable, Sendable { case preparing, ready, failed, unknown }
  public struct Item: Hashable, Sendable {
    public enum Place: Hashable, Sendable { case fill, after }        // `fill` only for exactly "fill"
    public enum State: Hashable, Sendable { case open, applied, skipped, unknown }   // absent: unknown, not open
    public let id: String                 // "" when absent
    public let anchor: String             // "" when absent: no anchor
    public let place: Place
    public let taskId: String?
    public let block: Block?              // read as `Document.blocks` reads a block
    public let state: State
    public let until: LocalDate?
    public let by: String?
    public let from: String?              // nil for "" (the web tests its truth)
    public let since: LocalDate?
    public let recipe: Int?
    public let took: [String]
    public let row: String?               // nil for ""
    /// `sameWords(inlineText(block.content))`; nil without a block.
    var words: String? { get }
  }
  public let status: Status
  public let items: [Item]
  public let moreOpen: [String]
  /// Nil when absent: read as 1.
  public let recipe: Int?
  /// `DRAFT_RECIPE`: 5, held to the web's by `draft/recipe.json`.
  public static let currentRecipe = 5
  /// Nil when the document does not parse, or is not an object (`draftOf`).
  public init?(document: String)
  /// `draftSettled`: ready, or some item not open.
  public var settled: Bool { get }
  /// `draftStale`: settled, and its recipe older than `currentRecipe`.
  public var stale: Bool { get }
  /// The to-dos it applied (1c's `Since` reads it; unchanged).
  var appliedTaskIds: Set<CodeUnitKey> { get }
}

extension TodoIndex {
  /// `draftOf`: the draft of a day page, from the draft pages the index parsed once (not in Trash; the first of an id).
  public func dayDraft(of dayPageId: String) -> DayDraft?
  /// Every draft page not in Trash, in the workspace's order, with its parent's id (`takenOver`, `decidedElsewhere`,
  /// `skippedDays` walk them); a document that does not parse is left out.
  var dayDrafts: [(pageId: String, parentId: String?, draft: DayDraft)] { get }
  /// The standing draft rule of `use-day-draft.ts:91`: stored, and not stale.
  public func draftStands(for dayPageId: String) -> Bool
  /// `plannedAfter`'s question for one to-do: a plan row on a day page dated after `day`.
  public func isPlanned(_ taskId: String, after day: LocalDate) -> Bool
}

extension TodoTask {
  /// `eligibleTask`: open and not set aside.
  public var eligibleForADraft: Bool { get }
}

/// `sameWords` (`day-draft.ts:70`): lower-cased as JavaScript's `toLocaleLowerCase` in `en-US`, every run of `\s` one
/// space, a trailing run of `\s . 。 ! ！` dropped, trimmed as `String#trim`.
func sameWords(_ text: String) -> String

/// Where an item goes on the page as it is now (`Placement`, `day-draft.ts:257`).
public struct DraftPlacement: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case fill, after }
  public let kind: Kind
  /// The anchor's index (fill) or the insertion index (after), among the page's top-level blocks.
  public let index: Int
  public let anchorId: String?
}

/// The planning part of a day page and an item's place in it, over the page's top-level blocks. `tasks` is the
/// workspace's to-do ids.
enum DraftPlanning {
  static func range(of blocks: [Block]) -> Range<Int>                                   // planningRange :208-226
  static func end(of blocks: [Block], tasks: Set<CodeUnitKey>) -> Int                   // planningEndIndex :229-234
  static func moreOpenAfter(in blocks: [Block], planningEnd: Int) -> Int                // moreOpenAfterIndex :241-250; -1: none
  static func place(_ item: DayDraft.Item, in blocks: [Block], tasks: Set<CodeUnitKey>) -> DraftPlacement?  // placeItem :263-275
  static func amongApplied(_ item: DayDraft.Item, at placed: DraftPlacement, in blocks: [Block], draft: DayDraft)
    -> DraftPlacement                                                                    // amongApplied :284-314
}

extension Block {
  /// `isTaskRow` (`editor-document.ts:58`): a `task` whose `taskId` is a string.
  var isTaskRow: Bool { get }
  /// `isEmptyLine` (`editor-document.ts:68`): not a page link, heading, button, smart note, image or file; no words
  /// (JavaScript's `trim`), no inline item that is not text, no children.
  var isEmptyLine: Bool { get }
  /// This block and every block under it, depth first (`flatNodes`).
  var flattened: [Block] { get }
}
```

  `compatible` (`:252-255`) is private to `DraftPlanning.place`. A heading's level is `props.level` read as JavaScript's
  `Number(x ?? 1)`. The index's walk already parses every live page; the draft pages are parsed in the same pass that
  `readDrafts` now makes for the days with plan rows, once each, and `appliedByDayPage` reads from them.

- [ ] **Step 1: Write the failing tests.**
  - `DayDraftTests.documents_are_the_webs` over `draft/documents.json`: `DayDraft(document:)` is nil exactly where
    `draft` is null; otherwise its status, each item's fields, `moreOpen` and `recipe` equal the case's, and `settled`
    and `stale` equal the web's.
  - `DayDraftTests.the_recipe_is_the_webs` (`DayDraft.currentRecipe == recipe.json`'s; a raise on the web fails here).
  - `DayDraftTests.a_field_of_the_wrong_kind_reads_as_absent` (Review Focus 5): `"items": 5` and `"moreOpen": false`
    read as empty; `"state": 3` is `.unknown` and makes the draft settled; `"place": "Fill"` is `.after`; `"from": ""`
    and `"row": ""` are nil; `"took": "x"` is empty; `[]` and `5` as the whole document are nil.
  - `DayDraftTests.the_index_parses_each_draft_once_and_finds_it` (a workspace with two drafts of one id, the first in
    Trash: `dayDraft(of:)` is the second; `dayDrafts` lists only it; one that does not parse is not listed).
  - `DayDraftTests.a_draft_stands_when_stored_and_not_stale` (a failed draft, all open, stands; an older recipe's
    unsettled one stands; an older recipe's ready one does not; none does not).
  - `DayDraftTests.since_still_reads_what_a_draft_applied` (1c's `CarriedTests` pass unchanged; one case here).
  - `DraftPlanningTests.planning_is_the_webs` over `draft/planning.json`: `range`, `end`, `moreOpenAfter` equal.
  - `DraftPlanningTests.same_words_are_the_webs` over `draft/same-words.json` (Review Focus 5).
  - `DraftPlanningTests.an_item_fills_only_an_empty_slot_of_its_kind` (a to-do item on an empty `task`, on a `task`
    with words, on an empty paragraph; a line item on an empty bullet and on an empty `task`).
  - `DraftPlanningTests.no_anchor_a_gone_anchor_or_one_outside_go_to_the_planning_end` and
    `nothing_safe_is_nil` (an end outside the range).
  - `DraftPlanningTests.is_planned_after_reads_plan_rows_of_later_day_pages` (a plan row tomorrow: true; a reference row
    tomorrow, a plan row today, a plan row on a page in Trash: false).
- [ ] **Step 2:** `cd native/Packages/DaythreadCore && swift test`. Expected: fail (the new symbols do not exist).
  Commit `test(native): the day draft's document and where an item sits, as the web reads them (red)`.
- [ ] **Step 3:** Implement. `sameWords` lowercases with `String.lowercased()` if the shared cases agree; where they
  do not (`ΟΔΟΣ`, `İstanbul`), the difference is written out and named in Corrections.
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the day draft's document, its planning part and where an item sits`.

### Task 3: Core: what the page shows of the draft, and the line's state and words

**Files:**
- Create: `native/Packages/DaythreadCore/Sources/DaythreadCore/DraftView.swift`, `…/DaythreadCore/DraftElsewhere.swift`,
  `…/DaythreadCore/SkippedDays.swift`, `…/DaythreadCore/DraftLine.swift`
- Test: `…/DaythreadCoreTests/DraftViewTests.swift`, `…/DraftLineTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: Task 2 (`DayDraft`, `TodoIndex.dayDraft(of:)`, `dayDrafts`, `isPlanned(_:after:)`, `DraftPlanning`,
  `sameWords`, `Block.isTaskRow`); `DayWords.shortLabel`, `DayWords.weekday`, `LocalDate.daysBetween` (existing);
  `draft/views.json`, `skipped.json`, `skipped-labels.json`, `line.json`.
- Produces:

```swift
/// What today's page shows of its draft (`draftView`, `day-draft.ts:371-399`): the open suggestions, placed against
/// the page as `workspace` draws it, and what `N more open` lists. Read per state and per merge, never per keystroke.
public struct DraftView: Hashable, Sendable {
  public struct Suggestion: Hashable, Sendable, Identifiable {
    public enum Mark: Hashable, Sendable { case todo, bullet, line }   // block type `task`, `bulletListItem`, else
    public let id: String                 // the item's id
    public let kind: DraftPlacement.Kind  // 1d.2a draws both after `anchorId`
    /// The top-level block it follows (`after`), or fills (`fill`); nil: the start of the page.
    public let anchorId: String?
    public let mark: Mark
    /// A carried to-do's current title; else the block's own words.
    public let words: String
    public let taskId: String?
    /// A carried to-do's `createdOn`, or a line's `since`.
    public let since: LocalDate?
    /// The earlier days he skipped a carried to-do, oldest first; empty for none.
    public let skipped: [LocalDate]
    /// Under the words: `skippedLabel`'s `text` when skipped, else `shortLabel(since)` (`Thu 11/19`), else nil.
    public let detail: String?
    /// The detail as VoiceOver reads it: `skippedLabel`'s `full` when skipped; nil (read as shown) otherwise.
    public let spokenDetail: String?
    /// `Suggestion, <words>, <spokenDetail ?? detail>`, or `Suggestion, <words>` (what the guest row's cell reads).
    public let spoken: String
    public var applyLabel: String { get }   // `Apply <words>`
    public var skipLabel: String { get }    // `Skip <words>`
  }
  public struct OpenTask: Hashable, Sendable { public let taskId: String; public let title: String; public let since: LocalDate? }
  /// `ready` when settled, else the stored status.
  public let status: DayDraft.Status
  public let suggestions: [Suggestion]
  public let moreOpen: [OpenTask]            // 1d.2b draws it
  public let planningEndId: String?
  public let moreOpenAfterId: String?        // 1d.2b
  /// Nil when the page has no draft. `page` is the page as `workspace` draws it; `index` is of `workspace`.
  public static func of(page: Page, in workspace: Workspace, index: TodoIndex) -> DraftView?
}

/// `decidedElsewhere` with `decidedMatch` (`day-draft.ts:109-166`): whether a line item was decided in another day's
/// draft. Pages are read for a carried line's source day only when an older recipe's item needs it, once per id.
func decidedElsewhere(in workspace: Workspace, index: TodoIndex, dayPage: Page) -> (DayDraft.Item) -> Bool
/// `takenOver` with `tookRef` (`:84-95`): `"<day page id> <item id>"` of every item a stored ready or failed draft took over.
func takenOver(_ index: TodoIndex) -> Set<CodeUnitKey>
/// `skippedDays` (`:324-354`): per carried to-do, the days before `day` he skipped it, oldest first.
func skippedDays(in workspace: Workspace, index: TodoIndex, before day: LocalDate) -> [CodeUnitKey: [LocalDate]]

public enum SkippedLabel {
  /// `skippedLabel` (`draft-words.ts`): `skipped Sat, Sun`; a day more than six days before `on` as `11/14`; four or
  /// more `skipped 5 times`. `full`: `skipped Sat 11/21, Sun 11/22`.
  public static func of(_ days: [LocalDate], on: LocalDate) -> (text: String, full: String)
}

/// The app's ask for a day page's draft in this run (`Ask`, `use-day-draft.ts:79-89`).
public enum DraftAsk: Hashable, Sendable {
  case asking(since: Date, failures: Int)
  case done
  case failed(failures: Int)
  /// `LOST_MS`: 60 seconds with no answer and the ask is lost.
  public static let lostAfter: TimeInterval = 60
  /// `AUTO_ASKS`: the asks the page makes by itself before only `Retry` asks.
  public static let asksByItself = 2
  public func inFlight(at now: Date) -> Bool
  /// `failuresOf`: an ask in flight counts as one more.
  public var failures: Int { get }
}

public enum DraftLineState: Hashable, Sendable { case none, preparing, ready, failed, offline }

/// The draft's line under the title (`draftLineWords`, `draft-words.ts`).
public enum DraftLine: Hashable, Sendable {
  case preparing
  /// `Suggestions ready` · `Show` (1d.2b; nothing in 1d.2a passes `held: true`).
  case held
  case segments(count: String?, failed: Bool, offline: Bool)
  public static let preparingText = "Preparing…"
  public static let readyText = "Suggestions ready"
  public static let show = "Show"
  public static let applyAll = "Apply all"
  public static let dismiss = "Dismiss"
  public static let failedText = "Couldn\u{2019}t draft"
  public static let retry = "Retry"
  public static let offlineText = "Offline"
  /// `1 suggestion`, `3 suggestions`.
  public static func count(_ n: Int) -> String
  /// `draftLineState`: `ask` nil when this run has not asked for the page.
  public static func state(view: DraftView?, ask: DraftAsk?, offline: Bool, at now: Date) -> DraftLineState
  /// Nil: no line. `shown` is the suggestions shown.
  public static func of(_ state: DraftLineState, shown: Int, held: Bool) -> DraftLine?
  /// The line's words for VoiceOver: `3 suggestions`, `Couldn’t draft`, `3 suggestions, Couldn’t draft`, `Preparing…`.
  public var spoken: String { get }
}
```

  `DraftView.of` follows `draftView` step for step, with the index for what the web reads by walking other pages:
  `onPage` is the to-dos with a row (any role) among `page`'s own blocks, flattened (they are parsed for the placement
  anyway); `later` is `isPlanned(_:after:)`; `elsewhere` and
  `skipped` are read only when an open item needs them, as on the web (`:378`, `:380`). The carried to-do's block is
  the web's `draft-row:<item id>` block. Nothing parses a document but `page`'s and, only for an older recipe's line,
  the pages `decidedMatch`'s `sourceDay` must search.

- [ ] **Step 1: Write the failing tests.**
  - `DraftViewTests.views_are_the_webs` over every case of `draft/views.json` (Review Focus 5): `DraftView.of(page:
    in: workspace, index: TodoIndex(workspace))` is nil exactly where `view` is null; otherwise `status`, each
    suggestion's `id`, `kind`, `anchorId`, `mark` (from the case's `block.type`), `words` (the block's words), `taskId`,
    `since`, `skipped`, then `moreOpen`, `planningEndId` and `moreOpenAfterId`, equal the case's, in order.
  - `DraftViewTests.skipped_days_are_the_webs` over `draft/skipped.json`, and `skipped_labels_are_the_webs` over
    `draft/skipped-labels.json`.
  - `DraftViewTests.a_suggestions_detail_and_spoken_words`: a carried to-do made `2026-11-19`: detail `Thu 11/19`,
    spoken `Suggestion, Call the dentist, Thu 11/19`; skipped `2026-11-21`, `2026-11-22` on `2026-11-26`: detail
    `skipped Sat, Sun`, spokenDetail `skipped Sat 11/21, Sun 11/22`, spoken `Suggestion, Water the ferns, skipped Sat
    11/21, Sun 11/22`; the age's spokenDetail nil; a new line with no `since`: detail nil, spoken `Suggestion, Pack the
    charger`; `applyLabel` `Apply Pack the charger`, `skipLabel`
    `Skip Pack the charger`.
  - `DraftViewTests.a_draft_on_a_drawn_page_reads_his_unsaved_words` (`workspace.drawing(draft:of:)` with a typed row of
    the suggested to-do: the suggestion is not shown; a typed line above the anchor moves nothing else).
  - `DraftLineTests.the_line_is_the_webs` over `draft/line.json` (the case's `ask` read as: `in-flight` an `asking`
    since 10 s, `lost` since 61 s, `failed` `.failed(failures: 1)`, `done` `.done`; `view` a `DraftView` with that
    status and that many suggestions): `state` and `of` equal the case's.
  - `DraftLineTests.the_words` (`count(1) == "1 suggestion"`, `count(3) == "3 suggestions"`, `failedText` has U+2019,
    `preparingText` ends in U+2026; `spoken` of `.segments(count: "2 suggestions", failed: true, offline: false)` is
    `2 suggestions, Couldn’t draft`).
  - `DraftLineTests.an_ask_is_lost_after_sixty_seconds_and_counts_as_a_failure` (`inFlight` at 59.9 s true, at 60 s
    false; `failures` of `.asking(failures: 1)` is 2).
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): what today's page shows of its draft, and the
  draft's line, as the web works them out (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the draft's view of today's page: suggestions, their places and the line`.

### Task 4: Core: the draft's commands, the skip's ticket and the notices

**Files:**
- Modify: `native/Packages/DaythreadCore/Sources/DaythreadCore/Command.swift`
- Create: `…/DaythreadCore/DraftNotice.swift` (`DraftDecision`, `DraftNotice`, `DraftTicket`)
- Test: `…/DaythreadCoreTests/DraftActionTests.swift`, `Fixtures.swift` (`draftActionNames()`, `draftActionCase(_:)`
  over `draft/actions/`)

**Interfaces:**
- Consumes: Tasks 2 and 3 (`DayDraft`, `TodoIndex.dayDraft(of:)`, `DraftView`); `Receipt`, `RowNotice`,
  `TodoIndex.plannedOn` (existing); `draft/actions/*.json`, `draft/notices.json`.
- Produces:

```swift
extension Command {
  /// `{ type, pageId, itemIds, today }` (`applyDraftAction`; the app sends no `edits`).
  public static func applyDraft(pageId: String, itemIds: [String], today: LocalDate) -> JSONValue
  /// `{ type, pageId, itemIds }`.
  public static func skipDraft(pageId: String, itemIds: [String]) -> JSONValue
  /// `{ type, pageId, itemIds, skippedBy, seen }`, `seen` in the ticket's order, a day nil written as `null`.
  public static func reopenDraft(_ ticket: DraftTicket, pageId: String) -> JSONValue
}

public enum DraftDecision: Hashable, Sendable { case apply, skip }

/// What a skip's Undo acts on (`DraftTicket`, `draft-actions.ts`).
public struct DraftTicket: Hashable, Sendable {
  public struct Seen: Hashable, Sendable { public let itemId: String; public let plannedOn: LocalDate? }
  public let itemIds: [String]
  /// The skip's operation id.
  public let skippedBy: String
  /// One per skipped item with a `taskId`, in the draft's item order.
  public let seen: [Seen]
  /// `draftTicket`: read from `draft` and `index` of the state that holds the skip's answer.
  public static func of(itemIds: [String], skippedBy: String, draft: DayDraft?, index: TodoIndex) -> DraftTicket
}

public enum DraftNotice {
  public static func applied(_ count: Int) -> String   // `Applied`, `Applied 2`
  public static func skipped(_ count: Int) -> String   // `Skipped`, `Skipped 3`
  /// The receipt's message when it reads `Applied` / `Applied N` (or `Skipped` / `Skipped N`), the server's count;
  /// else `applied(asked)` / `skipped(asked)` (a reply with no receipt).
  public static func text(after decision: DraftDecision, receipt: Receipt?, asked: Int) -> String
  public static let notApplied = "Not applied · changed elsewhere"
  public static let notSkipped = "Not skipped · changed elsewhere"
  /// A refused undo of an apply, or a refused reopen of a skip; a row's refused undo keeps `RowNotice.cantUndo`.
  public static let cantUndo = "Can't undo · edited since"
}
```

- [ ] **Step 1: Write the failing tests.**
  - `DraftActionTests.the_commands_are_written_as_the_web_writes_them`: for every case of `draft/actions/`,
    `JSON.write` of the command built from the case's `pageId`, `itemIds`, `today` (and ticket) equals
    `JSON.write(action)`.
  - `DraftActionTests.the_ticket_is_the_webs`: for each skip case, `DraftTicket.of(itemIds:, skippedBy: "cmd-<name>",
    draft: TodoIndex(after).dayDraft(of: pageId), index: TodoIndex(after))` equals `ticket` (keys and order).
  - `DraftActionTests.the_answer_takes_the_suggestion_out_of_the_view`: for each applied case, `DraftView.of` of
    `before` shows the asked suggestions and of `after` shows none of those applied; `apply-all-partly`'s third is still
    shown when its to-do is offered again; `undo-an-apply`'s `after` shows it again.
  - `DraftActionTests.the_notices_are_the_webs` over `draft/notices.json`; `text(after: .apply, receipt:` of
    `apply-all-partly`'s receipt `, asked: 3)` is `Applied 2`; with a nil receipt and 3 asked, `Applied 3`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): apply-draft, skip-draft and reopen-draft as the
  web writes them (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the draft's commands, the skip's ticket and the notices' words`.

### Task 5: Sync: asking the server for the day's draft

**Files:**
- Modify: `native/Packages/DaythreadSync/Sources/DaythreadSync/ServerTransport.swift`, `…/URLSessionTransport.swift`,
  `…/SyncEngine.swift` (a new `dayDraft(for:)`), `native/Packages/DaythreadSync/Tests/DaythreadSyncTests/FakeTransport.swift`,
  the fake in `…/SyncEngineDraftTests.swift`, `native/Tests/TestServer.swift`, the fake in
  `native/Tests/SignInFailureTests.swift`
- Test: `…/DaythreadSyncTests/URLSessionTransportTests.swift`, `…/SyncEngineTests.swift`

**Interfaces:**
- Produces:

```swift
/// `POST /api/v1/day-draft`'s reply. `setDraft` is the `set-draft` command as JSON text, or nil when the day's draft
/// already stands.
public struct DayDraftReply: Sendable, Equatable {
  public let setDraft: String?
  public let owner: String
  public let modelOn: Bool
  public let remakeFailed: Bool
  public init(setDraft: String?, owner: String, modelOn: Bool, remakeFailed: Bool)
}

public protocol ServerTransport: Sendable {
  // … as before
  /// `{ date, operationId }`; a `404 { error: "not-found" }` throws `TransportError.refused(status: 404, reason:
  /// "not-found")`; a reply without `owner`, `modelOn` or `remakeFailed`, or a `setDraft` neither string nor null,
  /// throws `.unreadable`.
  func dayDraft(token: String?, date: LocalDate, operationId: String) async throws -> DayDraftReply
}

/// What `SyncEngine.dayDraft(for:)` came to.
public enum DayDraftAnswer: Sendable, Equatable {
  case reply(DayDraftReply)
  /// The day has no live page on the server.
  case notFound
  case offline
  /// Signed out, signing out, or no copy shown.
  case signedOut
  /// Any other failure: a server error, a refusal, a reply this client cannot read.
  case failed
}

extension SyncEngine {
  /// Asks the server for `date`'s draft with the session's token, outside passes and the outbox: it waits for no
  /// pass, is never stored, and changes neither the state's `offline` nor its `failure`. The model compares the
  /// reply's owner with the account it asked under; the `set-draft` it holds is sent with `perform`, unchanged.
  public func dayDraft(for date: LocalDate) async -> DayDraftAnswer
}
```

  `FakeTransport` gains `Call.dayDraft(token:date:operationId:)` and `Reply.dayDraft(DayDraftReply)`. `TestServer`
  answers `dayDraft` from a queue of its own (`addDrafts(_:)`), never from the main script, and with none queued fails
  for lack of network without counting `unscripted`; it records `draftDates: [LocalDate]`. The sign-in test's fake
  throws `.offline`.

- [ ] **Step 1: Write the failing tests.**
  - `URLSessionTransportTests.day_draft_posts_the_date_and_operation_id` (a `POST` to `/api/v1/day-draft`, `Bearer`
    token, `Content-Type: application/json`, body `{"date":"2026-11-26","operationId":"op"}`).
  - `URLSessionTransportTests.day_draft_reads_the_reply` (`setDraft` a string; `setDraft` null).
  - `URLSessionTransportTests.a_day_draft_404_is_refused_not_found`, `a_day_draft_500_is_a_server_failure`,
    `a_day_draft_reply_without_its_fields_is_unreadable` (`owner` missing; `setDraft: 5`).
  - `SyncEngineTests.day_draft_asks_with_the_session_and_answers_the_reply` (the fake's call has the session's token
    and the date; `.reply` with the fake's reply).
  - `SyncEngineTests.day_draft_asks_nothing_signed_out_or_before_the_first_load` (`.signedOut`; no call).
  - `SyncEngineTests.day_draft_offline_leaves_the_state_alone` (`.offline`; the next state's `offline` and `failure`
    as before; nothing in the outbox).
  - `SyncEngineTests.day_draft_not_found_and_other_failures` (404 `not-found`: `.notFound`; 500 and unreadable:
    `.failed`).
  - `SyncEngineTests.a_set_draft_text_goes_through_perform_unchanged`: `perform(action: JSON.parse(text))` sends an
    action equal to `JSON.parse(text)` with its key order and number tokens, `readsBeyond: true`; after it applies, the
    state's `undoSlot` is its operation.
  - `SyncEngineTests.a_set_draft_refused_as_already_drafted_answers_the_refusal` (`.refused("This day already has its
    draft")`).
- [ ] **Step 2:** `cd native/Packages/DaythreadSync && swift test`. Expected: fail. Commit `test(native): asking the
  server for the day's draft (red)`.
- [ ] **Step 3:** Implement. The engine reads the session and owner inside its section, as `perform` does, and calls
  the transport outside it.
- [ ] **Step 4:** `swift test` in Sync; the app's unit tests build (the fakes conform). Expected: pass.
- [ ] **Step 5: Commit** `feat(native): ask the server for a day's draft, outside the outbox`.

### Task 6: One TodoIndex for the screen and its list

**Files:**
- Modify: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/DocumentViewController.swift` (`show`, `edit`,
  `replace`, `factsSource`), `native/Packages/DaythreadUI/Sources/DaythreadUI/DayViewController.swift` (`edit`,
  `replaceList`, `showDay`, `todoIndex(of:)`), `docs/plan/native-phase-1d.md` ("Cost, measured": one line saying the
  follow-up is done, and where)
- Test: `native/Packages/DaythreadEditor/Tests/DaythreadEditorTests/HeaderTests.swift` (or a new `IndexTests.swift` in
  the `OnScreen` suite), `native/Tests/DayFactsViewTests.swift`

**Interfaces:**
- Produces:

```swift
extension DocumentViewController {
  /// As before; `index` is of `workspace` and, when given, is what every row's facts are read with: the list builds
  /// none of its own. Nil builds one as before (for hosts that have none).
  public func show(page: Page, in workspace: Workspace, index: TodoIndex? = nil)
  public func edit(page: Page, in workspace: Workspace, index: TodoIndex? = nil, afresh: Bool = false)
  public func replace(document: String, in workspace: Workspace, index: TodoIndex? = nil)
  /// How many indexes the list has built (tests read it).
  public private(set) var indexesBuilt: Int
}
// DayViewController: `private(set) var indexesBuilt = 0`, counted in `todoIndex(of:)`, read by tests.
```

  The screen hands the list `todoIndex(of: w)` for the very workspace it hands it, at every call; today's change
  (`drawAgainForToday`) reads the index it was last handed.

- [ ] **Step 1: Write the failing tests.**
  - Editor: `an_index_handed_over_is_the_one_the_rows_read` (`edit(page:in:index:)`, then `replace(document:in:index:)`
    with the same workspace: `indexesBuilt == 0`; a row's marks read from the given index: a `TodoIndex` of a
    workspace whose to-do is due today gives `Due today`); `without_an_index_the_list_builds_one_as_before`.
  - App: `DayFactsViewTests.a_state_the_list_takes_builds_one_index` (a load that changes the page's words with no
    draft: the screen's `indexesBuilt` grows by 1 and the list's by 0); `a_day_with_no_page_builds_one_index`;
    `typing_builds_no_index` (a keystroke: both unchanged).
- [ ] **Step 2:** The editor's `xcodebuild test … -only-testing:DaythreadEditorTests/OnScreen` and the app's unit test
  command of 1d.1's Task 5 with `-only-testing:DaythreadTests/DayFactsViewTests`. Expected: fail. Commit `test(native):
  the screen and its list read one index of a workspace (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The editor's tests in full, the app's unit tests in full (`TypingFeelTests` within its budget), the
  Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): one TodoIndex of a workspace for the day screen and its list`.

### Task 7: The action re-checked after his words are handed over

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift` (`act`, `plan`),
  `…/DaythreadUI/DayViewController.swift` (`run`, `plan`, `rowStillOffers`, `isListedAside`)
- Test: `native/Tests/RowActionTests.swift`, `native/Tests/DayFactsActionTests.swift`

**Interfaces:**
- Consumes: Task 6 (the screen's index).
- Produces:

```swift
extension AppModel {
  /// As before, with `still`: asked after his words are handed over and before the command goes; false sends nothing
  /// and answers `.notDone`. The screen reads in it what it showed when he tapped (the row and its menu, or the to-do
  /// in `Not today`), against the workspace and the words it draws now.
  public func act(_ action: RowAction, taskId: String, pageId: String, pageDate: LocalDate, owner: String,
    still: @MainActor () -> Bool) async -> RowActed
  public func plan(_ taskId: String, on date: LocalDate, notOvertaking pageId: String?, owner: String, notice: String,
    still: @MainActor () -> Bool) async -> RowActed
}
```

- [ ] **Step 1: Write the failing tests** (hosted, the test server's saves held):
  - `RowActionTests.a_row_action_whose_to_do_closed_while_his_words_went_sends_nothing`: type in a line, swipe
    `Tomorrow` on a to-do row; while the save is held, a load makes the to-do done; release: the server got the save
    and no `plan-task`; the notice `Not done · your text is kept`.
  - `RowActionTests.a_row_he_deleted_while_his_words_went_sends_nothing` (the row's line removed in the words handed
    over).
  - `DayFactsActionTests.a_strip_action_whose_to_do_was_brought_back_meanwhile_sends_nothing` (a load brings it back
    while the save is held: no `plan-task`).
  - `RowActionTests.an_action_still_offered_is_sent_as_before` (the earlier tests pass unchanged).
- [ ] **Step 2:** The app unit test command with `-only-testing:DaythreadTests/RowActionTests` and
  `-only-testing:DaythreadTests/DayFactsActionTests`. Expected: fail. Commit `test(native): an action is checked again
  once his words are handed over (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The app's unit tests in full; the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): row and strip actions checked again after his words are handed over`.

### Task 8: UI: the ask, in the model

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift` (stored properties, the init's
  `asksForDayDrafts` and `draftSleep`), `…/DaythreadUI/DayViewController.swift` (calls the model; sets
  `holdsUndoSlot`), `…/DaythreadUI/NoticeView.swift` (`onChange`), `native/Tests/TestModel.swift` (`asksForDayDrafts:
  false` by default), `native/Tests/TestServer.swift` (`holdDrafts()`, `releaseDrafts()`)
- Create: `…/DaythreadUI/AppModel+DayDraft.swift`, `native/Tests/DraftAskTests.swift`

**Interfaces:**
- Consumes: Task 3 (`DraftAsk`, `TodoIndex.draftStands(for:)`), Task 5 (`SyncEngine.dayDraft(for:)`,
  `DayDraftAnswer`), Task 7.
- Produces:

```swift
extension AppModel {
  /// §13.3: the day screen drew today's live `page` (it calls this for every state it draws there). Asks when the app
  /// is online and signed in, the page's draft does not stand, and this run has not asked for the page.
  public func todayDrawn(_ page: Page)
  /// He came back to today's page: the app came to the foreground with today shown, or today was shown again after
  /// another day. Asks again when the last ask for the page failed or was lost, while fewer than
  /// `DraftAsk.asksByItself` asks for it have failed, and its draft still does not stand.
  public func cameBackToToday(_ page: Page)
  /// `Retry`: asks, unless an ask for the page is in flight.
  public func retryDraft(_ page: Page)
  /// This run's ask for the day page; nil before the first. Observable; a lost ask is published as such at 60 s.
  public func draftAsk(of pageId: String) -> DraftAsk?
  /// Set by the day screen: true while an action is out, or while the notice offers an `Undo` that the server's slot
  /// holds. While true, an answer's `set-draft` waits; it goes as soon as this is false.
  public var holdsUndoSlot: Bool
}

final class NoticeView {
  /// Called whenever what it shows changes: shown, its Undo withdrawn, timed out, swiped away, dismissed.
  var onChange: ((Notice?) -> Void)?
}
// AppModel's internal init gains `asksForDayDrafts: Bool = true` and
// `draftSleep: @escaping @Sendable (Duration) async throws -> Void = SyncEngine.sleep`.
```

  **The answer** (§13.3): a reply whose `owner` is not `state.owner` now is dropped (the ask counts as done, as on the
  web); `remakeFailed` is a failed ask; `setDraft` nil loads the workspace (`refresh()`) and is done; otherwise, once
  `holdsUndoSlot` is false and only if `state.owner` is still the reply's owner, `engine.perform(action:
  JSON.parse(setDraft), notOvertaking: nil)`: applied, or refused `This day already has its draft`, is done; offline or
  signed out mid-send is sent once more (Question 5); any other refusal, and a second failure, is a failed ask; no
  notice in any case. `notFound`, `offline`, `failed` are failed asks. An ask's outcome is written only while it is
  still the page's latest ask (a late answer to a lost ask does not overwrite a newer one). Nothing is stored on the
  device.

  **The screen**: `showDay` calls `todayDrawn(page)` when `date == model.today` and the content is `.page`; the
  screen's became-active handler (`dayMayHaveChanged`) and a `drawnDate` change to today call `cameBackToToday`.
  `holdsUndoSlot` is set from `actionOut != nil`, and from the notice through `onChange`: true while `noticeOf` is the
  shown notice's and offers its `Undo`.

- [ ] **Step 1: Write the failing tests** (`DraftAskTests`, hosted, `asksForDayDrafts: true`, the clock at
  `2026-11-26T12:00:00Z`, today's page `day:2026-11-26` with no draft unless a test says so):
  - `it_asks_once_when_todays_page_is_shown` (`draftDates == ["2026-11-26"]`; three more states: still one).
  - `it_does_not_ask_offline_signed_out_on_another_day_or_with_a_draft_that_stands` (a failed draft, all open: no
    ask; an unsettled recipe-4 draft: no ask; a settled recipe-4 draft: one ask; yesterday shown: no ask).
  - `coming_online_with_today_shown_asks` (offline at first; then online: one ask).
  - `a_failed_ask_is_asked_again_once_when_he_comes_back` (fail; `cameBackToToday`: a second ask; fail; again: none;
    `retryDraft`: a third).
  - `an_ask_with_no_answer_in_sixty_seconds_is_lost` (the draft reply held; the model's sleep released at 60 s:
    `draftAsk` is not in flight; `cameBackToToday` asks again; the late first answer does not change the second ask).
  - `remake_failed_counts_as_a_failed_ask`; `not_found_counts_as_a_failed_ask`.
  - `set_draft_null_loads_the_workspace` (a workspace load follows the reply; no command sent).
  - `set_draft_is_sent_as_its_own_write_with_no_notice` (the action sent equals `JSON.parse(setDraft)`; nothing in the
    outbox; `notice.shown` nil).
  - `a_send_that_fails_is_tried_once_more` (offline once, then applied: done, one draft line state `ready`).
  - `already_drafted_is_success`; `another_refusal_or_a_400_is_a_failed_ask` (`refused("bad-request")`: failed, one send).
  - `set_draft_waits_while_the_undo_slot_is_held` (Review Focus 3): a row action's notice offers `Undo`; the reply
    arrives: nothing sent; the notice times out (the notice's sleep released): sent. Again with VoiceOver running (the
    notice has no timer): sent only when it is swiped away.
  - `a_skips_notice_does_not_hold_set_draft` (the notice `Skipped` with its Undo: sent at once; Task 10 makes the
    notice; here a `Notice` of kind `.done` whose `noticeOf` does not use the slot stands in).
  - `the_answer_of_another_owner_is_dropped` (Review Focus 4; reply owner `someone`: nothing sent).
  - `an_account_change_while_set_draft_waits_sends_nothing` (the slot held, a load under another owner, released:
    nothing sent).
  - `midnight_during_an_ask_asks_for_the_new_today` (the first ask held; the clock past midnight and `checkToday`; the
    new today's page drawn: an ask for `2026-11-27`).
  - `a_rebuilt_screen_does_not_ask_again` (a second `DayViewController` on the same model: one ask).
  - `the_page_never_waits` (the ask held: a keystroke's save and a tick are sent and answered).
- [ ] **Step 2:** The app unit test command with `-only-testing:DaythreadTests/DraftAskTests`. Expected: fail. Commit
  `test(native): when the app asks for the day's draft, and what it does with the answer (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The app's unit tests in full (no earlier test meets an ask); the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): ask for today's draft, at most twice by itself, holding set-draft back while
  an Undo is offered`.

### Task 9: UI: the draft's line in the strip

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/DayFactsView.swift` (`DayFactsModel`, a `DraftLineView`),
  `…/DaythreadUI/DayViewController.swift` (`showDay`, `updateFacts`, the line's taps), `docs/design/native-system.md`
- Test: `native/Tests/DraftLineViewTests.swift`

**Interfaces:**
- Consumes: Task 3 (`DraftView`, `DraftLine`), Task 6, Task 8.
- Produces:

```swift
extension DayFactsModel {
  /// Set only through `show(line:)`; nil: no line.
  private(set) var line: DraftLine?
  @discardableResult func show(line: DraftLine?) -> Bool
  var onApplyAll: (() -> Void)?
  var onDismiss: (() -> Void)?
  var onRetry: (() -> Void)?
  /// What the line's buttons call, also from tests; each reports only while `enabled`.
  func applyAllTapped()
  func dismissTapped()
  func retryTapped()
  /// Nothing to draw: no facts and no line.
  var isEmpty: Bool { get }
}
// New members of `DayViewController`, internal, read by tests:
//   private(set) var draftView: DraftView?   // today's, worked out in `showDay`
//   private(set) var draftReads = 0          // how many times `DraftView.of` ran
```

  **The line** is the strip's first row, above the events line: `.preparing` is a `ProgressView()` (the system's small
  one) and `DraftLine.preparingText`; `.segments` is the count's words, then `Apply all` (a plain `Button`, the accent
  colour) and `Dismiss` (a plain `Button`, the secondary colour), then `DraftLine.failedText` and `Retry` (quiet), or
  `Offline`; words in the secondary colour at the strip's text style. Each button is at least 44 points tall; from the
  accessibility text sizes the buttons go under the words (`ViewThatFits`). VoiceOver: the words one element
  (`DraftLine.spoken`), each button its own. `.held` is drawn as `readyText` and `show` (no caller in 1d.2a). The strip
  hides when `isEmpty`.

  **The screen**: on today with a live page, `showDay` works out `draftView = DraftView.of(page:in: drawnWith, index:
  todoIndex(of: drawnWith))` (counting `draftReads`) and the line from `DraftLine.state(view:ask: model.draftAsk(of:),
  offline: model.state.offline, at: now)` and `DraftLine.of(_:shown: draftView?.suggestions.count ?? 0, held: false)`;
  on any other day, and with no workspace, both are nil. A change of `model.draftAsk(of:)` alone redraws the line
  (observed as `followUndo` observes). `onRetry` calls `model.retryDraft(page)`; `onApplyAll` and `onDismiss` are Task
  10's.

- [ ] **Step 1: Write the failing tests** (`DraftLineViewTests`, hosted, `asksForDayDrafts: true`):
  - `no_line_with_no_draft_and_no_ask` (the ask not yet made: `line == nil`; the strip hidden on a page with no facts).
  - `preparing_while_the_ask_is_out` (the reply held: `.preparing`; the view holds a progress view and `Preparing…`).
  - `the_count_and_its_buttons` (a stored ready draft with three suggestions shown: `.segments(count: "3 suggestions",
    failed: false, offline: false)`; one: `1 suggestion`; `Apply all` and `Dismiss` exist, each at least 44 points
    tall).
  - `couldnt_draft_after_a_failed_ask_with_nothing_stored` (`Couldn’t draft`, `Retry`); `retry_asks_again` (a second
    `draftDates` entry; `Preparing…` while it runs).
  - `a_stored_failed_draft_says_so_beside_its_suggestions` (two suggestions: both segments); after one is skipped (a
    load with the item skipped): only the count.
  - `offline_with_nothing_stored_says_offline`; `offline_with_a_stored_draft_shows_its_line`.
  - `a_stale_drafts_suggestions_stay_while_it_is_asked_again` (a settled recipe-4 draft with one open suggestion: the
    ask goes, the reply held: the line reads `1 suggestion`, not `Preparing…`, and the suggestion stays).
  - `a_ready_draft_with_nothing_open_has_no_line`.
  - `no_line_on_another_day_or_on_today_in_trash`.
  - `an_account_change_empties_the_line`.
  - `the_line_is_not_worked_out_on_a_keystroke` (typing leaves `draftReads` as it was).
  - `the_line_being_typed_stays_when_the_line_appears` (the caret in a line, the draft's state arrives: the line's frame
    in the window unchanged, the keyboard up).
  - `at_the_largest_text_size_the_buttons_go_under_the_words` (`accessibilityExtraExtraExtraLarge`: `Apply all`'s top
    is below the count's bottom).
  - `voiceover_reads_the_line_and_each_button` (`3 suggestions` one element; `Apply all`, `Dismiss` buttons).
- [ ] **Step 2:** The app unit test command with `-only-testing:DaythreadTests/DraftLineViewTests`. Expected: fail.
  Commit `test(native): the draft's line under today's title (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md`: the line and its states (`Preparing…` with the system's small
  progress view; `3 suggestions`, `1 suggestion`; `Apply all` in the accent colour, `Dismiss`; `Couldn’t draft` in the
  secondary colour (the web's is a warning colour: recorded), `Retry`; `Offline`), its place as the strip's first row,
  and its VoiceOver words.
- [ ] **Step 4:** The app's unit tests in full (the strip's earlier tests unchanged); the Mac Catalyst build. Expected:
  pass.
- [ ] **Step 5: Commit** `feat(native): the draft's line: preparing, suggestions, couldn't draft, offline`.

### Task 10: UI: applying and skipping, their notices and Undo

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel+DayDraft.swift` (`decide`, `reopen`),
  `…/DaythreadUI/AppModel.swift` (`undo`'s refusal words), `…/DaythreadUI/DayViewController.swift` (`ActionOrigin`,
  `Acted`, `say`, `undo`, the draft's taps), `…/DaythreadUI/NoticeView.swift` (`Notice.Kind.skipped`),
  `docs/design/native-system.md`
- Test: `native/Tests/DraftDecisionTests.swift`

**Interfaces:**
- Consumes: Task 4 (`Command.applyDraft`, `skipDraft`, `reopenDraft`, `DraftTicket`, `DraftNotice`, `DraftDecision`),
  Task 7's `still` shape, Task 8, Task 9 (`draftView`, the line's callbacks).
- Produces:

```swift
/// What a draft's decision came to.
public enum DraftActed: Sendable, Equatable {
  case applied(text: String, operationId: String)
  case skipped(text: String, ticket: DraftTicket)
  /// The server's `Nothing to apply` / `Nothing to skip`, or none of the asked still shown: `DraftNotice.notApplied`
  /// / `.notSkipped`.
  case refused(text: String)
  /// Offline, failed, not sent, another account: `Not done · your text is kept`.
  case notDone
}

extension AppModel {
  /// §13.8: hands his words over, asks `stillShown` which of `itemIds` are still shown (none: `.refused`, nothing
  /// sent), then sends `apply-draft` (with `today`) or `skip-draft` for those, not overtaking `page`, and waits for the
  /// state holding the answer under `owner`. A skip's ticket is read from that state.
  public func decide(_ decision: DraftDecision, itemIds: [String], page: (id: String, date: LocalDate), owner: String,
    stillShown: @MainActor () -> [String]) async -> DraftActed
  /// A skip's Undo: `reopen-draft`, not overtaking the page, waited for. `Undone`; refused: `DraftNotice.cantUndo`;
  /// otherwise `Couldn't undo · your text is kept`.
  func reopen(_ ticket: DraftTicket, pageId: String, owner: String) async -> Notice
  /// As before; `refused` is the words of a refusal (`RowNotice.cantUndo` for a row's or the strip's,
  /// `DraftNotice.cantUndo` for an apply's).
  func undo(_ operationId: String, pageId: String?, owner: String, refused: String) async -> Notice
}

extension DayViewController {
  enum ActionOrigin: Equatable {
    case row(String)
    case strip(taskId: String)
    /// A suggestion's button: its item's id.
    case suggestion(String)
    /// `Apply all` or `Dismiss`.
    case draftLine
  }
  enum SuggestionAction: Equatable { case apply, skip }
  /// A suggestion's `checkmark` or `xmark` (Task 12 wires the list's guest rows to it; tests call it).
  func suggestionTapped(_ itemId: String, _ action: SuggestionAction)
}
// `Acted` gains `undo: UndoOf` (`.server(operationId)` or `.reopen(DraftTicket)`); `followUndo` follows only
// `.server`; `holdsUndoSlot` (Task 8) is true only for `.server`. `Notice.Kind` gains `.skipped`: 10 seconds.
```

  **On today's screen only**, nothing while an action is out or something is presented: the ids are `draftView`'s
  (one, or every suggestion shown for `Apply all` and `Dismiss`); `document.commitComposition()`; `actionOut` set; the
  old notice's Undo withdrawn; then `model.decide(…, stillShown:)`, where `stillShown` works `DraftView.of` out again
  from `model.workspace` drawn with his words (as `isListedAside` draws them) and keeps the asked ids still among its
  suggestions. The answer is said only while the screen still shows that today under that owner: `.applied` as
  `Notice(text:, kind: .done, undoing:)` with `Undo` while `model.offersUndo`; `.skipped` as `Notice(text:, kind:
  .skipped, undoing: ticket.skippedBy)` with `Undo` always; `.refused` and `.notDone` as `.failed` notices with no
  `Undo`. An apply's `Undo` sends `undo` with `refused: DraftNotice.cantUndo`; a skip's sends `model.reopen`. While a
  decision is out, `factsModel.enabled` is false (the line's buttons, the strip's controls), `pausesRowActions` holds the
  rows' swipes, and every suggestion's buttons are held (Task 12 draws them held).

- [ ] **Step 1: Write the failing tests** (`DraftDecisionTests`, hosted, the test server whose replies the test
  releases; today `2026-11-26`; a stored ready draft on today's template page with four suggestions: `i1` carried
  `Book the flights` (fill, on the empty to-do slot), `i2` carried `Call the dentist` (after that slot; planned
  `2026-11-25`), `i3` a new to-do `Renew the passport`, `i4` a bullet `Pack the charger`):
  - `apply_waits_for_his_words_then_sends_apply_draft_with_that_item`: type in a line, `suggestionTapped("i2",
    .apply)`: the server gets the save, then exactly `{"type":"apply-draft","pageId":"day:2026-11-26","itemIds":["i2"],
    "today":"2026-11-26"}`; the notice `Applied` with `Undo`, of kind `.done`.
  - `apply_all_sends_every_suggestion_shown_and_says_the_servers_count` (`itemIds` `["i1","i2","i3","i4"]`; a receipt
    `Applied 3`: the notice `Applied 3`; the one left is still in `draftView` when its state shows it).
  - `skip_sends_skip_draft_and_offers_undo_for_ten_seconds` (`{"type":"skip-draft",…,"itemIds":["i2"]}`; `Skipped`,
    `Undo`, kind `.skipped`; the notice's sleep asked for 10 s).
  - `dismiss_skips_every_suggestion_shown` (`Skipped 4`).
  - `undo_of_an_apply_sends_undo_and_says_undone` (`{"type":"undo","targetOperationId":<the apply's>}`; `Undone`).
  - `a_refused_undo_of_an_apply_says_cant_undo_edited_since` (`Can't undo · edited since`).
  - `undo_of_a_skip_sends_reopen_draft_with_what_it_saw` (`Dismiss`, then `Undo`: `{"type":"reopen-draft","pageId":
    "day:2026-11-26","itemIds":["i1","i2","i3","i4"],"skippedBy":<the skip's>,"seen":{"i1":null,"i2":"2026-11-25"}}`;
    `Undone`).
  - `a_skips_undo_stays_when_the_slot_moves_and_an_applys_does_not` (after a skip, he types: the `Undo` stays; after an
    apply, he types: it leaves).
  - `a_refused_reopen_says_cant_undo_edited_since`.
  - `nothing_to_apply_says_not_applied_changed_elsewhere` and `nothing_to_skip_says_not_skipped_changed_elsewhere`
    (Review Focus 2; the server's refusals; no `Undo`; the suggestions as they were).
  - `a_suggestion_gone_after_his_words_were_handed_over_sends_nothing` (Review Focus 2; the save held, `i2` tapped, a
    load in which `Call the dentist` is done; released: no `apply-draft`; `Not applied · changed elsewhere`).
  - `apply_all_names_only_the_suggestions_still_shown` (the same, with `Apply all`: `itemIds` without `i2`).
  - `offline_says_not_done` (`Not done · your text is kept`; no `Undo`; enabled again).
  - `one_action_at_a_time` (an apply out: `factsModel.enabled` false, `suggestionTapped` and `applyAllTapped` send
    nothing, a row's swipe action sends nothing, `bringBack` sends nothing; typing and ticking go on).
  - `after_an_apply_set_draft_waits_for_its_undo` (Review Focus 3; a `Retry` answer arriving while `Applied`
    offers `Undo`: sent only after the notice times out).
  - `the_line_counts_what_is_left` (after `i2`'s state: `3 suggestions`).
  - `an_applied_carried_to_do_is_an_ordinary_row_with_its_marks` (`Book the flights` made `2026-11-12` and planned on
    no day: after the apply's state, the filled slot is a row of the page whose marks read `Since Nov 12`; an apply is
    not a choice, so the clock runs from the day it was made).
  - `an_account_change_while_apply_waits_shows_nothing`.
  - `leaving_today_while_apply_is_out_says_nothing_there`.
- [ ] **Step 2:** The app unit test command with `-only-testing:DaythreadTests/DraftDecisionTests`. Expected: fail.
  Commit `test(native): apply, skip, apply all and dismiss, with their notices and Undo (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md`: the notices `Applied` / `Applied N` and `Skipped` / `Skipped N`
  with `Undo` (`Skipped` stays 10 seconds; its Undo does not use the server's slot), `Not applied · changed elsewhere`,
  `Not skipped · changed elsewhere`, `Can't undo · edited since` (and that a row's keeps `Can't undo · changed since`).
- [ ] **Step 4:** The app's unit tests in full; the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): apply and skip the draft's suggestions, all or one, with their notices and
  Undo`.

### Task 11: Editor: guest rows

Built from the spike's findings (`.superpowers/sdd/native-phase-1d2a/spike-report.md`; its code on the never-merged
branch `spike/native-1d2-guest-rows`, worktree `agent-a657377556df7dd9a`: read `GuestRow.swift`,
`DocumentViewController.swift` and `GuestRowsSpikeTests.swift` there for the shapes and the test technique, among it
the presentation-layer sampling of Q3). Nothing of the spike is copied: this task builds it, tests first, without the
spike's knobs (`keepingTheLine`, `spikeGuestMarkOnFirstLine`, `restructures`).

**Files:**
- Create: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/GuestRow.swift` (`GuestRow`, the internal
  `ListItem`), `…/DaythreadEditor/Cells/GuestRowCell.swift`
- Modify: `…/DaythreadEditor/DocumentViewController.swift` (the data source's item type, `draw`, `edit`, `replace`,
  `show`, `setGuestRows`, `actingRow`, `scroll(toRow:)`, `headerDidChange`, `place(caretIn:)`, `cell(for:)`, the swipe
  provider, `takesTapUnderTheLastLine`, the guest cell's registration), `…/DaythreadEditor/BlockRows.swift`
  (`lastRowID(ofBlock:in:)` only)
- Test: `native/Packages/DaythreadEditor/Tests/DaythreadEditorTests/GuestRowTests.swift` (in the `OnScreen` suite)

**Interfaces:**
- Consumes: Task 6's `index:` parameters.
- Produces:

```swift
/// A row of the page's list that is not a line of the page's document: the caret never enters it, it is not saved,
/// selected, copied, dragged or counted as a line. The host says where it goes and what it shows; the list knows
/// nothing of what it stands for and reports which of its actions was used.
public struct GuestRow: Hashable, Sendable {
  public enum Kind: Hashable, Sendable { case todo, bullet, line }
  public enum Place: Hashable, Sendable {
    /// After the line (a row of the list) of that id; nil: before the page's first line.
    case after(lineID: String?)
    // 1d.2b adds `case replacing(lineID: String)`; nothing here may assume `after` is the only case forever.
  }
  /// A trailing button: a system symbol, its label (`Apply Buy milk`, for Voice Control and Full Keyboard Access),
  /// and the name of the row's custom action for VoiceOver (`Apply`). 1d.3 adds a menu, and a tap on the row.
  public struct Action: Hashable, Sendable {
    public let id: String
    public let symbol: String
    public let label: String
    public let spokenName: String
    public init(id: String, symbol: String, label: String, spokenName: String)
  }
  public let id: String
  public let place: Place
  public let kind: Kind
  /// The column it is drawn in, as a line's depth.
  public let depth: Int
  public let words: String
  /// The small text under the words (`Thu 11/19`); "" for none.
  public let detail: String
  /// The small text as VoiceOver reads it; nil: as shown.
  public let spokenDetail: String?
  /// What VoiceOver calls this kind of row, read before its words (`Suggestion`). The host's word: the list has
  /// none of its own for a guest.
  public let spokenKind: String
  public let actions: [Action]
  public init(id: String, place: Place, kind: Kind, depth: Int = 0, words: String, detail: String,
    spokenDetail: String? = nil, spokenKind: String, actions: [Action])
}

/// Internal: an item of the list, a line (a row of `BlockRows`) or a guest; a guest's id is never read as a line's.
enum ListItem: Hashable, Sendable { case line(String), guest(String) }

extension DocumentViewController {
  /// As Task 6's, and `guests`: nil keeps the guests shown (the day screen calls these on every state), [] removes
  /// them. The page and its guests in one call, so a guest can leave in the update that brings the row it became.
  public func show(page: Page, in workspace: Workspace, index: TodoIndex? = nil, guests: [GuestRow]? = nil)
  public func edit(page: Page, in workspace: Workspace, index: TodoIndex? = nil, afresh: Bool = false,
    guests: [GuestRow]? = nil)
  public func replace(document: String, in workspace: Workspace, index: TodoIndex? = nil, guests: [GuestRow]? = nil)
  /// Only the guests changed; the page's lines are not touched.
  public func setGuestRows(_ guests: [GuestRow])
  /// Which action of which guest he used, by its button or its custom action.
  public var onGuestAction: ((_ guestID: String, _ actionID: String) -> Void)?
  /// As before, and a guest's id dims that guest; while it is set, every guest's actions report nothing.
  public var actingRow: String?
  /// The list's items in order (tests read it).
  var orderedItems: [ListItem] { get }
}

extension BlockRows {
  /// The row id (as the list names rows, `#2` for a repeated id) of the last row of the top-level block `blockID` and
  /// everything nested under it; nil when `blocks` has no such top-level block. What a host passes as `after(lineID:)`
  /// for "after the block".
  public static func lastRowID(ofBlock blockID: String, in blocks: [Block]) -> String?
}
```

  **The items.** `orderedIDs` stays the page's lines only, so `typed(in:caret:)`, `restructure`,
  `caret(afterLeaving:)`, `row(after:going:)` and the pinned row's "above" logic do not change; `orderedItems` holds
  the list's items: the lines in order, each guest after its line (several on one line in the order given; `nil`
  before the first line); a guest whose line is not in the list is not drawn (Question 11). **A keystroke never
  compares the list's items**: the typing comparison stays on the lines' ids. `draw` builds the items from the rows
  and the guests, reconfigures only changed rows and changed guests (never the pinned row), and touches no item not
  listed both before and after.

  **Keeping the typed line** (the spike's measured result: 0.00 points, against 138 to 140 for every animated
  variant): when guests come, go or change while a line holds the keyboard, the change is applied without animation
  and the list's offset corrected in the same turn by as much as that line moved, clamped as `revealCaret` clamps it
  (as `headerDidChange` does); otherwise it animates as the list's other changes do. In a `replace` whose merge also
  takes the typed line away (the `leaving` and `rebuilt` paths) the line's place is not kept; the caret's successor is
  a line, never a guest.

  **The cell** (`GuestRowCell`), not the stock list content configuration (at the largest size it flows the words back
  to the margin under the mark): the words in a label pinned to the text guide as `LineBlockCell` pins its text, so they
  keep the column of his row of that kind at every text size, in the secondary label colour, wrapping; `detail` under
  them at footnote size in the secondary colour (as a row's marks line); the mark on the first line as `TodoBlockCell`
  places its circle (`circle.dashed` for a to-do; a small dashed dot for a bullet, drawn where a bullet has its dot;
  none for a line); no background, no box. The buttons, one per action, plain, each a 44-by-44-point target whose
  symbol is not clipped, the symbol in the secondary colour at the body's text style (quieter than the words): on the
  first line, trailing, at the ordinary sizes; under the words from the accessibility sizes, as `Plan for today` goes
  there. No swipe, no context menu, no drag. For VoiceOver the cell is one element labelled `<spokenKind>, <words>,
  <spokenDetail ?? detail>` (`<spokenKind>, <words>` when both are empty), its custom actions the actions'
  `spokenName`s, each reporting through `onGuestAction` as its button does; the buttons' own labels stay for Voice
  Control and Full Keyboard Access. (The word `Suggestion` comes from the host in `spokenKind`: the list knows
  nothing of drafts, §13.5.)

  **A tap under the last line** with a guest last: as now, the caret goes to the end of the last line. When the page
  ends with a divider and a guest follows it, the paragraph made there lands after the guest: accepted, and recorded
  in the parity table (Task 14).

- [ ] **Step 1: Write the failing tests** (`GuestRowTests`, on screen, 390 × 844, as the spike's suite builds its
  screen; a page `h1` heading `TODO`, `t1` a to-do with `n1` nested under it, `t2` an empty to-do, `b1` a bullet,
  `h2` heading `Notes`, `p1`…`p40` lines; guests with actions `apply` (`checkmark`) and `skip` (`xmark`)):
  - `guests_follow_their_lines` (`after(lineID: "n1")`, `after(lineID: nil)`, two on `t2`: `orderedItems` in that
    order; `BlockRows.lastRowID(ofBlock: "t1", in:)` is `n1`; of a block with a repeated id, its `#2` row).
  - `a_guest_whose_line_is_not_in_the_list_is_not_drawn`; `a_guest_with_a_lines_id_is_drawn_as_a_guest`.
  - `a_guest_is_no_line_of_the_page`: setting guests calls `onChange` never and leaves `document` unchanged; arrow down
    from `n1` goes to `t2`; Backspace at the start of `t2` joins it to `n1`; a tap on a guest's words makes no first
    responder; select all and copy hold no guest's words.
  - `nil_keeps_the_guests_and_an_empty_list_removes_them` (`replace(…, guests: nil)` after `setGuestRows`: still
    there; `guests: []`: gone).
  - `typing_with_guests_takes_the_fast_path` (50 keystrokes in `p20` of a 300-line page with three guests, one directly
    above: no restructure, no snapshot apply, no guest cell reconfigured, as without guests).
  - `the_host_is_told_which_action_was_used` (the `checkmark` button: `onGuestAction("g1", "apply")`; the custom
    action `Skip`: `("g1", "skip")`).
  - `voiceover_reads_a_guest_as_one_element_with_its_actions` (with `spokenKind` `Suggestion`: label `Suggestion, Book the flights,
    Thursday 11/19` with `spokenDetail` `Thursday 11/19`; `Suggestion, Pack the charger` with no detail; custom actions `Apply`, `Skip`; the
    buttons' labels `Apply Book the flights`, `Skip Book the flights`). Its place in VoiceOver's order is Task 14's.
  - `the_words_keep_the_column_of_his_rows` at `.large` and `.accessibilityExtraExtraExtraLarge` (a to-do guest's words
    start where `t2`'s text starts, a bullet guest's where `b1`'s does, a line guest's where `p1`'s does, within 1
    point; the spike's failing assertion, made real).
  - `the_mark_is_level_with_the_first_line` (the dashed circle's and the dot's centre within 1 point of the words'
    first line's centre, at both sizes; a line guest has no mark).
  - `the_buttons_are_44_points_and_never_clip_their_symbols` (at both sizes: each button 44 × 44 or more, its symbol's
    frame inside it; on the first line at `.large`, under the words at `.accessibilityExtraExtraExtraLarge`; the
    symbol's point size no larger than the words').
  - `guests_arriving_above_the_typed_line_keep_it_where_it_is` (Review Focus 1): the caret in `p30` of a 60-line page,
    scrolled to show it; three guests set above it: sampled every 1/120 s for 0.6 s, the line's drawn place deviates
    less than 0.5 point; still first responder, the same cell, its selected range unchanged, no keyboard drop.
  - `guests_leaving_above_the_typed_line_keep_it_where_it_is` (the same, removed).
  - `guests_of_very_different_heights_keep_the_typed_line` (guests far off screen above, one of six lines of words and
    one of one, the list's estimates off: the line within 0.5 point).
  - `a_guest_change_while_the_list_decelerates_keeps_the_typed_line` (a fling, then a change: the scroll stops and the
    line is where it was; accepted, as `headerDidChange` does).
  - `without_a_line_typed_in_a_guest_change_animates` (no first responder: the apply is animated).
  - `guests_changing_while_he_composes_keep_his_marked_text` (composing `jin` in `p15`; guests added, one's words
    changed, all removed: his cell never reconfigured, the marked text intact, committing writes the character).
  - `a_page_and_its_guests_in_one_call_swap_a_guest_for_its_row_in_one_update` (`replace(document:` gaining a row after
    `t2` `, guests:` without the guest that was there `)`: one snapshot apply; the new row where the guest was).
  - `a_merge_that_takes_the_typed_line_away_with_guests_changing_leaves_the_caret_on_a_line` (the caret in `p10`; a
    `replace` without `p10` and with a guest after `p9`: no crash; the caret in a line, never in a guest).
  - `the_acting_row_can_be_a_guest` (`actingRow = "g1"`: drawn dimmed; every guest's actions report nothing).
  - `a_guest_has_no_swipe_and_no_menu`.
  - `a_tap_under_the_last_line_with_a_guest_last` (the caret at the end of the last line; with a closing divider last,
    the new paragraph is after the guest).
- [ ] **Step 2:** The editor's `xcodebuild test … -only-testing:DaythreadEditorTests/OnScreen/GuestRowTests` (before it,
  `pgrep -x xcodebuild` empty twice, 15 seconds apart). Expected: fail. Commit `test(native): rows in the list that are
  not lines of the page (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The editor's `swift test` and its whole `xcodebuild test` (every earlier test unchanged), the app's
  unit tests, the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): guest rows in the page's list`.

### Task 12: UI: the suggestions in the page

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/DayViewController.swift` (`showDay`, `edit`, `replaceList`,
  the guests from `draftView`, `onGuestAction`, `actionOut`'s dimming), `docs/design/native-system.md`
- Test: `native/Tests/DraftSuggestionTests.swift`

**Interfaces:**
- Consumes: Tasks 3, 9, 10 and 11 (`GuestRow`, `BlockRows.lastRowID(ofBlock:in:)`, `edit`/`replace` with `guests:`,
  `setGuestRows`, `onGuestAction`).
- Produces:

```swift
extension DraftView.Suggestion {
  /// The guest row it is drawn as on a page of `blocks` (the top-level blocks the list draws): `place`
  /// `.after(lineID: BlockRows.lastRowID(ofBlock: anchorId, in: blocks))`, a fill too in 1d.2a (nil anchor: `after(lineID:
  /// nil)`; an anchor the blocks do not hold: nil, not drawn); `kind` its mark; `depth` 0; `words`; `detail` its
  /// `detail ?? ""`; `spokenDetail` its `spokenDetail`; `spokenKind` `Suggestion`; actions `apply` (`checkmark`, `applyLabel`, `Apply`) and `skip`
  /// (`xmark`, `skipLabel`, `Skip`).
  func guest(on blocks: [Block]) -> GuestRow?
}
```

  `showDay` works the guests out from `draftView` and the blocks the list is handed (his words when they stay, the
  page's otherwise), once per state, and hands them in the same call that hands the list the page (`edit`, `replace`),
  or through `setGuestRows` when the page's words stay and only the guests changed; `[]` on any other day, in Trash,
  with no workspace. `onGuestAction` calls `suggestionTapped(id, actionID == "apply" ? .apply : .skip)`.
  `actionOut = .suggestion(id)` sets `document.actingRow = id`.

- [ ] **Step 1: Write the failing tests** (`DraftSuggestionTests`, hosted; the draft of Task 10's tests, with `i2`'s
  to-do made `2026-11-19` and skipped on `2026-11-21` and `2026-11-22`):
  - `the_suggestions_are_drawn_where_the_view_places_them` (the guests in `orderedItems` are `draftView`'s suggestions,
    each after the last row of its anchor's block; their count is the line's).
  - `a_fill_suggestion_is_drawn_after_its_empty_row` (`i1` after the empty to-do slot; the slot still a row).
  - `a_suggestion_shows_its_age_or_its_skipped_days` (`i1`'s detail is the short label of its to-do's `createdOn`;
    `i3`, a new to-do, has none and is spoken `Suggestion, Renew the passport`; `i2`'s `skipped Sat, Sun`, spoken
    `Suggestion, Call the dentist, skipped Sat 11/21, Sun 11/22`).
  - `no_suggestions_on_another_day_or_on_today_in_trash`.
  - `the_suggestion_leaves_in_the_update_that_brings_its_row` (an apply's state: one list update; the row of `Call the
    dentist` where its guest was).
  - `typing_does_not_read_the_draft` (`draftReads` unchanged by a keystroke; a suggestion's place follows at the next
    state).
  - `a_state_that_brings_suggestions_keeps_the_typed_line_where_it_is` (Review Focus 1; the caret in a line under the
    `Notes` heading: its frame in the window unchanged, the keyboard up).
  - `a_merge_moves_the_suggestions_with_the_page` (a line inserted above the anchor on the server while he types: after
    the merge, the guests follow the anchor).
  - `a_suggestion_whose_anchor_he_deleted_waits_for_the_next_state` (Question 11: the anchor line removed by his typing:
    not drawn; the next state places it at the planning end).
  - `the_tapped_suggestion_is_dimmed_and_every_suggestion_held` (`i2` applying: its guest dimmed; a tap on `i3`'s
    `checkmark` sends nothing).
  - `an_account_change_takes_the_suggestions_away`.
  - `a_suggestion_typed_onto_the_page_leaves` (he types a to-do row of `Call the dentist`'s to-do and the state draws it:
    its guest is gone).
- [ ] **Step 2:** The app unit test command with `-only-testing:DaythreadTests/DraftSuggestionTests`. Expected: fail.
  Commit `test(native): the draft's suggestions as rows in today's page (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md` the suggestion row (the marks, the secondary ink, the age and
  `skipped Sat, Sun`, the two quiet buttons always shown, also with a pointer: recorded, VoiceOver's words and actions).
- [ ] **Step 4:** The app's unit tests in full; the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the draft's suggestions in today's page`.

### Task 13: The cost of the draft

A measurement, not a budget; no red commit.

**Files:**
- Modify: `native/Tests/TypingFeelTests.swift`, `native/README.md` (how to read the numbers),
  `docs/plan/native-phase-1d2a.md` ("Cost, measured")

**Interfaces:**
- Consumes: `TodoIndex`, `DraftView.of` (Tasks 2, 3); the day screen of Task 12.

- [ ] **Step 1:** Add `test_the_draft_view_on_a_large_workspace`: 1d.1's large workspace (3,000 to-dos on 300 day
  pages) with a draft on each of its last 30 day pages (10 items each, every one decided, half of them lines with
  `from`, a third of those of recipe 3), and today's draft with 20 open suggestions (10 carried to-dos, 5 new to-dos,
  5 lines, one of them recipe 3 with no `from`). Five runs, each timing `TodoIndex(workspace)` and then
  `DraftView.of(page:in:index:)`; it prints `TypingFeel: draft index <ms> view <ms>` per run and the medians, and
  asserts only that the view holds 20 suggestions.
- [ ] **Step 2:** The typing fixture (`model(page:)`) gains a draft on the typed page with 10 suggestions anchored
  above the lines typed into, so the two typing tests type with the suggestions on screen; the lines typed into, and
  what the tests assert, are unchanged.
- [ ] **Step 3:** Run `TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test … -only-testing:DaythreadTests/TypingFeelTests`
  (the README's command), nothing else running. Expected: the two typing tests within their budget (10.56 and 4.01 ms);
  the numbers printed. If they are not, stop and report: a guest that costs a keystroke breaks §13.1's anti-goal, and
  the remedy is a design decision.
- [ ] **Step 4:** Write the medians under "Cost, measured" at the end of this plan, with the machine and the date, and
  what a state costs with the draft against 1d.1's figures. Commit `test(native): the cost of the day draft, measured`.

### Task 14: On the simulator, and the record

**Files:**
- Modify: `native/scripts/ui-test.sh` (a fourth server; the today server's empty draft), `native/UITests/Launch.swift`,
  `native/UITests/MorningUITests.swift` (the failed draft's test), `native/README.md`, `docs/plan/native-parity.md`,
  `docs/design/native-system.md`, `docs/plan/native-phase-1d2a.md` (status), `PRODUCT.md`
- Create: `native/UITests/DraftUITests.swift`, `tests/evidence/native-phase-1d2a/*.png`

**The servers** (Question 2):
- The today server (3741): after its seed, a hand-written `set-draft` on today's page `{ status: 'ready', items: [],
  moreOpen: [], allowedTaskIds: [], recipe: 5 }`, so it shows no line and its tests do not move.
- The morning server (3743): nothing added; the app asks, the server (no model) answers a failed draft, and the line
  reads `Couldn’t draft · Retry` above the strip. Every morning test must still pass.
- The draft's server: `draft_port=3744`, started and checked as the others (`start draft $draft_port
  DAYTHREAD_AUTH=off`, `wait_for $draft_port 200`, the port free first), passed as
  `TEST_RUNNER_DAYTHREAD_DRAFT_SERVER_URL`; `--serve` serves it; the header comment names it. Its seed, on the
  server's own commands (`/api/v1/commands`, `/api/v1/saves`):
  - `ensure-day` for today minus 8, minus 4, minus 3 and today. On today minus 8, `add-task` `Call the dentist`,
    `Book the flights` and `Water the ferns` (made then: their age is that day's short label; `Since` that day once
    applied; and a plan row there, before the skips, so both skips count: `skippedDays` starts again after a plan row).
  - On today minus 4 and minus 3: a `set-draft` with one item `s1`, `Water the ferns` (`anchor: ''`, `place: 'after'`,
    `allowedTaskIds` it), then `skip-draft` of `s1` (`skipped <weekday>, <weekday>`).
  - On today: a hand-written `set-draft` (`status: 'ready'`, `recipe: 5`, `moreOpen: []`, `allowedTaskIds` the three
    carried ids), items in this order: `i1` `Book the flights` filling the template's empty to-do slot (drawn after
    it); `i2` `Call the dentist` after that slot; `i3` `Water the ferns` with no anchor; `i4` a new to-do `Renew the
    passport`; `i5` a bullet `Pack the charger`.
  - `DraftUITests` reads its server with `Wrapper.value("DAYTHREAD_DRAFT_SERVER_URL")`. Each test that acts ends with
    its `Undo`, so every test meets the seed as it was.

- [ ] **Step 1: Write the failing UI tests** (expected words computed from `Wrapper.today()` with an `en_US_POSIX`
  formatter in UTC):
  - `test_the_line_and_the_suggestions_show`: the line's element reads `5 suggestions`; `Apply all` and `Dismiss`; the
    suggestion elements in order `Suggestion, Book the flights, <age>`, `Suggestion, Call the dentist, <age>`,
    `Suggestion, Water the ferns, skipped <full>`, `Suggestion, Renew the passport`, `Suggestion, Pack the charger`,
    the first after the template's empty to-do row.
  - `test_apply_then_undo` (`Apply Call the dentist`: `Applied`; a row `Call the dentist` on the page whose marks read
    `Since <today minus 8>`; on the server the item applied; `Undo`: `Undone`, the suggestion back).
  - `test_skip_then_undo` (`Skip Pack the charger`: `Skipped` with `Undo`; `Undo`: `Undone`, back).
  - `test_apply_all_then_undo` (`Applied 5`; `Undo` puts all five back).
  - `test_dismiss_then_undo` (`Skipped 5`; `Undo`: back).
  - `test_the_typed_line_stays_through_an_apply` (the caret at the end of a line under `Notes`; `Apply` on a suggestion
    above it: the line's frame unchanged within 1 point, the keyboard up).
  - `test_voiceover_order_puts_each_suggestion_after_its_line` (the accessibility tree's elements in order: each
    `Suggestion, …` element right after the elements of the last line of its anchor's block, none inside a line's;
    each with the custom actions `Apply` and `Skip`). The spike could read the order only from the cells.
  - `MorningUITests.test_a_failed_draft_says_couldnt_draft_with_retry` (`Couldn’t draft` and `Retry`; `Retry`: the
    line says `Preparing…` or `Couldn’t draft` again, and the strip's parts are still there).
- [ ] **Step 2:** `native/scripts/ui-test.sh -only-testing:DaythreadUITests/DraftUITests` and
  `-only-testing:DaythreadUITests/MorningUITests`. Expected: fail. Commit `test(native): the day draft on the simulator
  (red)`.
- [ ] **Step 3:** Make them pass; a defect found in an earlier task's code is fixed with its own failing unit test
  first. Then `native/scripts/ui-test.sh` in full: every earlier UI test passes; `TypingFeelTests` within its budget.
- [ ] **Step 4:** Screenshots on the seeded data into `tests/evidence/native-phase-1d2a/`: today with the line and the
  suggestions (light, dark, the largest text size, landscape if the simulator turns), `Preparing…` (from a held unit
  test's host, or a slowed seed), `Couldn’t draft · Retry` on the morning server, the notices `Applied` and `Skipped`
  with `Undo`, `Not applied · changed elsewhere`, a suggestion with `skipped Sat, Sun`, VoiceOver's reading of a
  suggestion (the accessibility inspector's), the keyboard up with suggestions above the typed line. Look at each; if a
  line suggestion (no mark, secondary ink, its detail and buttons) cannot be told from his own lines, say so in the
  report.
- [ ] **Step 5:** Update the documents: every string of 1d.2a in `native-system.md` (checked against §13.4 and §13.8);
  `native-parity.md` (each web behaviour of the survey's §1 to §3 as done, left out with its reason, 1d.2b or 1d.3;
  the commands the app now sends, `set-draft` passed through, `apply-draft`, `skip-draft`, `reopen-draft`, each
  `readsBeyond: true`; the route; where the app differs: rewording before applying, the no-model state, the decided
  looks drawn ahead, the one-second struck-through hold, the per-row note after a partial Apply all, the warning
  colour, the buttons hidden until hover, a fill drawn after its slot until 1d.2b, `today` the account's day, a
  paragraph made by a tap under a closing divider landing after a guest that follows it);
  `PRODUCT.md`; the README (the fourth server, the cost numbers); this plan's status. Commit `docs(native): what phase
  1d.2a holds, with screenshots`.

### Task 15: On his data

Nothing in this task is code, and Brian does the tapping: the app writes to his real workspace.

- [ ] A Debug build on the simulator or his phone against production, signed in by him. On his real today in the
  morning, the line and the suggestions against the web's phone layout side by side: the count, each suggestion's
  words, place, age and skipped days; one the web hides is hidden.
- [ ] One `Apply` and its `Undo`, one `Skip` and its `Undo`, each seen on the web after a reload. `Apply all` only if
  he wants today's draft applied.
- [ ] By hand, what no test drives: VoiceOver on the line and a suggestion; the line and suggestions at his text size;
  typing in a line while the draft arrives (his line stays put); his account with no model (`Couldn’t draft · Retry`)
  if that is his, or a second account.
- [ ] The cost line the Debug build logs for his workspace against "Cost, measured". Record the results here and set
  the status line.

## Order and independence

- **Task 1 first, alone, as its own pull request**: the route the app asks and the cases every Core test fails against.
  It touches `src/` and deploys on merge. Tasks 2 to 4 need its fixture files: they start on a branch from Task 1's,
  and merge after it.
- **Tasks 2, 3 and 4 are Core, in order** (each reads the one before, and all three edit `Fixtures.swift`).
- **Task 5 (Sync)** needs nothing of Tasks 2 to 4 or of the web's merge (its fakes stand in for the route): it can be
  built beside them. It edits `native/Tests/TestServer.swift` and `SignInFailureTests.swift`, which nothing else
  touches until Task 8.
- **Task 6 (one index)** needs nothing of Tasks 1 to 5 and can be built beside them; it edits
  `DocumentViewController.swift` and `DayViewController.swift`.
- **Task 7** needs Task 6 (both edit `DayViewController.swift`). **Task 8** needs Tasks 3, 5 and 7. **Task 9** needs 8.
  **Task 10** needs 4 and 9. Tasks 7 to 10 each edit `DayViewController.swift` and `AppModel.swift`, so they run in
  order.
- **Task 11** (the editor only) needs Task 6 (both edit `DocumentViewController.swift`); it touches no file Tasks 7
  to 10 touch, so it can be built beside them. **Task 12** needs 10 and 11.
- **Task 13** needs 12. **Task 14** needs all. **Task 15** is his.
- **Two pull requests**: Task 1 alone, then Tasks 2 to 14.
- Departures from the scope this plan was written from: the draft's notices and commands move on the web too
  (Question 1); a fourth seeded server, and the today server seeded with an empty draft (Question 2); hosted tests ask
  for no draft unless they opt in (Question 3); the shared index and the re-check carried from 1d.1 are Tasks 6 and 7.

## Cost, measured

Measured 2026-11-28 on an Apple M4 Mac (macOS 27.0.1, Xcode 27.2), the iPhone 17 simulator on iOS 26.5, a Debug
build, at the head of Task 13's branch. Each figure is the median of a run's five inner runs, as in 1d.1's section
(`docs/plan/native-phase-1d.md`, "Cost, measured"); the runs are listed. Every run was alone: `pgrep -x xcodebuild`
empty twice, 15 seconds apart, before each, and each log names only this worktree. The four budgeted runs were
`TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test ... -only-testing:DaythreadTests/TypingFeelTests` (the README's
command), back to back as with, without, with, without; "without" is the same fixture with no draft in the workspace
(`TEST_RUNNER_DAYTHREAD_FEEL_DRAFT=off`). All four held their budget.

**The fixtures.** "With a draft" is the typing tests' workspace (3,000 to-dos, the strip of 1d.1) plus a stored draft of
20 decided items on each of the 365 days before today (10 carried to-dos and 10 lines, half of the lines with `from`,
2 of recipe 3), and today's draft of four open suggestions placed above the line typed into: two carried to-dos
anchored on the line above it and two lines (one with `from`) anchored four lines above. The screen asserts it holds the four
suggestions, so each is a guest row on the page while the typing runs. Task 13's brief asked for drafts of 10 items on the last 30 days;
this task was asked for a year of 20 items, the worse case, and that is what was measured. The workspace's 300 pages are
299 past days and today.

**A keystroke** (milliseconds to the list laid out; limits 10.56 on 300 lines and 4.01 on 10), medians per invocation:

| | with suggestions and a year of drafts | without a draft |
|---|---|---|
| 300 lines, line 150 | 9.614, 9.615 (and 10.419 in the unbudgeted full-suite run) | 9.845, 10.548 |
| 10 lines, line 5 | 3.430, 3.406 (3.859 in the full-suite run) | 3.558, 3.417 |

The suggestions do not cost a keystroke: the "with" runs are, if anything, lower than the "without" ones, and the
spread between the two invocations of either is larger than any difference between them. A guest row is a row of the
list like another, and a keystroke reads no draft.

**A state drawn** (milliseconds per keystroke to the engine's state drawn, not budgeted: the wait for the state, then
the list laid out again). While he types ahead of the last state, each engine state is a new workspace with his words
drawn in: its index is built reusing the one before (the stored drafts are not parsed again), the draft view is read
again, and the page's words are parsed once to place the guests.

| | with | without | the draft adds |
|---|---|---|---|
| 300 lines | 177.563, 172.816 | 153.615, 139.594 | about 24 to 38, about 29 on average |
| 10 lines | 84.760, 84.073 | 65.203, 65.453 | about 19 |

(1d.1's figures for the state drawn with the strip were 170 to 175 ms and 89 ms; the 1d.2a base, measured back to back
with this task, is 140 to 154 and 65 here, so the figures of this day are lower than 1d.1's, and the difference to
read is the one between the columns of this table.)

The added time agrees with its parts, measured by `test_what_the_draft_adds_to_a_state` on the same workspaces (five
runs each, medians, four invocations, milliseconds):

| per state | 300 lines | 10 lines |
|---|---|---|
| index reusing the one before, page typed ahead, with a year of drafts | 59.7, 60.8, 58.8, 61.1 | 56.6, 57.0, 57.1, 59.9 |
| the same, no drafts in the workspace | 53.2, 53.2, 54.1, 54.0 | 53.5, 51.4, 53.1, 51.2 |
| the draft view (`DraftView.of`, four suggestions) | 17.3, 17.2, 17.9, 17.8 | 13.9, 13.4, 13.7, 13.1 |
| the guests placed: the view read again, the page's words parsed, four guests | 21.4, 21.3, 21.0, 21.8 | 14.1, 13.5, 13.8, 13.2 |

So a state with the draft costs, over one without, about 6 ms more in the index (a year of draft pages is compared, not
parsed), about 14 to 17 ms for `DraftView.of`, and about 0.3 ms (10 lines) to 4 ms (300 lines) for parsing the page and
placing the guests; the total, 20 to 27 ms, is the measured 19 to 29. `DraftView.of` is the largest part and does not
grow with the page: it reads the other days' drafts for where a line came from, and today's page only for what is
already on it. The screen reads it once for each workspace drawn (`draftReads`); the guests reuse that view.

**The first state of a run** (the index built whole; nothing on the screen has read the workspace). The index with a
year of drafts costs 167 to 170 ms on 3,000 to-dos on 300 pages, against 49 to 51 ms with none (Core's
`DraftCostTests`, three alone runs; 168 to 172 ms against 51 to 56 ms in `test_what_the_draft_adds_to_a_state`; and
`test_the_draft_view_on_a_large_workspace`, with a draft of 20 open suggestions on today's page: 170.4, 169.7, 172.5,
176.6 ms, the view 30 to 32 ms, an index reusing 58 to 61 ms). Through the real screen, the first state of a typing
run drew in, milliseconds:

| first state drawn | with | without |
|---|---|---|
| 300 lines | 691.7, 512.3 (734 in the full-suite run) | 328.5, 350.3 |
| 10 lines | 328.7, 321.1 (343) | 166.0, 167.5 |

so a year of drafts adds about 160 ms to the first state on the 10-line page and 160 to 360 ms on the 300-line page
(one sample a run, and the 300-line figures spread widely: 692 is the first run after a build). That is the index's
extra 115 to 120 ms, the draft view and the guests (about 30 ms), and the rest of a first draw that is itself heavy
here (the whole page's first layout). It happens once a launch, and the state after it is the cheap one above. It does
not reach a keystroke: typing begins after it.

**The remedy if a year of drafts becomes too slow on a first state.** Keeping the parsed drafts across runs (a cache
on disk, or the store holding each draft page already read) is not built. The index spends about 115 to 120 ms of its
170 on 365 drafts, so keeping them would take a first state back towards the cost of one reusing the index before it (about 58 to
61 ms of index in place of 170), the same reuse that makes later states cheap (`TodoIndex(_:reusing:)`). It is a design
decision (what the store holds, and when a kept draft is stale), and the numbers do not call for it today: a first
state of about half a second on the largest page of a year of use is a launch, not a keystroke.

**A reading for the budget.** On this machine today the 300-line median is 9.61 ms with the draft on the page against a
limit of 10.56, a margin of about 9 percent; without the draft the two invocations read 9.85 and 10.55, so on a run
that is noisy the margin can be nil whether a draft is there or not, and the difference the draft makes to it is not
measurable beside that. The 10-line median is 3.41 to 3.43 against 4.01, a margin of about 15 percent. The limits
were not changed. The draft keeps §13.1's anti-goal (a suggestion costs no keystroke); what it costs is in the state
drawn between keystrokes and in a launch's first state. The 300-line limit was set on a lighter fixture (1c's) and has
stood about 10 percent above this Mac's reading since 1d.1; whether to re-base it, on this fixture and this Mac, is
the owner's call, and nothing here asks for it.
