# Native app, phase 1a (Tick, and other days): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the native app a tap on a to-do's circle changes it in the frame it is tapped, survives offline and a
relaunch, and is sent on its own; a change the server holds is shown with a choice; and any day can be opened.

**Architecture:** `DaythreadCore` gains the commands as values and a partial prediction of `task-status`, held to
the server by shared cases. The engine keeps one copy (the server's) and publishes it with the pending outbox
replayed on top; `AppModel` replays its own not-yet-accepted actions over that on the main actor so the tap's frame
is right. Commands that cannot be predicted are sent once and waited for, outside the outbox. Today's screen becomes
a day screen that holds a date.

**Tech Stack:** As phase 0: Swift 6 language mode, UIKit, SwiftData, URLSession, Network (`NWPathMonitor`),
Observation, Swift Testing, XCTest; the fixtures script is TypeScript on the web side. No third-party packages.

**Spec:** `docs/design/native-phase-1.md` §3 to §8 (slice 1a), under `docs/design/native-app.md`. Executors read
the first in full and the second's §5 to §9.

**Status (2026-11-25):** tasks 1 to 10 built and reviewed one by one, then the whole slice reviewed once and its
findings fixed (below, "Decisions made while building"). Seen on the simulator against the seeded local servers
(`tests/evidence/native-phase-1a/`). Task 11, the check on his own data, is Brian's.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes, not how the code is arranged.
- The app holds no TypeScript, no JavaScript engine and no web view. Apple frameworks only.
- Minimum iOS 26 and macOS 26; `// swift-tools-version: 6.2`; Swift 6 language mode with complete concurrency
  checking. Mac Catalyst must keep building.
- `DaythreadCore` imports Foundation only. `DaythreadSync` never imports UIKit.
- The server stays the authority. **This slice changes no server code**: nothing under `src/` is edited. The only
  TypeScript touched is `scripts/export-core-fixtures.ts`.
- Nothing predicted is stored. The store holds the server's copy and the outbox, as now.
- A page's `document` string and every row are kept exactly as the server sent them; a predicted row is compared
  to the server's as JSON text.
- On-screen copy follows the Quiet Copy Rule. Every string is one of those in the spec's §6 and §7, verbatim, and
  is added to `docs/design/native-system.md` in the task that first shows it.
- Use the system component with its default appearance; configure, never restyle (`native-app.md` §9).
- Never start anything on, or point a test at, port 3000, and never read `.daythread-local/`. Simulator: only
  `name=iPhone 17,OS=26.5`.
- Commit messages: `feat(native): …`, `test(native): …`, `docs(native): …`, English only.

## Corrections to the spec made by this plan

Each is now in the spec itself (`docs/design/native-phase-1.md`), added when it was found:

- After the server holds a change, the engine loads the workspace once in that pass. Without it the page showed
  what was last loaded and Keep mine was held again every time. Found by the review of the whole slice.
- A waited command the server says is behind is followed by a load and sent once more; any other refusal is
  followed by a load. Without it "try again" failed the same way on a copy another device had changed.
- The network coming back asks for one load when the last pass ended offline, whether or not anything waits.
- The to-do circle's VoiceOver label (`Complete <words>`), and the labels "Calendar" and "Not saved".

## Review Focus

1. **Two devices.** While a tick waits, a load brings the same to-do changed elsewhere (a new `version`, a new
   title). The circle keeps showing his tap over the new row; when the server holds the tick, the row shows the
   server's state and the held menu names it. Tests in Task 4 and Task 5.
2. **The to-do is gone.** A load removes the to-do a pending tick names: nothing crashes, the prediction changes
   nothing, and the server's "not found" becomes `gone`, with Discard and no Keep mine. Tests in Task 2 and Task 5.
3. **Twenty taps offline.** Twenty ticks on twenty to-dos with no connection: all drawn, all still drawn after a
   new engine opens the same store, sent in the order made, each answer re-deriving the rest. Test in Task 4.
4. **Another account.** Sign out with a held change and sign in as someone else: no held change, pending entry or
   `AppModel` record of the first account is drawn or sent under the second. Tests in Task 6 and Task 8.
5. **Midnight.** The account's day changes while the app is open with a tick waiting: Today moves to the new day,
   the waiting tick keeps the `today` it was made with, and a zone whose day starts at 01:00 (a daylight-saving
   jump over midnight) still gives a start for the day. Tests in Task 3 and Task 9.

---

### Task 1: The shared cases

**Files:**
- Modify: `scripts/export-core-fixtures.ts`
- Create (generated by `npm run fixtures`): `fixtures/core/commands/*.json`, `fixtures/core/day-page/cases.json`,
  `fixtures/core/written-days/cases.json`, `fixtures/core/labels/cases.json`; `fixtures/core/README.md` regenerated

**Interfaces:**
- Produces, for Tasks 2 and 3:
  - `commands/<name>.json`: `{ "before": Workspace, "action": Action, "rows": { "tasks": string[] }, "after": Workspace }`,
    both workspaces as the browser gets them (`forBrowser`). Names: `tick`, `reopen`, `tick-open-again`
    (`status: "open"` on an open to-do), `cancel` (`status: "cancelled"` with `today`), `task-missing` (`rows.tasks`
    empty and `after` equal to `before`: the server refuses it), `tick-repeating` (a to-do with a repeat, ticked
    with `today`; `rows.tasks` names only the ticked to-do, and `after` also holds the next one).
  - `day-page/cases.json`: `[{ "name", "workspace", "date", "live": id | null, "trashed": id | null }]`. Cases: a
    live page; none; only one in Trash; one in Trash and a new live one (`day:<date>:2`); two in Trash (`trashed` is
    the one with the later `trashedAt`).
  - `written-days/cases.json`: `[{ "name", "workspace", "days": string[] }]` with `days` sorted, from `writtenDays`.
    One workspace per rule of `hasContent`, each with a day that counts and one that does not: a to-do row with a
    task id not starting `editor-task:`; a to-do row whose id does start so and has no words (does not count); a file
    block with a URL; a smart note; a line with words; a heading only (does not count); a day in Trash with words
    (does not count); an empty day with a page under it (counts); an empty day whose only child is its draft page
    (does not count).
  - `labels/cases.json`: `[{ "name", "workspace", "action", "label" }]` from `labelFor`
    (`src/components/outbox.ts`): `task-status` to `done`, to `open` and to `cancelled`; a to-do whose title is longer
    than 40 characters; a title with a quote and with Chinese text; `ensure-day`; `restore-batch`.

- [ ] **Step 1:** Add the four areas to the script, each built by running the TypeScript domain (`applyCommand`
  through the existing `harness()`, `writtenDays`, `labelFor`, the domain's own day-page lookup), never by writing
  an expected value by hand. For `commands/`, the script itself asserts, and exits non-zero otherwise: every task
  named in `rows.tasks` differs between `before` and `after`; and, for every case but `tick-repeating`, no other
  task or page does.
- [ ] **Step 2:** `npm run fixtures`, then `npm run fixtures -- --check` (or the script's `--check` form the
  repo uses; see `package.json`). Expected: writes the new files; the check prints nothing and exits 0.
- [ ] **Step 3:** `npm test` and `npm run typecheck` (the repo's names; see `package.json`). Expected: as before
  this task; nothing under `src/` changed.
- [ ] **Step 4: Commit** `test(native): shared cases for a predicted tick, a day's page, written days and labels`.
  This task has no red commit of its own: its files are the expectations that Tasks 2 and 3 fail against.

### Task 2: Core: the commands and the prediction

**Files:**
- Create: `native/Packages/DaythreadCore/Sources/DaythreadCore/Command.swift`, `…/Prediction.swift`
- Modify: `…/Workspace.swift` (`TodoTask`, `Page`)
- Test: `native/Packages/DaythreadCore/Tests/DaythreadCoreTests/CommandTests.swift`, `…/PredictionTests.swift`,
  `…/Fixtures.swift`, and the existing `WorkspaceTests.swift` where `Status` is used

**Interfaces:**
- Consumes: `fixtures/core/commands/*.json` (Task 1).
- Produces:

```swift
extension TodoTask {
  public enum Status: Hashable, Sendable {           // was a String-backed enum of three cases
    case open, done, cancelled, other(String)
    public init(rawValue: String)                   // never fails; an unknown word is .other(word)
    public var rawValue: String
  }
  public var doneOn: LocalDate? { get }
  public var version: Int? { get }
}
extension Page { public var trashId: String? { get } }   // nil when absent, null or not a string

public enum Command {
  /// {"type":"task-status","taskId":…,"status":…,"today":…}; `today` left out when nil.
  public static func taskStatus(taskId: String, status: TodoTask.Status, today: LocalDate?) -> JSONValue
  public static func ensureDay(_ date: LocalDate) -> JSONValue          // {"type":"ensure-day","date":…}
  public static func restoreBatch(trashId: String) -> JSONValue        // {"type":"restore-batch","trashId":…}
  public static func type(of action: JSONValue) -> String?
  /// The to-do a `task-status` names; nil for any other action.
  public static func taskId(of action: JSONValue) -> String?
  /// False for `task-status`; true for every other action, known or not.
  public static func readsBeyond(_ action: JSONValue) -> Bool
}
extension Workspace {
  /// The rows this build can predict for `action`, changed; `self` when it predicts nothing for it.
  public func predicting(_ action: JSONValue) -> Workspace
}
```

- [ ] **Step 1: Write the failing tests.**
  - `PredictionTests.each_shared_case_predicts_exactly_its_rows`: for every file in `commands/`, with
    `predicted = Workspace(before).predicting(action)`: each task named in `rows.tasks` has
    `JSON.write(.object(predicted.task(id).raw))` equal by code units to the same row of `after`; every other task
    and every page equals `before`'s; `predicted.revision == before.revision`.
  - `PredictionTests.an_action_it_does_not_know_changes_nothing`: `ensure-day`, `restore-batch`,
    `{"type":"something-new"}`, a `task-status` with no `taskId`, and `.null` each give back an equal workspace.
  - `PredictionTests.predicting_twice_is_the_same_as_the_server_applying_twice_in_status`: `tick` then `reopen` on
    the same to-do ends `open` with `doneOn` as `reopen`'s `after` has it.
  - `CommandTests`: `JSON.write` of each constructor is the exact text above, keys in that order; `today: nil`
    leaves the key out; `readsBeyond` is false only for `task-status`; `taskId(of:)` reads a `task-status` and is
    nil for the others.
  - `WorkspaceTests.a_status_this_build_does_not_know_is_kept_and_the_workspace_still_reads`: a task with
    `"status":"waiting"` reads as `.other("waiting")`, the workspace reads, and `json()` writes it back unchanged.
    (Replaces any existing expectation that such a workspace is unreadable; say so in the report.)
- [ ] **Step 2:** `cd native/Packages/DaythreadCore && swift test`. Expected: the new tests fail (or do not
  compile for want of the API). Commit `test(native): a tick is predicted as the server applies it; an unknown status is kept (red)`.
- [ ] **Step 3:** Implement. The predicted row is the task's own `raw` with `status`, `doneOn` and `version` set
  in place, so key order and every other field are the server's; the cases decide the details (whether `doneOn`
  is written as `null` or left out, where a new key lands).
- [ ] **Step 4:** `swift test` in `DaythreadCore`, then in `DaythreadSync` and `DaythreadEditor` (they use
  `Status`). Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the commands as values and the prediction of a tick`.

### Task 3: Core: a day's page, written days, dates and labels

**Files:**
- Create: `…/DaythreadCore/Days.swift`, `…/DaythreadCore/ChangeLabel.swift`
- Modify: `…/Workspace.swift` (`dayPage`), `…/LocalDate.swift`
- Test: `…/DaythreadCoreTests/DaysTests.swift`, `…/ChangeLabelTests.swift`, `…/TodayTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: `day-page/`, `written-days/`, `labels/` (Task 1).
- Produces:

```swift
extension LocalDate {
  public func adding(days: Int) -> LocalDate?                  // nil outside years 0000 to 9999
  /// The first instant of this day in `timezone` (an unknown zone reads as GMT, as `today(in:at:)` does).
  public func start(in timezone: String) -> Date
}
extension Workspace {
  public func dayPage(_ date: LocalDate) -> Page?              // corrected: type "daily", that date, not in Trash
  public func trashedDayPage(_ date: LocalDate) -> Page?       // the newest in Trash, by trashedAt
  public func writtenDays() -> Set<LocalDate>
  public var weekStartsOnMonday: Bool { get }                  // top-level "weekStart" == 1
}
public enum ChangeLabel {
  public static func text(for action: JSONValue, in workspace: Workspace) -> String
}
```

- [ ] **Step 1: Write the failing tests.**
  - `DaysTests.a_days_page_is_the_live_daily_page_for_the_date`: every `day-page` case gives `live` and `trashed`.
  - `DaysTests.written_days_are_the_servers`: every `written-days` case; compare sorted values.
  - `DaysTests.a_draft_is_never_a_days_page_or_a_reason_a_day_is_written`: a `type: "draft"` page carrying a
    `date` is not returned by `dayPage`; covered also by the shared case.
  - `TodayTests.adding_days_crosses_months_years_and_leap_days`: `2026-12-31 + 1`, `2028-02-28 + 1`,
    `2026-03-01 - 1`, `+0`, and `9999-12-31 + 1 == nil`.
  - `TodayTests.a_day_starts_at_its_first_instant_in_the_zone`: `Asia/Shanghai` 2026-11-25 is
    `2026-11-24T16:00:00Z`; a day whose midnight does not exist (`America/Havana` 2026-03-08, clocks go 00:00 to
    01:00) starts at the first instant that reads as that date; `today(in:at: date.start(in: zone)) == date` for
    both.
  - `ChangeLabelTests.labels_are_the_webs`: every `labels` case, equal by code units.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): a day's page, written days, day arithmetic and a change's label (red)`.
- [ ] **Step 3:** Implement. `hasContent` and `labelFor` are ports of `src/domain/page-tree.ts` and
  `src/components/outbox.ts` for the actions this slice sends; read them, do not guess.
- [ ] **Step 4:** `swift test` in all three packages (the engine and the editor call `dayPage`). Expected: pass;
  where an existing test relied on `dayPage` finding a page by id alone, fix the test's data, not the rule.
- [ ] **Step 5: Commit** `feat(native): which page is a day's, which days are written, and a change's label`.

### Task 4: Sync: what is drawn, and a change accepted at once

**Files:**
- Modify: `native/Packages/DaythreadSync/Sources/DaythreadSync/SyncEngine.swift`, `SyncEngine+Outbox.swift`,
  `SyncState.swift`
- Test: `native/Packages/DaythreadSync/Tests/DaythreadSyncTests/SyncEngineTests.swift` (or a new
  `SyncEnginePredictionTests.swift` beside it), `FakeTransport.swift`

**Interfaces:**
- Consumes: `Workspace.predicting`, `Command.readsBeyond` (Task 2).
- Produces:

```swift
public struct SyncState {              // changed and added fields only
  /// The server's copy with every pending outbox entry replayed over it, in the order made. Held entries are not.
  public var workspace: Workspace?
  /// The highest ticket `enqueue` has given in this engine's lifetime; 0 before the first.
  public var enqueued: Int
  public var address: String?          // the account's email, once the server has told it on this launch
}
extension SyncEngine {
  /// Stores the entry, publishes a state that draws it, asks for a pass without waiting for it, and returns
  /// the entry's ticket. Throws only when the entry was not stored.
  @discardableResult public func enqueue(action: JSONValue, label: String) async throws -> Int
  /// Returns when no pass is running or asked for. For tests and for sign-out.
  public func settled() async
}
```

  `held` stays an `Int` until Task 5 changes it. The entry's `readsBeyond` sent in the basis is
  `Command.readsBeyond(action)`.

- [ ] **Step 1: Write the failing tests**, with the fake transport able to hold a reply until the test lets it go:
  - `a_tick_is_drawn_before_the_server_is_asked`: after `enqueue` returns, the latest state's workspace has the
    to-do `done`, `enqueued == 1`, and the transport has received no `send` it has answered.
  - `the_servers_answer_replaces_the_prediction`: the reply's row (a different `version` than predicted) is what
    is drawn, and the outbox is empty.
  - `a_tick_made_offline_is_drawn_by_a_new_engine_on_the_same_store`: transport offline; enqueue; a second engine
    on the same store shows the to-do `done` after `start()`, before any transport call succeeds.
  - `twenty_ticks_offline_are_all_drawn_and_sent_in_the_order_made` (Review Focus 3): after the transport comes
    back, the operation ids arrive in order, and after each answer every not-yet-answered to-do is still `done`.
  - `a_load_that_changes_the_same_to_do_keeps_his_tap_on_top` (Review Focus 1): with a tick waiting, a load brings
    the to-do with a new title and `version`; the drawn row has the new title and status `done`.
  - `a_tick_says_it_reads_nothing_beyond_its_row`: the basis sent has `readsBeyond == false`; an `ensure-day`
    entry has `true`.
  - `enqueue_before_a_copy_is_shown_throws_and_gives_no_ticket`: `SyncError.notReady`, `enqueued` unchanged.
  - `the_address_is_published_once_the_server_has_told_it`: after the account check or a sign-in the state has it;
    after sign-out it is nil.
- [ ] **Step 2:** `cd native/Packages/DaythreadSync && swift test`. Expected: fail. Commit
  `test(native): a change is drawn at once, kept through a relaunch, and replaced by the server's answer (red)`.
- [ ] **Step 3:** Implement. The engine's `copy` stays the server's; the published workspace is derived at each
  publish. Existing tests that relied on `enqueue` returning after the pass call `settled()` instead; no existing
  expectation about what the server was sent may change.
- [ ] **Step 4:** `swift test` in `DaythreadSync`. Expected: pass, including every phase 0 test.
- [ ] **Step 5: Commit** `feat(native): the engine draws pending changes over the server's copy`.

### Task 5: Sync: a held change, a waiting one, and a command that is waited for

**Files:**
- Modify: `SyncEngine.swift`, `SyncEngine+Outbox.swift`, `SyncState.swift`, `OutboxEntry.swift`;
  `SwiftDataWorkspaceStore.swift` only if a test below shows a transaction that does not roll back
- Test: `SyncEngineTests.swift` (or `SyncEngineHeldTests.swift`), `WorkspaceStoreContract.swift`

**Interfaces:**
- Consumes: `Command.taskId(of:)`, `Command.type(of:)`, `Workspace.dayPage`, `trashedDayPage` (Tasks 2, 3).
- Produces:

```swift
public struct HeldChange: Sendable, Equatable, Identifiable {
  public enum Reason: Sendable, Equatable { case conflict, changedSince, maybeApplied, gone, refused }
  public let id: Int                   // the entry's stored number
  public let label: String
  public let reason: Reason
  public var canKeep: Bool { get }     // conflict, changedSince, maybeApplied
}
public struct SyncState {
  public var held: [HeldChange]        // was Int
  public var pending: Int              // entries the engine will send
  public var waiting: Int              // pending entries behind a held one for the same to-do
}
public enum Performed: Sendable, Equatable { case applied, offline, signedOut, refused(String) }
extension SyncEngine {
  public func keep(_ id: Int) async          // back to pending on the copy's revision, no own revisions
  public func discard(_ id: Int) async       // removed
  /// Sends `action` once, after everything pending, on the copy's revision, `readsBeyond: true`. Never stored.
  /// On `.applied` the reply's changes are in the published workspace before it returns.
  public func perform(action: JSONValue) async -> Performed
}
```

  A stored reason maps to `Reason` when published: `conflict`, `changed-since`, `maybe-applied` by name; any
  other text by the web's patterns (`/not found|gone|no longer/i` gives `gone`,
  `/changed elsewhere|saved elsewhere/i` gives `conflict`); everything else, `bad-request` included, `refused`.

- [ ] **Step 1: Write the failing tests.**
  - `a_held_tick_shows_the_servers_state_and_is_named`: reply `held(conflict)`; the to-do is drawn as the server
    has it; `held == [HeldChange(label: "ticked \"…\"", reason: .conflict)]`; `pending == 0`.
  - `each_answer_reads_as_its_reason`: parameterised over the three held reasons and three refusal messages
    ("Task not found", "Saved elsewhere", "Something else"), a 400, and a stored reason `bad-request`.
  - `a_later_tick_on_the_same_to_do_waits_and_one_on_another_goes`: with a held tick on A, a tick on A is not sent
    (`waiting == 1`, `pending == 0`) and is drawn; a tick on B is sent.
  - `keep_sends_it_again_on_the_current_revision`: the resent basis has the copy's revision and no own revisions;
    the waiting tick follows it.
  - `discard_removes_it_and_lets_the_waiting_one_go`.
  - `the_to_do_is_deleted_elsewhere` (Review Focus 2): a load removes the to-do while its tick waits; nothing is
    drawn for it; the server's "Task not found" gives `.gone`, `canKeep == false`.
  - `a_held_ensure_day_is_removed_not_shown`: a held `ensure-day` leaves `held` empty and the outbox empty; one
    already stored as held when the engine starts is removed at start; after the next load today's page is asked
    for again if still missing.
  - `todays_page_in_trash_is_not_asked_for_again`: a workspace whose only page for today is in Trash appends no
    `ensure-day`.
  - `perform_sends_once_after_the_queue_and_stores_nothing`: with one tick pending, the transport sees the tick
    then the performed action; `.applied`; the new page is in the workspace when it returns; the outbox is empty.
  - `perform_offline_answers_offline_and_leaves_no_entry`; `perform_refused_gives_the_servers_reason`;
    `perform_while_signed_out_answers_signedOut`.
  - Store contract, run against both stores: `acknowledging_an_entry_that_is_not_there_changes_nothing` (no other
    entry gains the revision), and `a_write_that_names_a_row_the_workspace_lacks_changes_nothing` (or the nearest
    input that makes each multi-step store method fail midway; name the input in the test).
- [ ] **Step 2:** `swift test`. Expected: fail. Commit
  `test(native): a held change is named and resolved, a later one waits, and a waited command is never stored (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` in `DaythreadSync`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): held and waiting changes, keep and discard, and commands that are waited for`.

### Task 6: Sync: trying again, one pass at launch, and signing out with changes

**Files:**
- Create: `native/Packages/DaythreadSync/Sources/DaythreadSync/Reachability.swift`
- Modify: `SyncEngine.swift`, `SyncLog.swift`
- Test: `SyncEngineTests.swift` (or `SyncEngineRetryTests.swift`)

**Interfaces:**
- Produces:

```swift
public protocol Reachability: Sendable { var becameReachable: AsyncStream<Void> { get } }
public struct NetworkReachability: Reachability { public init() }       // NWPathMonitor; yields when a path becomes satisfied
public struct NoReachability: Reachability { public init() }            // never yields; the default in tests
extension SyncEngine {
  public init(transport: any ServerTransport, tokens: any TokenStore, store: any WorkspaceStore,
              reachability: any Reachability = NoReachability(),
              sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
              now: @escaping @Sendable () -> Date = Date.init)
  /// Tries one pass; then, when changes are still unsent (pending, waiting or held) and `discardingUnsent` is
  /// false, signs nobody out and returns how many. Otherwise signs out, erases, and returns 0.
  @discardableResult public func signOut(discardingUnsent: Bool) async -> Int
}
```

  The existing `signOut()` is removed; `AppModel` is updated in Task 8 and until then calls
  `signOut(discardingUnsent: true)` so the package set keeps building.

- [ ] **Step 1: Write the failing tests**, the test owning `sleep` (it records each duration and returns when
  told):
  - `after_a_failed_send_it_tries_again_after_2_5_15_then_30_seconds`: transport offline through four retries;
    the recorded waits are 2, 5, 15, 30, 30 seconds; when the transport answers, no further wait is asked for.
  - `a_429_waits_as_long_as_it_was_told_when_that_is_longer`: `wait(seconds: 60)` gives a 60 s wait.
  - `nothing_to_send_means_no_retry`: an offline load with an empty outbox asks for no wait; so does a state
    whose only pending entry is waiting behind a held one.
  - `the_network_coming_back_sends_at_once`: a `Reachability` the test fires ends the wait early.
  - `signed_out_stops_the_retries`.
  - `a_launch_runs_one_pass`: `start()` with a session and a copy makes exactly one `workspace` call and one
    `account` call.
  - `signing_out_with_changes_not_sent_asks_first` (Review Focus 4): offline with one pending tick,
    `signOut(discardingUnsent: false)` returns 1, the session and outbox are kept; `true` returns 0 and both are
    gone; signing in as another owner then shows no held or pending entry and sends none.
  - `signing_out_online_sends_what_is_pending_first`: the tick is sent before the sign-out call, and the answer
    is 0.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit
  `test(native): unsent changes are retried, sent when the network returns, and never erased without a yes (red)`.
- [ ] **Step 3:** Implement. A launch with no session logs once at the default level, not at error level.
- [ ] **Step 4:** `swift test` in `DaythreadSync`; then
  `xcodebuild build -project native/Daythread.xcodeproj -scheme Daythread -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath native/DerivedData`.
  Expected: tests pass; `BUILD SUCCEEDED`.
- [ ] **Step 5: Commit** `feat(native): retries, the network returning, one pass at launch, and sign-out that asks`.

### Task 7: Editor: the circle is a button

**Files:**
- Modify: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/BlockRow.swift`, `BlockRows.swift`,
  `Cells/TodoBlockCell.swift`, `DocumentViewController.swift`
- Test: `native/Packages/DaythreadEditor/Tests/DaythreadEditorTests/BlockRowsTests.swift`,
  `DocumentViewControllerTests.swift`

**Interfaces:**
- Consumes: `TodoTask.Status` with `.other` (Task 2).
- Produces:

```swift
extension BlockRow.Kind {
  /// `status` nil: the copy does not hold the to-do. `taskId` is the block's `props.taskId`.
  case todo(taskId: String, status: TodoTask.Status?, paused: Bool)     // gains taskId
}
extension BlockRow { public var canBeTicked: Bool { get } }            // a to-do whose status is .open or .done
extension DocumentViewController {
  /// Called on the main actor when a to-do's circle is tapped, with the to-do's id.
  public var onTick: ((_ taskId: String) -> Void)? { get set }
}
```

  The circle is a `UIButton` with a plain configuration and the existing SF Symbols, at least 44 by 44 points,
  disabled when `canBeTicked` is false. Its accessibility label is `Complete <the row's text>`, the web's, and its
  value stays "done", "cancelled" or "not done". The symbol changes with the system's replace transition.

- [ ] **Step 1: Write the failing tests.**
  - `BlockRowsTests.a_to_do_row_carries_its_to_dos_id`; `…a_row_can_be_ticked_only_when_open_or_done` (open, done:
    yes; cancelled, `.other("waiting")`, a to-do the workspace lacks: no).
  - `DocumentViewControllerTests.tapping_the_circle_reports_the_to_do`: `sendActions(for: .primaryActionTriggered)`
    on the cell's button calls `onTick` once with the id.
  - `…a_circle_that_cannot_be_ticked_is_disabled_and_reports_nothing`.
  - `…showing_the_ticked_workspace_in_the_same_turn_draws_it_done`: inside the `onTick` closure the test calls
    `show(page:in:)` with `workspace.predicting(Command.taskStatus(…done…))`; immediately after `sendActions`
    returns and `layoutIfNeeded()`, the cell's image is the done symbol and its accessibility value is "done".
    This is the "frame of the tap" budget.
  - `…the_button_is_at_least_44_points_square`.
- [ ] **Step 2:** `xcodebuild test -scheme DaythreadEditor -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5'`
  from `native/Packages/DaythreadEditor` (as `native.yml` runs it). Expected: fail. Commit
  `test(native): a to-do's circle is a button that reports its to-do and is drawn in the turn it is tapped (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` and the `xcodebuild test` above. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the circle on a to-do row is a button`.

### Task 8: UI: the model's own record, and what a change looks like

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift`, `TodayViewController.swift`,
  `native/App/AppDelegate.swift`, `docs/design/native-system.md`
- Create: `…/DaythreadUI/HeldMenu.swift`, `…/DaythreadUI/StatusLine.swift`
- Test: `native/Tests/TickTests.swift`, `native/Tests/HeldMenuTests.swift`, `native/Tests/StatusLineTests.swift`,
  `native/Tests/ScreenDecisionTests.swift`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6, 7.
- Produces:

```swift
extension AppModel {
  public init(engine: SyncEngine, keepsChanges: Bool = true, now: @escaping () -> Date = Date.init)
  /// What screens draw: the engine's workspace with this model's not-yet-accepted actions replayed over it.
  public var workspace: Workspace? { get }
  public var today: LocalDate { get }               // the account's day; Task 9 makes it move at midnight
  /// Works out the status from what is drawn, records the action, and hands it to the engine.
  /// Returns false when nothing was done: the to-do cannot be ticked, or the same to-do was tapped under 500 ms ago.
  @discardableResult public func tick(taskId: String) -> Bool
  public func keep(_ id: Int) async
  public func discard(_ id: Int) async
  public func perform(_ action: JSONValue) async -> Performed
  public enum SignOutAnswer: Equatable { case signedOut, unsent(Int) }
  public func signOut(discardingUnsent: Bool) async -> SignOutAnswer
}
enum HeldMenu {
  struct Section: Equatable { let id: Int; let title: String; let canKeep: Bool }
  static func sections(_ held: [HeldChange]) -> [Section]
  static func waitingLine(_ waiting: Int) -> String?
}
enum StatusLine { static func text(state: SyncState, keepsChanges: Bool) -> String? }
```

  `StatusLine` order: not kept, then offline, then could not update. The strings are the spec's §7, verbatim.
  `AppDelegate` passes `keepsChanges: false` when the store fell back to memory, and gives the engine
  `NetworkReachability()`.

- [ ] **Step 1: Write the failing tests** (hosted in the app, with a `ServerTransport` defined in the test target
  whose replies the test releases):
  - `TickTests.the_drawn_workspace_has_the_tick_when_tick_returns`: synchronously after `tick`, with the engine
    not yet run, `model.workspace` has the to-do `done`.
  - `…it_stays_ticked_through_the_engines_acceptance_and_the_servers_answer`: sampled at each published state,
    the to-do is never `open` between the tap and the end.
  - `…a_tap_on_a_done_to_do_reopens_it`, `…a_cancelled_to_do_is_not_ticked`, `…a_to_do_the_copy_lacks_is_not_ticked`.
  - `…a_second_tap_within_half_a_second_is_dropped_and_a_later_one_is_not` (the test owns `now`).
  - `…a_change_the_engine_could_not_store_goes_back_to_what_the_copy_has`.
  - `…signing_out_drops_every_record` (Review Focus 4): a tick recorded while the engine is blocked, then sign-out
    with discard and a sign-in as another account, draws nothing of it.
  - `…the_tick_is_dated_the_accounts_day`: the action handed to the engine has `today == model.today`.
  - `HeldMenuTests.each_reason_reads_as_the_webs_sentence`: the five titles of the spec's §7, with a label
    containing quotes; `canKeep` true for conflict, changed since and maybe applied only;
    `waitingLine(1) == "1 later change waiting"`, `(2) == "2 later changes waiting"`, `(0) == nil`.
  - `StatusLineTests`: offline with 0, 1 and 2 pending; could not update; not kept wins over both; nothing.
  - `ScreenDecisionTests`: the account menu's rows no longer need a sign-in on this launch to show the address.
- [ ] **Step 2:** `xcodebuild test -project native/Daythread.xcodeproj -scheme Daythread -only-testing:DaythreadTests -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath native/DerivedData`.
  Expected: fail. Commit `test(native): the tap's frame, the held menu's sentences and the status line (red)`.
- [ ] **Step 3:** Implement. On the screen: the tick plays a light impact haptic and updates the page in the same
  turn; the held button (`exclamationmark.triangle`, the system's red, accessibility label "Not saved") appears
  while `held` is not empty, with one menu section per change and the waiting line last; the sign-out row asks with
  a system alert when the answer is `.unsent`; the account menu is built when opened.
- [ ] **Step 4:** The command of Step 2, then the Mac Catalyst build from `native/README.md`. Expected: pass;
  `BUILD SUCCEEDED`.
- [ ] **Step 5: Commit** `feat(native): a tick in the frame it is tapped, held changes with a choice, and sign-out that asks`.

### Task 9: UI: other days

**Files:**
- Create: `…/DaythreadUI/DayViewController.swift` (from `TodayViewController.swift`, which is removed),
  `…/DaythreadUI/DayContent.swift`, `…/DaythreadUI/DayClock.swift`, `…/DaythreadUI/DayPickerViewController.swift`
- Modify: `RootViewController.swift`, `AppModel.swift`, `docs/design/native-system.md`
- Test: `native/Tests/DayContentTests.swift`, `native/Tests/DayClockTests.swift`, `native/Tests/DayNavigationTests.swift`

**Interfaces:**
- Consumes: Tasks 3, 5 (`perform`), 8.
- Produces:

```swift
enum DayContent: Equatable {
  case page(Page)
  case askingForToday                      // today, no page, none in Trash: the engine is asking
  case noPage                              // a past day
  case notYet                              // a future day
  case inTrash(Page)
  static func content(for date: LocalDate, today: LocalDate, in workspace: Workspace) -> DayContent
}
enum DayClock {
  /// The first instant after `now` at which the account's day is another day.
  static func nextChange(after now: Date, timezone: String) -> Date
}
struct DayNavigation: Equatable {          // what the bar shows for a date
  let canGoNext: Bool                      // false from today on
  let showsToday: Bool                     // false on today
  static func bar(for date: LocalDate, today: LocalDate) -> DayNavigation
}
```

  `DayViewController` holds `shownDate: LocalDate?` (nil follows `model.today`). Controls and empty states are
  the spec's §6. The picker is `UICalendarView` with a single-date selection, a default decoration on each of
  `workspace.writtenDays()`, and `calendar.firstWeekday` from `weekStartsOnMonday`, presented as a popover from
  its bar button.

- [ ] **Step 1: Write the failing tests.**
  - `DayContentTests`: one per row of the spec's table, plus: today with a page in Trash is `.inTrash`, never
    `.askingForToday`; a day whose only page is a draft is `.noPage`; a past day with a live `day:<date>:2` is
    `.page` of that one.
  - `DayClockTests.the_day_changes_at_the_accounts_midnight` (Review Focus 5): for `Asia/Shanghai` at
    `2026-11-25T15:59:00Z` the next change is `16:00:00Z`; for the zone and date of Task 3's missing midnight the
    next change is that day's first instant; an unknown zone reads as GMT.
  - `DayNavigationTests`: yesterday can go next and shows Today; today cannot and does not; tomorrow cannot and
    shows Today.
  - `DayNavigationTests.today_follows_the_day_and_another_day_stays`: with a model whose `now` the test moves past
    midnight, a screen following today shows the new day and one showing yesterday still shows it; a tick made
    before midnight keeps the `today` it was made with (Review Focus 5).
  - `DayNavigationTests.start_this_page_asks_the_server_once_and_shows_the_page`, and
    `…says_it_could_not_when_offline`: `Couldn't start a page · try again`, and the button works again.
- [ ] **Step 2:** The app test command of Task 8. Expected: fail. Commit
  `test(native): which day is shown, what a day without a page says, and when today moves (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The app test command and the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): previous day, next day, any day from the calendar, and back to today`.

### Task 10: On the simulator, and the record

**Files:**
- Modify: `native/scripts/ui-test.sh`, `native/UITests/TodayUITests.swift` (renamed `DayUITests.swift`),
  `native/UITests/Launch.swift`, `native/README.md`, `docs/plan/native-parity.md`, `docs/design/native-system.md`,
  `docs/plan/native-phase-1a.md` (status), `PRODUCT.md` (the native paragraph and Operating Context line)
- Create: `native/UITests/TickUITests.swift`, `tests/evidence/native-phase-1a/*.png`

**Interfaces:**
- Consumes: everything above. The seed gains one to-do per test that changes one: "Tick me", "Tick me offline",
  "Tick me twice"; "Water the plants" stays for the tests that only read.

- [ ] **Step 1: Write the failing UI tests.**
  - `TickUITests.a_tap_ticks_and_a_second_tap_unticks`: the circle's value goes "not done", "done", "not done";
    after each, the server (read over HTTP by the test) has the same status within 5 s.
  - `TickUITests.a_tick_made_offline_survives_a_relaunch_and_is_sent`: launch on the seeded server with a named
    store; relaunch with the same store against `http://127.0.0.1:9`; tick; the line reads
    `Offline · showing what was last loaded · 1 change will be sent`; relaunch offline again: still "done" and the
    same line; relaunch on the seeded server: "done", no line, and the server has it done.
  - `DayUITests.previous_next_calendar_and_today`: Previous day shows yesterday's title and a Today button; Next
    day is enabled there and disabled on today; a day picked in the calendar opens; Today returns.
  - `DayUITests.a_past_day_with_no_page_can_be_started`: `No page for … yet`, then "Start this page" shows the
    day's page.
- [ ] **Step 2:** `native/scripts/ui-test.sh -only-testing:DaythreadUITests`. Expected: the new tests fail.
  Commit `test(native): ticking, offline and other days on the simulator (red)`.
- [ ] **Step 3:** Make them pass: the seed, launch helpers, and any defect they find (a defect in an earlier
  task's code is fixed here with its own failing unit test first).
- [ ] **Step 4:** `native/scripts/ui-test.sh`. Expected: every UI test passes. Take the screenshots with
  `xcrun simctl io <device> screenshot`: a day with ticked and open to-dos (light, dark, largest text), the offline
  line with a change waiting, the held button and its menu (a conflict made by changing the seed server's row
  between the tick and its send), another day with the Today button, the calendar, a past day with no page, a
  future day, the sign-out alert.
- [ ] **Step 5:** Update the documents named above: every string on screen in `native-system.md`; in
  `native-parity.md` the rows this slice changes and "Commands the app sends"; the README's commands. Commit
  `docs(native): what phase 1a holds, with screenshots`.

### Task 11: On his data

Nothing in this task is code, and Brian does the tapping: the app writes to his real workspace.

- [ ] A Debug build on the simulator against production, signed in by him. He ticks one to-do in the app: it is
  done on the web after a reload. He ticks one on the web: it is done in the app after pull to refresh. He opens
  yesterday and comes back to today.
- [ ] The sync log shows no held entry and no failed pass; the audit still reports "0 of N pages fail".
- [ ] Record the results under this task and set the plan's status line.

## Decisions made while building (2026-11-25)

Brian had not read the design when building began, and asked not to be stopped for what could be settled. These
are the calls made on his behalf while building, in the order made, each with what it costs if wrong. Any of them
can be reversed.

| Decision | If wrong |
|---|---|
| Task 1 has no failing-test commit of its own: its files are the expectations Tasks 2 and 3 fail against | One task's history lacks a red commit |
| `labelFor` is imported from `src/components/outbox.ts` by the fixtures script as it stands; nothing under `src/` was moved | The script breaks if that module ever needs a browser |
| The task that changed `TodoTask.Status` also fixed its callers in the other packages | None; they had to compile |
| After a lost reply (`already-applied`), the entry stays pending until the whole load is in the copy | One more send of the same entry |
| The store refuses a write that names a row the workspace it was given lacks | A reply is refused if `applying` ever drops a row it was told to keep |
| Keep mine sends the same operation again, as the web does | None known; it is the web's behaviour |
| `signOut(discardingUnsent: true)` tries no pass first; the screen always calls `false` first | A caller that skips `false` discards without one last try |
| A launch always asks the server once, whatever is stored; the "ask nothing" shortcut needs this launch's own answer that sign-in is required | One account request per launch with a hidden copy |
| Once a sign-out that will erase has begun, nothing is sent and nothing new is accepted | A tick tapped in that instant is refused |
| After the server holds a change the engine loads once in that pass | One more load per held change |
| A waited command is sent once more after the server says the copy is behind | One more request per stale tap |
| The fix pass after the whole-slice review took everything a person would notice and left three things out: `writtenDays()` on the main actor, a kept entry's revisions, and sign-out showing nothing while it waits | The calendar lags on a very large workspace; recorded in the design's §9 |
| Straight apostrophes in every string of the app, though the web's source has one typographic | A typographic nit |
| One finding that the fix pass itself introduced (a waited command left unanswered when a sign-out won a race) was sent back for a second, small fix, where the process would have stopped and asked | One more round of work |
| The bar's trailing order is Today, Calendar, Not saved, Account, so Today appearing moves no icon; the design listed Calendar first | A matter of taste; one line to change |
| The calendar sheet opens at half height and at full height when text is at an accessibility size | The last week is cut off at some size in between |
| A past day with no page is not created by opening it (the web creates it) | He taps "Start this page" where the web would not ask |

What the reviews found and left, with the reason for each, is in the design's §9. The first run on the simulator
found six defects no unit test had caught (a tap on the circle did nothing; the calendar marked the wrong day as
today; the calendar sheet cut off its last week at the largest text size; a held tick left a line through the
words; the states for a day without a page were not drawn; one more was withdrawn as an artefact of the test
host). Each fixed one has a test now.

## Order and independence

- Task 1 first. Tasks 2 and 3 depend only on it and on each other's `Status`; do 2 then 3.
- Tasks 4, 5, 6 in that order (one engine). Task 7 needs only Task 2 and can follow 6.
- Task 8 needs 4 to 7. Task 9 needs 3, 5 and 8. Task 10 needs all.
- One pull request for the slice. Nothing under `src/` changes, so the deploy it triggers ships the same web app.
