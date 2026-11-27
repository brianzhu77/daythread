# Native app, phase 1c (The to-do row): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A to-do's row on a day page shows what the web's shows beside its words (dates, Since, the repeat mark,
Reference, Moved to, Blocked by), and he can move it, bring it to today, set it aside, cancel it and restore it from
the row, without leaving the page; a notice says what happened and offers Undo while the server can still undo it.

**Architecture:** The web's pure row functions are moved into `.ts` files the fixtures script can run, and their
answers become shared cases. `DaythreadCore` gains the web's date words, an index of a workspace's to-do rows
(`plannedOn`, repeats, blockers, Since), the row's facts and menu as values, the notices' words and the commands. The
engine's `perform` answers with the receipt and the operation's id and can be told the page it must not overtake; its
state publishes the server's Undo slot and whether anything of his waits to be sent. The list draws the marks through
its content configuration and reports a row's action to its host; the day screen runs the action, shows the notice,
and offers Undo by §11.5's rule. Nothing is drawn ahead: a row action is sent and waited for.

**Tech Stack:** As 1b: Swift 6 language mode, UIKit (list content configuration, swipe actions, context menus,
`UIEditMenuInteraction`, `UICalendarView`), Observation, Swift Testing, XCTest. TypeScript only in Task 1's files.

**Spec:** `docs/design/native-phase-1.md` §11 (slice 1c), with §5, §6, §7, §10.5 and §10.6 behind it. Executors read
§11 in full. The web's behaviour, with exact strings and examples, is in
`.superpowers/sdd/native-phase-1/web-facts-1c.md`; what the app has today in
`.superpowers/sdd/native-phase-1/native-facts-1c.md`. Where either disagrees with the code, the code wins.

**Status (2026-11-27):** Tasks 1 to 11 built; the row driven on the simulator against the seeded server
(`native/UITests/RowUITests.swift`), screenshots in `tests/evidence/native-phase-1c/`. Task 12, on his data, to come.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes.
- **Merging, not overwriting (Brian, 2026-11-26)** binds every task that touches a draft, a save or a load.
- The app holds no TypeScript, no JavaScript engine and no web view. Apple frameworks only; no third-party packages.
- Minimum iOS 26 and macOS 26; Swift 6 language mode with complete concurrency checking; no `@unchecked Sendable` or
  `nonisolated(unsafe)`. Mac Catalyst must keep building.
- `DaythreadCore` imports Foundation only, and words no date with `DateFormatter` or `Date.FormatStyle`: the names
  are the web's `en-US` ones, written out, whatever the device's language, region or zone. `DaythreadSync` never
  imports UIKit.
- The server stays the authority. **The only change under `src/` is Task 1's**, and it changes nothing the web does.
- Nothing predicted is stored as the server's, and **a row action is never drawn ahead**: it is sent and waited for.
- **A row action never sends while its page has a draft** (§11.4 step 3).
- **An Undo is never shown that the app already knows the server would refuse** (§11.5).
- **A row gains no control except the reference row's `Plan for today`.**
- A keystroke awaits nothing. While a text view holds marked text, its row is not reconfigured, reloaded or changed
  from outside (the input-method rule of §10.4).
- Never rely on the order in which an actor's published state and the return of the call that published it arrive:
  count or version it (`SyncState.published`, Task 5).
- Anything that waits and may be cancelled uses `SyncEngine.sleep` (`Task.sleep(nanoseconds:)`), in code and tests.
- Every on-screen string is one of §11's, verbatim (the em dash and the typographic apostrophe of
  `Not today — won’t carry over` included; `Can't` and `Couldn't` keep the ASCII apostrophe, as the web writes
  them), and is added to `docs/design/native-system.md` in the task that first shows it.
- Use the system component with its default appearance; configure, never restyle (`native-app.md` §9).
- Never start anything on, or point a test at, port 3000, and never read `.daythread-local/`. Simulator: only
  `name=iPhone 17,OS=26.5`, never launched against production.
- Commit messages: `feat(native): …`, `test(native): …`, `docs(native): …`, English only.

## Corrections to the spec made by this plan

- **`Reference` stays on a done or cancelled reference row.** §11.2 (`native-phase-1.md:691-692`) says a done row
  shows none of the marks and a cancelled row only `Cancelled`, "as the web". The web draws `Reference` whatever the
  status (`src/components/page-editor.tsx:286`: `role === 'reference'` alone), and §11.2 also says the marks are the
  web's, held by shared cases. The plan follows the web for this one mark; every other mark is open-only, as both
  say. It shows only at regular width, so a phone never sees the difference.
- **The spike was run before Task 2 (2026-11-26) and changes Tasks 6 and 7** (its result is at the end of this
  plan; the design's §11.3 says the same now). Where a task's text below disagrees with these, these win:
  - There is **no list context menu** (`contextMenuConfigurationForItemsAt` is not implemented). Wherever a task
    says "the context menu", it means **the menu of the row's circle button**: `circle.menu` set to the row's
    actions from the Core's menu model, `showsMenuAsPrimaryAction = false`, so a touch and hold (or a secondary
    click) on the circle opens it and a tap still ticks. A row with no actions has no menu on its circle.
  - **The swipe provider answers nil for the row that holds the caret** (the system resigns the keyboard to open a
    swipe, and a flick while typing would do so by accident). Every other to-do row has its swipe.
  - **⌘/** presents the same `UIMenu` through a `UIEditMenuInteraction` on the caret row's cell, at the caret
    (`presentEditMenu(with:)`; the delegate's `editMenuInteraction(_:menuFor:suggestedActions:)` supplies the
    menu). Mac Catalyst was built and not run in the spike: if it does not present there, ⌘/ presents the action
    sheet anchored to the row, and the report says which.
    In the final fix wave (2026-11-27) the editor's on-screen tests were run under the Mac Catalyst destination
    (`cd native/Packages/DaythreadEditor && xcodebuild test -scheme DaythreadEditor -destination
    'platform=macOS,variant=Mac Catalyst' -only-testing:DaythreadEditorTests/OnScreen/RowActionsTests`). The test
    target builds there, but no on-screen test can run: the package's test bundle has no host app, and making the
    test's first `UIWindow` throws `NSInternalInconsistencyException` ("NSApplication has not been created yet"),
    so `command_slash_opens_the_menu_for_the_caret_row` fails before it presses ⌘/ and the interaction's delegate is
    never reached. It showed nothing either way about whether the menu presents on the Mac. ⌘/ on the Mac is
    therefore one of the owner's hand checks (Task 12); the fallback named above (the action sheet anchored to the
    row) is built only if the menu does not present there. The code is unchanged.
  - Task 6's Step 1 is done; its builder starts at Step 2, and first checks one thing the spike saw and did not
    pin down: whether a tap in the middle of a line's words puts the caret where it was tapped (see the spike
    result).
- **The reference row's `Plan for today` button follows the web** (decided after Task 1's review): it is on every
  open reference row, also when the to-do is already planned today, as the shared case `rows/marks.json` "a
  reference row planned today" has it (`planForToday: 'active'`). Only the swipe's and the menu's `Plan for today`
  are left out when the to-do is planned today (`rowMenu`). Where a task below says the button is "not shown when
  planned today", the shared case wins. The design's §11.2 says the same now.
- **From the accessibility text sizes, `Plan for today` sits under the row's words and marks** (found in Task 7):
  beside the words it left them one word per line and its own title was cut. Below those sizes it is at the
  trailing end, level with the words' first line, as §11.2 says. The web also drops the button under a title that
  would get too narrow, and the notice puts `Undo` under its words from the same sizes.
- **A paste still waiting for the run loop's next turn when the page is replaced is dropped, as in slice 1b**
  (decided in Task 8's review): reporting it from inside `replace` made a draft that could undo the server's
  change. Merging it into the incoming page inside the editor, as a held composition is, is left for a later slice.
- **On a phone the notice sits directly under the status bar** (ruled in Task 11's review): its top 8 points under
  the window's top safe-area inset, over the navigation bar's band, as the web's phone notice does
  (`.app-toasts.toast-region--top` in `src/styles.css`). Under the navigation bar, as §11.5 places it, it half-covered
  the day's title with the page at its top. At regular width it stays under the navigation bar.
- A correction found while building is written here with its reason before the code that follows it.

## Review Focus

1. **Words not yet saved when a row action runs**: a to-do typed a moment ago and moved at once; a page whose draft
   is offline, behind the server's page or stuck. The save goes first in the same pass, the command is never sent
   over a draft, and nothing he typed is lost or doubled. Tests in Task 5
   (`a_command_told_not_to_overtake_a_page_is_sent_after_that_pages_save_in_the_same_pass`,
   `a_command_is_not_sent_while_its_page_has_a_draft_that_could_not_be_saved`) and Task 10
   (`an_action_waits_for_unsaved_words_to_be_saved_first`, `an_action_is_not_sent_when_the_pages_draft_cannot_be_saved`,
   `typing_during_an_action_is_merged`).
2. **An Undo the server would refuse**: he types, ticks, a change from another device arrives, the engine's
   `ensure-day` at midnight clears the slot, a state that holds the answer arrives after the answer itself. The
   button leaves whenever the app knows, and never comes back for that notice. Tests in Task 5
   (`the_undo_slot_follows_the_copy`, `perform_answer_names_the_state_that_holds_it`) and Task 10
   (`undo_leaves_the_notice_when_he_types`, `…_when_he_ticks`, `…_when_the_slot_moves`,
   `the_answer_arriving_before_its_state_still_offers_undo`).
3. **The web's date words at their edges**: `near` stops at five days; `Was due` only when the Due date is before
   both today and the page's day; a reference row's tag is worded against today, not the page's day
   (`pageDate={planDate || todayIso()}`, `page-editor.tsx:294`); `Since` and `Next` gain the year only across a year;
   Sunday's Another day holds `Tomorrow` alone; a device in another language or zone. Tests in Task 2
   (`words_are_the_webs`, `tags_are_the_webs`), Task 4 (`facts_are_the_webs`,
   `another_day_is_the_webs_on_each_weekday`), against cases Task 1 generates with a fixed zone.
4. **The row holding the caret leaves the page**: while he types in it, while he composes in it, with rows nested
   under it, as the first line of the page. The caret goes to the end of the line above, the keyboard never goes
   down, and the nested rows stay. Tests in Task 8.
5. **An action by accident**: a swipe while he selects text or drags the caret, a swipe that runs on, a touch and
   hold inside the words, a second action while one is out. None does anything but what he aimed at. Tests in
   Task 7 (`the_swipe_never_starts_while_he_selects_text`, `no_swipe_action_runs_on_a_full_swipe`,
   `while_an_action_is_out_other_rows_report_nothing`) and Task 10 (`one_action_at_a_time_on_a_page`).

---

### Task 1: The web's row functions where the fixtures can run them, and the shared cases

This task is its own pull request: it touches `src/` and deploys. The web must behave exactly as before.

**Files:**
- Create: `src/components/row-menu-model.ts`, `src/components/row-notices.ts`, `src/components/row-marks.ts`,
  `src/components/blockers-view.ts`, `scripts/fixed-time-zone.ts`, `tests/row-menu-model.test.ts`,
  `tests/row-notices.test.ts`, `tests/row-marks.test.ts`, `tests/dates.test.ts`
- Modify: `src/components/row-actions.tsx`, `src/components/task-row.tsx`, `src/components/page-editor.tsx`
  (`EditorTask`, `rowAct`, `undoRowAction`), `src/components/blockers.tsx`, `src/components/dates.ts` (export
  `near`), `scripts/export-core-fixtures.ts`
- Create (generated): `fixtures/core/dates/words.json`, `dates/tags.json`, `rows/menus.json`,
  `rows/another-day.json`, `rows/marks.json`, `carried/cases.json`, `repeats/words.json`, `blockers/cases.json`,
  `notices/cases.json`, `actions/*.json`; README regenerated

**What moves where** (each old place imports the function from its new file and re-exports it, so no importer
changes; nothing is copied):

| Function | From | To |
|---|---|---|
| `RowIntent`, `RowMenuModel`, `noticeDate`, `rowMenu` | `row-actions.tsx` (imports React) | `row-menu-model.ts` |
| `rowAction(intent, taskId, day, today): Action` (new: `rowAct`'s inline `action` expression) | `page-editor.tsx` | `row-menu-model.ts`; `rowAct` calls it |
| `notTodayText` | `task-row.tsx` | `row-notices.ts` |
| `rowNoticeText(intent, { task, day, today, receipt, plannedAfter }): string` (new: `rowAct`'s inline `text` expression; `plannedAfter` is `plannedOn` of the workspace after the answer) | `page-editor.tsx` | `row-notices.ts`; `rowAct` calls it |
| `rowNotices = { plannedForToday, notDone, undone, cantUndo, couldntUndo }` (new: the literals `'Planned for today'`, `'Not done · your text is kept'`, `'Undone'`, `"Can't undo · changed since"`, `"Couldn't undo · your text is kept"`) | `page-editor.tsx` | `row-notices.ts`; `EditorTask`'s button, `rowAct` and `undoRowAction` use them |
| `sinceLabel`, `hasDateFacts` | `page-editor.tsx` (private) | `row-marks.ts` (exported) |
| `rowMarks(ws, task, { role, planDate, today, planned }): RowMarks` (new: `EditorTask`'s conditions for `Cancelled`, `Reference`, `Moved to`, the date group, `Since`, the repeat mark, `Blocked by` and the `Plan for today` button, returning `{ cancelled, reference, movedTo, dateTag: { text, warn } \| null, since, repeat, blockedBy, planForToday: 'active' \| 'hidden' \| null }`, each the words drawn or null) | `page-editor.tsx` | `row-marks.ts`; `EditorTask` reads its conditions from it inside the `useMemo` that computes `since` today, with `planned` added to its dependencies; `DateTag` still draws the tag |
| `blockedIn`; `blockedByWords(blocked): string` (new: `Blocked by <title>` or `Blocked by <n>`) | `blockers.tsx` (imports React) | `blockers-view.ts`; `BlockedMark` uses both |

`todo-repeat-view.ts` (`repeatsIn`, `repeatMarkName`, `nextDayLabel`, `noticeWithNext`), `todo-repeats.ts`
(`repeatWords`), `carried.ts`, `task-links.ts` and `dates.ts` are already importable and stay where they are.

**Interfaces:**
- Produces, for Tasks 2 to 4 (every case built by running the functions above or the server's own
  `applyCommand` through `harness()`, never written by hand; `today` is `2026-11-26`, a Thursday, unless a case
  says otherwise):
  - `dates/words.json`: `[{ date, today, daysBetween, weekday, shortLabel, longLabel, near, sinceLabel,
    nextDayLabel }]`, for today and every date from 8 days before to 10 after, and `2025-11-03`, `2026-12-31`,
    `2027-01-01`, `2027-11-24`, `2028-02-29`.
  - `dates/tags.json`: `[{ name, deadlineOn, attentionOn, today, pageDate, planned, text, passed }]` from
    `taskDateTag` and `deadlinePassed`: the seventeen examples of the web facts' §3.1, each on today's page, on a
    past page (`2026-11-20`) and on a future page (`2026-12-03`), with `planned` set and null.
  - `rows/menus.json`: `[{ name, status, role, planned, pageDate, today, menu }]` from `rowMenu` (`menu` is its
    model or null): a page that is not a day; done; cancelled on a past day, today and a future day; open on a past
    day (plan and reference rows); a reference row today and on a future day, planned today and not; a plan row
    today, planned today, planned tomorrow (stale) and planned on a later day (stale); a plan row on tomorrow's page
    and on a later day's, planned there and planned elsewhere.
  - `rows/another-day.json`: `[{ today, options }]` from `anotherDayOptions` for `2026-11-22` to `2026-11-28`.
  - `rows/marks.json`: `[{ name, workspace, pageId, blockId, today, planned, marks }]`: `marks` from `rowMarks` for
    one row, `planned` the `plannedOn` of every to-do of the workspace. Rows: each date tag shape; a passed Due date;
    carried seven days (Since) and six (none); a repeat's current to-do and a done one; blocked by one and by two; a
    cancelled plan row; a done row; an open, a done and a cancelled reference row; a reference row planned today;
    a history row (Moved to); a row whose to-do the workspace does not hold.
  - `carried/cases.json`: `[{ name, workspace, taskId, today, since, label }]`: every scenario of
    `tests/carried.test.ts`, built the same way (`set-draft` then `apply-draft` for a day carried by its draft),
    `label` being `Since ` and `sinceLabel`.
  - `repeats/words.json`: `[{ rule, words, markName }]`: every day; every 3 days; every week; every 2 weeks on Mon,
    Thu; every month; every year; every 5 days, from when it's done; a rule with `until`.
  - `blockers/cases.json`: `[{ name, workspace, blocked, words }]`: `blocked` maps each blocked to-do to its
    blockers' ids in link order (`blockedIn`), `words` to `blockedByWords`. Cases: one in force; the blocker done;
    cancelled; paused (still holds); the blocked to-do done; an end whose only row is in Trash, on a template, on a
    day's draft; two blockers.
  - `notices/cases.json`: `[{ name, intent, task, day, today, receipt, plannedAfter, text }]` from
    `rowNoticeText`: a move to tomorrow, to a day next year, to today by Pick date; bring to today; not today on
    today's page, on another day, each with and without a Due date; a stale row (`Removed from the day`); cancel
    with one next to-do this year and next year, with none and with two; restore.
  - `actions/<name>.json`: `{ before, intent, action, receipt, after, plannedAfter, notice }` for a command the
    server takes (`after` through `forBrowser`, so it holds the Undo marker `{ operationId: "cmd-<name>", revision }`)
    and `{ before, action, refused }` for one it refuses. `action` is `rowAction`'s, applied as is. Names:
    `move-to-a-day-with-a-page`, `move-to-a-day-without-a-page` (`after` holds the new day page),
    `bring-to-today-from-a-past-day` (the past row stays), `plan-for-today-from-a-reference-row`,
    `not-today-sets-aside`, `not-today-on-a-later-day`, `not-today-on-a-stale-row` (receipt message
    `Removed from the day`, not paused), `cancel-a-repeating-to-do` (`nextTodos` has one), `restore`, `undo` (of
    `cmd-move`, made in `before`), `undo-after-a-later-change` and `undo-after-ensure-day` (both refused with
    `Cannot undo after later changes; current values kept`).

- [ ] **Step 1: Write the failing tests** (Node's runner, beside the web's own), each importing the new file:
  - `tests/dates.test.ts`: `taskDateTag` gives each of the seventeen examples of the web facts' §3.1 on today's page
    (`Due today`, `Due tomorrow`, `Due Sun`, `Due Tue`, `Due Wed 12/2`, `Was due Mon`, `Due Mon 11/23` on a past
    page, `Due that day` on a future page, `Start tomorrow`, empty, `Unscheduled`, `Start Sat 12/5 · Due Sat 12/5`,
    `Due tomorrow · Start tomorrow`, `Start Mon · Due Sun 12/6`, `Due Sat · Start tomorrow`,
    `Start today · Due Sun`, `Was due Mon`); `near` at 0, 1, 2, 5 and 6 days.
  - `tests/row-menu-model.test.ts`: `rowMenu` for a plan row on today's page (groups `Tomorrow · Fri, Nov 27`,
    `Not today` | `Another day`: `This weekend · Sat 11/28`, `Next week · Mon 11/30`, `Pick date…` | `Cancel task`
    danger); a stale row (`Remove from Thu`); a later day (`Not on Fri`); a reference row (primary
    `Plan for today`, absent when planned today); cancelled (`Restore`, on a past day too); past (`Bring to today`);
    done and a non-day page (null). `rowAction` for each intent equals the action `rowAct` sent before the move.
  - `tests/row-notices.test.ts`: `rowNoticeText` gives `Moved to Fri, Nov 27`, `On today`,
    `Not today — won’t carry over`, `Not on Fri 11/27 · due Fri still tracked`,
    `Removed from Fri · still planned for Mon`, `Cancelled · Next Mon, Dec 7`, `Restored`.
  - `tests/row-marks.test.ts`: `rowMarks` for a carried, repeating, blocked, dated open plan row; a done row
    (`reference` only on a reference row); a cancelled row; a history row (`Moved to Fri 11/27`); `sinceLabel` with
    and without the year.
- [ ] **Step 2:** `npm test`. Expected: the four files fail (their modules do not exist). Commit
  `test(native): the web's row words as functions the shared cases can run (red)`.
- [ ] **Step 3:** Move and write out the functions as the table says. `npm test`, `npm run typecheck`. Expected: all
  pass, the web's existing tests unchanged.
- [ ] **Step 4:** The script's first import is `./fixed-time-zone.ts`, which sets `process.env.TZ = 'UTC'` (ESM
  evaluates imports in order, and `dates.ts` reads the device's zone); the script then throws unless
  `new Date(2026, 10, 26).getTimezoneOffset() === 0`. Add the areas above; the script asserts each `actions/` case's
  `notice` is `rowNoticeText` of its receipt and `plannedAfter`, each refused case throws that message, and
  `move-to-a-day-without-a-page`'s `before` has no page for the day. They go under `actions/`, not `commands/`:
  `PredictionTests` reads every file of `commands/` as a predicted tick. `npm run fixtures`,
  `node scripts/export-core-fixtures.ts --check`, `npm test`, `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(native): the web's row functions in files the fixtures run; shared cases for the to-do row`.

### Task 2: Core: dates and the web's date words, a to-do's dates, the date tag

**Files:**
- Create: `native/Packages/DaythreadCore/Sources/DaythreadCore/DayWords.swift`, `…/DaythreadCore/DateTag.swift`
- Modify: `…/DaythreadCore/LocalDate.swift`, `…/DaythreadCore/Workspace.swift` (`TodoTask`)
- Test: `…/DaythreadCoreTests/DateWordsTests.swift`, `…/DateTagTests.swift`, `WorkspaceTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: `dates/words.json`, `dates/tags.json` (Task 1).
- Produces:

```swift
extension LocalDate {
  /// `daysBetween(self, other)` in `dates.ts`: whole days from this day to `other`, negative when it is earlier.
  public func days(to other: LocalDate) -> Int
  /// 0 is Sunday, as `Date#getDay()`.
  public var weekday: Int { get }
  public var year: Int { get }
  public var month: Int { get }
  public var day: Int { get }
}
/// The web's date words (`dates.ts`, `sinceLabel`, `nextDayLabel`), `en-US` and the Gregorian calendar, written out.
public enum DayWords {
  public static func weekday(_ date: LocalDate) -> String                     // "Thu"
  public static func shortLabel(_ date: LocalDate) -> String                  // "Thu 11/26"
  public static func longLabel(_ date: LocalDate) -> String                   // "Thu, Nov 26" (`noticeDate`)
  public static func near(_ date: LocalDate, today: LocalDate) -> String      // "today", "tomorrow", "Sun", "Wed 12/2"
  public static func sinceLabel(_ date: LocalDate, today: LocalDate) -> String    // "Nov 3", "Nov 3, 2025"
  public static func nextDayLabel(_ date: LocalDate, today: LocalDate) -> String  // "Mon, Dec 7", "Wed, Nov 24, 2027"
}
extension TodoTask {
  /// Read from `raw`; nil when absent, null or not a date. The workspace stays readable either way.
  public var createdOn: LocalDate? { get }
  public var sourcePageId: String? { get }
  /// `hasDateFacts`: a Due or a Start date.
  public var hasDateFacts: Bool { get }
  /// `deadlinePassed`: the Due date is before `today`.
  public func deadlinePassed(today: LocalDate) -> Bool
}
public enum DateTag {
  /// `taskDateTag`; "" when nothing is to be drawn.
  public static func text(for task: TodoTask, today: LocalDate, pageDate: LocalDate, planned: LocalDate?) -> String
}
```

- [ ] **Step 1: Write the failing tests.**
  - `DateWordsTests.words_are_the_webs` over every case of `dates/words.json`: `days(to:)`, `DayWords.weekday`,
    `shortLabel`, `longLabel`, `near`, `sinceLabel`, `nextDayLabel` each equal the case's.
  - `DateWordsTests.the_weekday_of_known_days` (`2026-11-22` is 0, `2026-11-26` is 4, `2028-02-29` is 2).
  - `DateTagTests.tags_are_the_webs` over every case of `dates/tags.json`: `DateTag.text` equals `text`, and
    `deadlinePassed(today:)` equals `passed`.
  - `DateTagTests.a_to_do_without_dates_has_no_date_facts`.
  - `WorkspaceTests.a_to_do_reads_the_day_it_was_made_and_its_page` (from a `rows/marks.json` workspace); absent and
    `"soon"` give nil, and the workspace still reads.
- [ ] **Step 2:** `cd native/Packages/DaythreadCore && swift test`. Expected: fail. Commit
  `test(native): the web's date words and date tag (red)`.
- [ ] **Step 3:** Implement. Month and weekday names are two constant arrays with a comment naming `dates.ts`.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the web's date words, a to-do's dates and its date tag`.

### Task 3: Core: a workspace's to-do rows, Since, repeats and blockers

**Files:**
- Create: `…/DaythreadCore/TodoIndex.swift`, `…/DaythreadCore/DayDraft.swift`, `…/DaythreadCore/RepeatRule.swift`
- Test: `…/DaythreadCoreTests/TodoIndexTests.swift`, `…/CarriedTests.swift`, `…/RepeatTests.swift`,
  `…/BlockerTests.swift`

**Interfaces:**
- Consumes: Task 2; `rows/marks.json`, `carried/cases.json`, `repeats/words.json`, `blockers/cases.json`.
- Produces:

```swift
/// Anything but exactly "plan" reads as a reference (`rowRole`).
public enum RowRole: Hashable, Sendable {
  case plan, reference
  public init(_ prop: JSONValue?)
}
/// A row of a to-do on a live page (not in Trash, not a template, not a day's draft), as `taskRows` gives it.
public struct TaskRow: Hashable, Sendable {
  public let pageId: String
  /// The page's date when it is a day page; nil otherwise.
  public let day: LocalDate?
  public let blockId: String
  public let role: RowRole
}
/// What the rows of a workspace say about its to-dos, read once per workspace value: a keystroke that draws
/// one row never reads every page again. Build one for each workspace a screen is given, and read every row from it.
public struct TodoIndex: Sendable {
  public init(_ workspace: Workspace)
  /// `plannedOn`: the newest day page holding a plan row of it; nil when none does.
  public func plannedOn(_ taskId: String) -> LocalDate?
  /// In page order, then document order.
  public func rows(of taskId: String) -> [TaskRow]
  /// The rule of the repeat whose current to-do this is, when the to-do is open (`repeatsIn`).
  public func repeatRule(of taskId: String) -> RepeatRule?
  /// Its blockers in force, in the order the links were made (`blockedNow` over `liveTaskIds`); empty when none.
  public func blockers(of taskId: String) -> [TodoTask]
  /// `carriedSince`.
  public func carriedSince(_ task: TodoTask, today: LocalDate) -> LocalDate?
}
public struct RepeatRule: Hashable, Sendable {
  public enum Every: String, Sendable { case day, week, month, year }
  public enum From: String, Sendable { case schedule, done }
  public let every: Every
  public let interval: Int
  public let weekdays: [Int]?
  public let from: From
  /// Nil when the rule does not read.
  public init?(_ json: JSONValue)
  /// `repeatWords`: "every week", "every 2 weeks on Mon, Thu", "every 5 days, from when it's done".
  public var words: String { get }
  /// `repeatMarkName`: "Repeats every week".
  public var markName: String { get }
}
public enum Blockers {
  /// `blockedByWords`: "Blocked by Buy paint", "Blocked by 2"; nil for none.
  public static func words(_ blockers: [TodoTask]) -> String?
}
```

  `DayDraft.swift` is internal: the day's draft of a day page (`draftOf`: the live page `draft:<day page id>` of type
  `draft`) as far as Since needs it, the to-dos it applied. Repeats and links are read from `Workspace.rest`
  (`todoRepeats`, `links`); one that does not read is not in force, and the workspace stays readable.

- [ ] **Step 1: Write the failing tests.**
  - `TodoIndexTests.planned_days_are_the_webs`: for every case of `rows/marks.json`, `plannedOn` of every to-do
    equals `planned`.
  - `TodoIndexTests.rows_on_trash_a_template_or_a_draft_plan_nothing`; `the_newest_day_wins`;
    `a_reference_row_plans_nothing`.
  - `TodoIndexTests.an_index_of_a_drawn_draft_sees_its_rows` (`Workspace.drawing(draft:of:)` adding a plan row to
    tomorrow's page: that index plans the to-do tomorrow; the index of the workspace before does not).
  - `CarriedTests.since_is_the_webs` over every case of `carried/cases.json` (the date, and `"Since " +
    DayWords.sinceLabel` equals `label`).
  - `RepeatTests.words_are_the_webs` over `repeats/words.json` (`words` and `markName`).
  - `RepeatTests.only_an_open_current_to_do_repeats` (done, cancelled, the previous one, a repeat whose to-do is
    gone); `RepeatTests.a_rule_that_does_not_read_marks_nothing`.
  - `BlockerTests.blockers_in_force_are_the_webs` over `blockers/cases.json` (ids in order, and `Blockers.words`).
- [ ] **Step 2:** `swift test`. Expected: fail. Commit
  `test(native): a workspace's to-do rows, Since, repeats and blockers, as the web reads them (red)`.
- [ ] **Step 3:** Implement. `TodoIndex` walks the pages once in its initialiser; every query reads the index.
- [ ] **Step 4:** `swift test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): an index of a workspace's to-do rows; Since, repeats and blockers`.

### Task 4: Core: a row's facts, its menu, the notices' words, the commands

**Files:**
- Create: `…/DaythreadCore/RowFacts.swift`, `…/DaythreadCore/RowMenu.swift`, `…/DaythreadCore/RowNotice.swift`,
  `…/DaythreadCore/UndoMarker.swift`
- Modify: `…/DaythreadCore/Command.swift`
- Test: `…/DaythreadCoreTests/RowFactsTests.swift`, `…/RowMenuTests.swift`, `…/RowNoticeTests.swift`,
  `…/RowCommandTests.swift`, `CommandTests.swift`, `Fixtures.swift` (`actionCase(_:)`, `actionNames()`)

**Interfaces:**
- Consumes: Tasks 2 and 3; `rows/*.json`, `notices/cases.json`, `actions/*.json`.
- Produces:

```swift
/// What a row can be asked to do. `bringToToday` is `Bring to today` on a past day and `Plan for today` in a reference
/// row's swipe and menu (notice `On today`); `planForTodayButton` is only the reference row's own button
/// (notice `Planned for today`). `pickDate` is never sent: the screen turns it into `move` once he picks a day.
public enum RowAction: Hashable, Sendable {
  case move(LocalDate), pickDate, bringToToday, planForTodayButton, notToday, cancel, restore
}
public struct RowMenu: Hashable, Sendable {
  public struct Item: Hashable, Sendable {
    public let title: String
    public let action: RowAction
    public let destructive: Bool
  }
  public struct Group: Hashable, Sendable {
    public let title: String?        // "Another day", or none
    public let items: [Item]
  }
  /// Every action, in the web's `⋯` order (§11.3's table): the context menu, ⌘/ and VoiceOver.
  public let groups: [Group]
  /// The trailing swipe's actions before `More`, short titles (`Tomorrow`, the off item, `Plan for today`,
  /// `Bring to today`, `Restore`).
  public let swipe: [Item]
  /// What `More` holds, in the web's order: the Another day options, `Pick date…`, `Cancel task`. Empty: no `More`.
  public let more: [Item]
  /// `rowMenu`; nil when the row has no actions (done, or not on a day page).
  public static func of(task: TodoTask, role: RowRole, planned: LocalDate?, pageDate: LocalDate?, today: LocalDate) -> RowMenu?
  /// `anotherDayOptions`, unlabelled: (`Tomorrow` | `This weekend` | `Next week`, date).
  public static func anotherDayOptions(today: LocalDate) -> [(label: String, date: LocalDate)]
}
public struct RowFacts: Hashable, Sendable {
  public enum Mark: Hashable, Sendable {
    case cancelled                         // "Cancelled"
    case dateTag(String, passed: Bool)     // drawn red when passed
    case since(String)                     // "Since Nov 3"
    case repeats(name: String)             // drawn as the `repeat` symbol; read as "Repeats every week"
    case reference                         // "Reference"; regular width only
    case movedTo(String)                   // "Moved to Fri 11/27"; regular width only
    /// The words drawn or read.
    public var words: String { get }
  }
  /// In §11.2's order, every mark that applies, at either width.
  public let marks: [Mark]
  /// "Blocked by Buy paint", "Blocked by 2"; a line of its own.
  public let blockedBy: String?
  /// The reference row's `Plan for today` button is shown: an open to-do, not planned today.
  public let planForToday: Bool
  public let menu: RowMenu?
  /// `rowMarks` for this row: `block` is a `task` row of the page; nil for any other block. The facts of a to-do the
  /// workspace does not hold are empty with no menu. `index` is of `workspace`.
  public static func of(row block: Block, pageDate: LocalDate?, in workspace: Workspace, index: TodoIndex,
                        today: LocalDate) -> RowFacts?
  /// The marks drawn at this width (`Reference` and `Moved to` only when `regularWidth`).
  public func marks(regularWidth: Bool) -> [Mark]
  /// One line for VoiceOver, in order, comma-joined, `Blocked by` last:
  /// "Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint". Nil when there is nothing to say.
  public func spoken(regularWidth: Bool) -> String?
}
/// The server's answer to a command, as far as a notice needs it.
public struct Receipt: Hashable, Sendable {
  public let message: String
  /// The days of the to-dos a repeat made in that command (`nextTodos`).
  public let nextTodos: [LocalDate]
  public init?(_ json: JSONValue)
}
public enum RowNotice {
  /// `rowNoticeText`. `task` is the to-do as it was before the action; `plannedAfter` its planned day in the
  /// workspace after the answer.
  public static func text(after action: RowAction, task: TodoTask, pageDate: LocalDate, today: LocalDate,
                          receipt: Receipt, plannedAfter: LocalDate?) -> String
  public static let undone = "Undone"
  public static let cantUndo = "Can't undo · changed since"
  public static let couldntUndo = "Couldn't undo · your text is kept"
  public static let notDone = "Not done · your text is kept"
}
/// The server's one Undo slot as the browser gets it.
public struct UndoMarker: Hashable, Sendable {
  public let operationId: String
  public let revision: Int
}
extension Workspace {
  /// `undo` of the workspace; nil when absent, null or unreadable.
  public var undoMarker: UndoMarker? { get }
}
extension Command {
  /// Keys: type, taskId, date, from (left out when nil), today.
  public static func planTask(taskId: String, date: LocalDate, from: LocalDate?, today: LocalDate) -> JSONValue
  /// Keys: type, taskId, date, onlyThisDay (always true).
  public static func notToday(taskId: String, date: LocalDate) -> JSONValue
  /// Keys: type, targetOperationId.
  public static func undo(targetOperationId: String) -> JSONValue
  /// `rowAction` (§11.4's table); nil for `.pickDate`.
  public static func forRow(_ action: RowAction, taskId: String, pageDate: LocalDate, today: LocalDate) -> JSONValue?
}
```

  The web's quirks are kept: the date tag of a reference row is worded against today
  (`pageDate: planDate ?? today`), `Moved to` and `Since` read the row's `planDate`, not the page's date.

- [ ] **Step 1: Write the failing tests.**
  - `RowFactsTests.facts_are_the_webs` over every case of `rows/marks.json`: the facts of the case's row hold the
    marks of `marks`, in order, with the same words; `blockedBy` and `planForToday` as the case's.
  - `RowFactsTests.a_done_row_shows_only_reference` (see Corrections); `a_cancelled_row_shows_cancelled`;
    `a_to_do_typed_and_not_saved_shows_no_marks_and_has_its_rows_menu` (a drawn draft's new to-do on today's page);
    `reference_and_moved_to_are_regular_width_only`; `a_paused_to_do_has_no_mark_of_its_own`;
    `the_spoken_marks_are_one_line_in_order` (`Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint`).
  - `RowMenuTests.menus_are_the_webs` over `rows/menus.json`: `groups` equals the case's groups (titles, items, the
    one destructive item), preceded for a reference row by a group of its primary `Plan for today` when the case
    has one; nil where the case's menu is null.
  - `RowMenuTests.another_day_is_the_webs_on_each_weekday` over `rows/another-day.json`.
  - `RowMenuTests.the_swipe_per_kind_of_row`: today's plan row `Tomorrow`, `Not today` (more: `This weekend ·
    Sat 11/28`, `Next week · Mon 11/30`, `Pick date…`, `Cancel task`); on Friday's page `Not on Fri` (more begins
    `This weekend · Sat 11/28`), on Saturday's `Not on Sat` (more begins `Tomorrow · Fri 11/27`, then
    `Next week · Mon 11/30`); a stale row on today's page `Remove from Thu`; a reference row
    `Plan for today` then more, or more alone when planned today; a past day `Bring to today`, more empty; cancelled
    `Restore`, more empty.
  - `RowMenuTests.cancel_task_is_the_one_destructive_item`.
  - `RowNoticeTests.notices_are_the_webs` over `notices/cases.json`; `RowNoticeTests.the_fixed_words` (the four
    constants, character for character).
  - `RowCommandTests.each_command_is_written_as_the_web_writes_it`: for every taken case of `actions/`,
    `JSON.write(Command.forRow(…))` equals `JSON.write(case.action)`; for `undo`, `Command.undo`.
  - `RowCommandTests.the_notice_after_each_shared_action_is_the_webs`: `RowNotice.text` from the case's `receipt`
    and `plannedAfter` (and `TodoIndex(after).plannedOn` equals `plannedAfter`) equals `notice`.
  - `RowCommandTests.the_undo_marker_is_the_commands`: `after.undoMarker` is `cmd-<name>` at `after.revision`;
    absent, null and `{ "operationId": 3 }` read nil.
  - `CommandTests.pick_date_is_never_a_command`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit
  `test(native): a row's facts, its menu, the notices and the commands, as the web's (red)`.
- [ ] **Step 3:** Implement. `RowFacts.of` reads the block's `taskId`, `role` and `planDate` and nothing else.
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): a row's facts and menu, the notices' words, and the row commands`.

### Task 5: Sync: an answer with its receipt, a page not overtaken, the Undo slot

**Files:**
- Modify: `native/Packages/DaythreadSync/Sources/DaythreadSync/SyncEngine+Outbox.swift` (`perform`, `answer`,
  `send`), `SyncEngine.swift` (`publish`, `apply`), `SyncEngine+Drafts.swift`, `SyncState.swift`;
  `native/Packages/DaythreadUI/Sources/DaythreadUI/DayViewController.swift` (`act`: `if case .applied = performed`)
- Test: `…/DaythreadSyncTests/SyncEngineTests.swift`, `…/SyncEngineDraftTests.swift`, `FakeTransport.swift`

**Interfaces:**
- Consumes: `UndoMarker`, `Workspace.undoMarker` (Task 4).
- Produces:

```swift
public enum Performed: Sendable, Equatable {
  public struct Answer: Sendable, Equatable {
    /// The operation id it was sent under (both sends, when it was sent again).
    public let operationId: String
    /// The reply's receipt; nil when the server answered `already-applied`.
    public let receipt: JSONValue?
    /// `SyncState.published` of the first state that holds what the server did.
    public let published: Int
  }
  case applied(Answer)
  case offline
  case signedOut
  case refused(String)
  /// The page it was told not to overtake still had a draft after the pass's saves; nothing was sent.
  case notSent
}
extension SyncEngine {
  /// As before; with `notOvertaking`, that page's draft is due at once (as `saveNow`), and the command is sent only
  /// when, after the pass's saves, the page has no draft of the account; checked again before a second send.
  public func perform(action: JSONValue, notOvertaking pageId: String? = nil) async -> Performed
}
extension SyncState {
  /// The server's Undo slot as the copy has it, when it is of the copy's own revision; nil otherwise.
  public var undoSlot: UndoMarker?
  /// Something of his waits to be sent: a draft, or an outbox entry pending, waiting or held (not the engine's own
  /// request for a day's page).
  public var unsent: Bool
  /// How many states this engine has published, this one included.
  public var published: Int
}
```

  Every existing `== .applied` / `!= .applied` becomes `if case .applied = …`; no test is deleted. And the leftover
  of 1b: `savesRetrying` is emptied in `apply(.full)` when the copy's owner changes, with the other marks there.

- [ ] **Step 1: Write the failing tests.**
  - `SyncEngineTests.perform_answers_with_the_receipt_and_the_operation_id` (the answer's `operationId` is the one
    the transport saw, its `receipt` the reply's).
  - `SyncEngineTests.perform_held_then_sent_again_answers_with_its_one_operation_id`.
  - `SyncEngineTests.perform_answer_names_the_state_that_holds_it`: the state whose `published` is the answer's
    holds the command's changes; no earlier one does.
  - `SyncEngineTests.the_undo_slot_follows_the_copy`: after a command whose changes carry
    `undo: { operationId, revision }`, `undoSlot` is it; after a tick's changes with another marker, that one; after
    an `ensure-day` whose changes carry `undo: null`, nil; after a load whose workspace's marker is of an older
    revision than the workspace, nil.
  - `SyncEngineTests.unsent_says_whether_anything_of_his_waits` (a pending tick, a waiting tick, a held tick, a
    draft: true; the engine's own `ensure-day` alone: false).
  - `SyncEngineTests.an_undo_refused_is_reported_as_refused`: `.refused("Cannot undo after later changes; current
    values kept")`, after a load.
  - `SyncEngineDraftTests.a_command_told_not_to_overtake_a_page_is_sent_after_that_pages_save_in_the_same_pass`
    (Review Focus 1): `keepDraft` then at once `perform(…, notOvertaking:)`: the transport sees the save (without
    the 450 ms wait) then the command, in one pass; the answer is `.applied`.
  - `SyncEngineDraftTests.a_command_is_not_sent_while_its_page_has_a_draft_that_could_not_be_saved` (Review Focus
    1): the draft offline (`.offline`), behind the server's page (`.notSent`), stuck (`.notSent`): no command
    reached the transport, the draft is kept.
  - `SyncEngineDraftTests.a_draft_on_another_page_does_not_hold_the_command`.
  - `SyncEngineDraftTests.the_retry_mark_is_forgotten_when_a_load_brings_another_owner`: a draft `retrying` for one
    owner, then a load under another whose day page has the same id and a draft of its own: that draft is
    `waiting`, not `retrying`.
- [ ] **Step 2:** `cd native/Packages/DaythreadSync && swift test`. Expected: fail. Commit
  `test(native): perform answers with its receipt, waits for a page's save, and the state says the Undo slot (red)`.
- [ ] **Step 3:** Implement. The draft check is made inside the store section that sends, so a draft kept after it
  is a draft on the page as it was (§11.4 step 6), merged as §10.6 says.
- [ ] **Step 4:** `swift test`; build the app. Expected: pass; `BUILD SUCCEEDED`.
- [ ] **Step 5: Commit** `feat(native): perform answers with its receipt and waits for a page's save; the Undo slot`.

### Task 6: Editor: a spike, then the marks under the words

**Files:**
- Modify: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/BlockRow.swift`, `BlockRows.swift`,
  `Cells/TodoBlockCell.swift`, `Cells/BlockCell.swift`, `DocumentViewController.swift`; every pattern match on
  `.todo(…)` in the packages and `native/Tests`; `docs/design/native-system.md`
- Test: `…/DaythreadEditorTests/RowMarksTests.swift`, `BlockRowsTests.swift`, `ScreenFixtures.swift`

**Interfaces:**
- Consumes: `RowFacts`, `TodoIndex` (Tasks 3, 4).
- Produces:

```swift
public enum Kind: Hashable, Sendable {      // BlockRow.Kind
  case todo(taskId: String, status: TodoTask.Status?, paused: Bool, facts: RowFacts?)
  // the other cases unchanged
}
extension BlockRows {
  /// `today` nil draws no facts, as before 1c. The index is built once per call.
  public static func rows(for page: Page, in workspace: Workspace, today: LocalDate?) -> [BlockRow]
}
extension DocumentViewController {
  /// The app's today, for the rows' facts; a change redraws the rows whose facts change. Nil: no facts.
  public var today: LocalDate? { get set }
}
```

  The marks are the list content configuration's `secondaryAttributedText` (footnote, `.secondaryLabel`; a passed
  date tag `.systemRed`; the repeat mark the `repeat` symbol as a text attachment; ` · ` between marks; `Blocked by`
  after a line break), read from `facts.marks(regularWidth:)` with the cell's own horizontal size class, so a
  rotation needs no new rows. The measuring label and the text view are unchanged: the words keep the first line.
  For VoiceOver the cell's elements are `[circle, line, marks]`, `marks` an element over the secondary text whose
  label is `facts.spoken(regularWidth:)`.

- [ ] **Step 1: The spike, before any test**, on the simulator, in a scratch branch that is not merged: a
  `trailingSwipeActionsConfigurationProvider` with two dummy actions and a `contextMenuConfigurationForItemsAt` on
  this list, whose rows' touches go to a `LineTextView` (`LineBlockCell.hitTest`, `Cells/BlockCell.swift:206-213`).
  Find out, and write the answers under "Spike result" at the end of this plan:
  1. Does a horizontal swipe start reliably on an editable row, with the keyboard down and with it up in that row and
     in another? Does it never start while text is selected (a handle dragged) or the caret is moved with the loupe?
  2. Does a vertical scroll that begins on a row still scroll?
  3. Where does a touch and hold reach the context menu rather than the text view's selection: the marks line (with
     `hitTest` leaving it to the cell), the circle, the trailing margin? A secondary click on Mac Catalyst?
  4. Does `UIEditMenuInteraction.presentEditMenu(with:)` show a `UIMenu` with a titled inline group for the caret's
     row from a key command (⌘/), on the phone with a hardware keyboard and on Mac Catalyst?

  **If the swipe cannot be made reliable, stop here and report NEEDS_CONTEXT** with what was tried; the fallback is
  decided then. Otherwise Tasks 7 and 8 build on the answers, and an answer that differs from this plan's guess is written
  under Corrections.
- [ ] **Step 2: Write the failing tests** (UIKit, `Screen.editing` gains `today:` and `rest:` for `todoRepeats`
  and `links`; today `2026-11-26`):
  - `RowMarksTests.each_mark_is_drawn_when_it_applies_and_not_otherwise`: for each mark of §11.2, a row that has it
    draws exactly its words in the secondary text (`Due tomorrow`, `Was due Mon` in `.systemRed`, `Since Nov 3`, the
    repeat symbol, `Cancelled`), and the same row without the fact draws no secondary text.
  - `RowMarksTests.blocked_by_is_a_line_of_its_own` (`Blocked by Buy paint`; `Blocked by 2`).
  - `RowMarksTests.reference_and_moved_to_only_at_regular_width` (`Reference`, `Moved to Fri 11/27` with a regular
    horizontal size class trait override; neither at compact).
  - `RowMarksTests.a_done_row_draws_no_marks` and `a_to_do_typed_and_not_saved_draws_none`.
  - `RowMarksTests.the_marks_are_one_element_after_the_words` (`accessibilityElements` is circle, line, marks; the
    marks' label is `Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint`; the circle's label is
    `Complete <words>` as before).
  - `RowMarksTests.at_the_largest_text_size_and_in_landscape_the_marks_wrap_and_nothing_is_cut` (the secondary
    text's height grows; no part of it lies outside the cell; the words keep their width).
  - `RowMarksTests.typing_in_a_row_with_marks_redraws_nothing_else` (no snapshot applied; other cells the same
    objects; the marks' text unchanged).
  - `RowMarksTests.the_marks_follow_today` (setting `today` to the next day turns `Due tomorrow` into `Due today`).
  - `BlockRowsTests.a_to_do_row_carries_its_facts` and `without_today_a_row_has_no_facts`.
- [ ] **Step 3:** `xcodebuild test -scheme DaythreadEditor -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5'`.
  Expected: fail. Commit `test(native): a to-do's marks under its words (red)`.
- [ ] **Step 4:** Implement. Add to `native-system.md` the marks: `Cancelled`, the date tag's words (`Due today`,
  `Due tomorrow`, `Due Sun`, `Due Wed 12/2`, `Was due Mon`, `Due that day`, `Start tomorrow`,
  `Start Mon · Due Sun 12/6`, `Unscheduled`), `Since Nov 3` (with the year when it is not this one), the repeat mark
  and its VoiceOver name `Repeats every week`, `Reference`, `Moved to Fri 11/27`, `Blocked by Buy paint` /
  `Blocked by 2`, each with where it is drawn; and the marks line under "Views built because the system has none"
  as the configured secondary text it is.
- [ ] **Step 5:** `swift test` and the `xcodebuild test` above; the Mac Catalyst build. Expected: pass. Commit
  `feat(native): a to-do's marks under its words`.

### Task 7: Editor: the row's actions

**Files:**
- Modify: `DocumentViewController.swift`, `Cells/TodoBlockCell.swift`, `Cells/LineTextView.swift`,
  `Cells/BlockCell.swift` (`hitTest`, per the spike), `docs/design/native-system.md`
- Create: `…/DaythreadEditor/RowRequest.swift`
- Test: `…/DaythreadEditorTests/RowActionsTests.swift`

**Interfaces:**
- Consumes: `RowMenu`, `RowAction`, `RowFacts` (Task 4); the spike's answers (Task 6).
- Produces:

```swift
/// What he asked of a row. The list knows no commands: it reports, and its host does the rest.
public struct RowRequest: Sendable, Equatable {
  public enum Kind: Sendable, Equatable { case action(RowAction), more }
  public let kind: Kind
  public let rowID: String
  public let taskId: String
  /// The row's menu when he asked, so the host builds `More`'s sheet from what he saw.
  public let menu: RowMenu
}
extension DocumentViewController {
  /// The one callback for a row's actions: a swipe action, `More`, a context menu item, ⌘/'s menu, a VoiceOver
  /// custom action, the `Plan for today` button.
  public var onRowAction: ((RowRequest) -> Void)? { get set }
  /// The row an action is out for: drawn dimmed (its words and marks in `.tertiaryLabel`), and every row's actions
  /// report nothing until it is nil again. Typing and ticking go on.
  public var actingRow: String? { get set }
  /// The row's frame in the list's coordinates, for a popover; nil when it is not drawn.
  public func sourceRect(ofRow rowID: String) -> CGRect?
}
```

  The trailing swipe: `menu.swipe` then `More` when `menu.more` is not empty, as `UIContextualAction`s with
  `performsFirstActionWithFullSwipe = false`; `Cancel task` is never in the swipe. The context menu: `menu.groups`
  as one `UIMenu`, `Another day` an inline titled `UIMenu`, `Cancel task` `.destructive`; `Pick date…` reports
  `.action(.pickDate)`. ⌘/ on the caret's row presents the same `UIMenu` as the spike found. The line's
  `accessibilityCustomActions` are the groups' items, flattened, named by their titles. The reference row's
  `Plan for today` is a plain system button on the cell (caption size, `.secondaryLabel`), at the trailing end,
  drawn only when `facts.planForToday`, reporting `.action(.planForTodayButton)`; the words never run under it.

- [ ] **Step 1: Write the failing tests** (UIKit; today `2026-11-26`; the swipe read from the list configuration's
  provider, the menu from the delegate's configuration, as the system would ask for them):
  - `RowActionsTests.the_swipe_per_kind_of_row` (titles in order): today's plan row `Tomorrow`, `Not today`,
    `More`; a later day's `Not on Fri`, `More`; a reference row `Plan for today`, `More`; a past day
    `Bring to today`; cancelled `Restore`; a done row and a text row: no swipe.
  - `RowActionsTests.no_swipe_action_runs_on_a_full_swipe` (Review Focus 5).
  - `RowActionsTests.the_swipe_never_starts_while_he_selects_text` (Review Focus 5): with a non-empty selection in
    the row's line the provider gives no actions, as the spike found it must.
  - `RowActionsTests.the_context_menus_items_in_order_per_kind_of_row`: today's plan row `Tomorrow · Fri, Nov 27`,
    `Not today` | `Another day`: `This weekend · Sat 11/28`, `Next week · Mon 11/30`, `Pick date…` |
    `Cancel task` (destructive); a reference row begins `Plan for today` unless planned today; cancelled `Restore`;
    past `Bring to today`.
  - `RowActionsTests.each_action_is_reported_once_with_its_row` (a swipe action, `More`, a menu item, `Pick date…`,
    a custom action, the button: `onRowAction` receives that `RowRequest`, nothing else is presented).
  - `RowActionsTests.command_slash_opens_the_menu_for_the_caret_row`.
  - `RowActionsTests.voiceover_custom_actions_are_the_rows_actions` (names in order).
  - `RowActionsTests.plan_for_today_is_on_an_open_reference_row_only` (not on a plan row, a done or cancelled
    reference row, or one planned today; the words' frame ends before the button's).
  - `RowActionsTests.while_an_action_is_out_other_rows_report_nothing` (Review Focus 5): with `actingRow` set,
    that row is drawn dimmed, every row's swipe and menu report nothing, and typing in a row and ticking a circle
    still work.
- [ ] **Step 2:** The `xcodebuild test` of Task 6. Expected: fail. Commit `test(native): a row's actions (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md`: the swipe's titles (`Tomorrow`, `Not today`, `Not on Fri`,
  `Remove from Fri`, `Plan for today`, `Bring to today`, `Restore`, `More`), the menu's (`Tomorrow · Fri, Nov 27`,
  `Another day`, `Tomorrow · Fri 11/27`, `This weekend · Sat 11/28`, `Next week · Mon 11/30`, `Pick date…`,
  `Cancel task`), the button `Plan for today`, and where each is.
- [ ] **Step 4:** `swift test`, the `xcodebuild test`, the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): a row's actions: the swipe, the context menu, ⌘/, VoiceOver, Plan for today`.

### Task 8: Editor: the caret when its row leaves, and composition committed

**Files:**
- Modify: `DocumentViewController.swift`
- Test: `…/DaythreadEditorTests/EditingTests.swift`, `InputMethodTests.swift`

**Interfaces:**
- Produces:

```swift
extension DocumentViewController {
  /// Commits the marked text of the line that holds it, in place: the caret and the keyboard stay, the committed
  /// words are reported through `onChange` once. Nothing when no line composes.
  public func commitComposition()
}
```

  `replace(document:in:)` gains one rule: when the row that holds the caret is not in the new page, the caret goes
  to the end of the nearest line above it that is still there and takes text (in the order on screen before), and
  that line takes first responder before the old one lets it go, so the keyboard never goes down. With no such line
  above, the first line that takes text, at its start.

- [ ] **Step 1: Write the failing tests** (Review Focus 4):
  - `EditingTests.when_the_caret_row_leaves_the_caret_goes_to_the_end_of_the_line_above` (the line above is first
    responder, its selected range at its end).
  - `EditingTests.the_keyboard_stays_up_when_the_caret_row_leaves` (`KeyboardWatch` saw no hide).
  - `EditingTests.rows_nested_under_a_row_that_left_stay` (the server's page keeps them, promoted; they are drawn
    where it has them; the caret is above them).
  - `EditingTests.when_the_first_rows_caret_row_leaves_the_caret_goes_to_the_first_line`.
  - `EditingTests.a_row_that_leaves_without_the_caret_moves_no_caret`.
  - `InputMethodTests.commit_composition_commits_in_place_and_reports_once` ("今天" marked then committed: one
    `onChange` with it, the keyboard and caret where they were).
  - `InputMethodTests.a_composing_row_that_leaves_keeps_his_words` (`replace` without the row while it composes:
    the outside change waits as §10.4 says; once committed, the words are reported, and the caret goes above when
    the row is then removed).
- [ ] **Step 2:** The `xcodebuild test` of Task 6. Expected: fail. Commit
  `test(native): the caret goes to the line above when its row leaves (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` and the `xcodebuild test`. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the caret goes to the line above when its row leaves`.

### Task 9: UI: the notice

**Files:**
- Create: `native/Packages/DaythreadUI/Sources/DaythreadUI/NoticeView.swift`
- Modify: `docs/design/native-system.md`
- Test: `native/Tests/NoticeViewTests.swift`

**Interfaces:**
- Produces:

```swift
struct Notice: Equatable {
  /// How long it stays: 8 s after an action, 4 s for `Undone`, 6 s for a failure.
  enum Kind: Equatable { case done, undone, failed }
  let text: String
  let kind: Kind
  /// The operation an `Undo` would undo; nil for no button.
  let undoing: String?
}
@MainActor
final class NoticeView: UIView {
  init(sleep: @escaping @Sendable (Duration) async throws -> Void = SyncEngine.sleep,
       voiceOverRunning: @escaping @MainActor () -> Bool = { UIAccessibility.isVoiceOverRunning },
       announce: @escaping @MainActor (String) -> Void = { UIAccessibility.post(notification: .announcement, argument: $0) })
  /// Replaces the notice showing, if any, and starts its time.
  func show(_ notice: Notice)
  /// The `Undo` leaves for good; the words stay until their time is up.
  func withdrawUndo()
  func dismiss()
  var onUndo: ((_ operationId: String) -> Void)?
  private(set) var shown: Notice?
}
```

  One line of words and at most one button (`Undo`, a plain system button), on `UIBlurEffect(style:
  .systemMaterial)` with the system's corner radius, footnote words in `.label`, pinned under the navigation bar
  (the host's safe area top), never at the bottom. A swipe up dismisses it. With VoiceOver running it is announced,
  and while it has its button it does not leave on a timer; once the button is withdrawn its time is counted from
  then. `Undo` is also an accessibility custom action.

- [ ] **Step 1: Write the failing tests** (the view in a window; the test's `sleep` is the 1b `Waits`-style double):
  - `the_notice_shows_its_words_and_one_button` (and none when `undoing` is nil).
  - `it_leaves_after_eight_seconds_undone_after_four_a_failure_after_six` (the waits asked for).
  - `a_new_notice_replaces_the_one_showing` (one view; the first's wait cancelled; its time not counted).
  - `a_swipe_up_dismisses_it`.
  - `undo_reports_its_operation_once` (a second tap reports nothing).
  - `withdrawn_the_button_leaves_and_does_not_come_back` (a later `withdrawUndo` and the old operation do nothing).
  - `with_voiceover_it_is_announced_and_stays_while_it_has_a_button`; `…_then_leaves_on_its_time_once_withdrawn`.
  - `undo_is_an_accessibility_action`.
  - `it_sits_under_the_navigation_bar_and_never_over_the_keyboard` (its frame's top is the safe area's top plus the
    system spacing; with a keyboard frame given, the notice does not intersect it).
- [ ] **Step 2:** The app unit test command. Expected: fail. Commit `test(native): the notice (red)`.
- [ ] **Step 3:** Implement. Add `Undo` to `native-system.md`, and the notice to "Views built because the system has
  none" (`native-app.md` §9 rule 3).
- [ ] **Step 4:** The app unit tests. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the notice`.

### Task 10: UI: running a row action, and Undo

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift`, `DayViewController.swift`,
  `ListReading.swift`, `DayPickerViewController.swift`, `docs/design/native-system.md`
- Test: `native/Tests/RowActionTests.swift`, `DayPickerTests.swift`

**Interfaces:**
- Consumes: Tasks 4, 5, 7, 8, 9.
- Produces:

```swift
public enum RowActed: Sendable, Equatable {
  /// The server did it: the notice's words, and the operation an Undo would undo.
  case done(text: String, operationId: String)
  /// Not sent, failed or refused: nothing changed (`Not done · your text is kept`).
  case notDone
}
extension AppModel {
  /// §11.4 steps 2 to 4 for the row's to-do: hands over every writing call queued before it, then performs the
  /// command with the page not to overtake. Returns once a state holding the answer has arrived (counted by
  /// `SyncState.published`, never assumed from order), so the words read the workspace after it. `action` is never
  /// `.pickDate`. `owner` is the account the row was drawn under; another's answers `.notDone`.
  public func act(_ action: RowAction, taskId: String, pageId: String, pageDate: LocalDate, owner: String) async -> RowActed
  /// Sends `undo` the same way. Returns `Undone`, `Can't undo · changed since` (the server's
  /// "Cannot undo after later changes"), or `Couldn't undo · your text is kept`.
  public func undo(_ operationId: String, pageId: String, owner: String) async -> Notice
  /// §11.5: nothing of his waits to be sent (the state's `unsent`, the writing calls not yet handed over, the ticks
  /// recorded and not yet in the outbox) and the server's slot is this operation's. Observable.
  public func offersUndo(_ operationId: String) -> Bool
}
struct ListReading: Equatable {
  /// As before, and each to-do row's facts by block id (`RowFacts.of` with one `TodoIndex` of the workspace).
  init(of document: String, pageDate: LocalDate?, in workspace: Workspace, today: LocalDate)
}
extension DayPickerViewController {
  /// `selected` nil selects no day; `notBefore` makes the days before it unselectable (`availableDateRange`).
  convenience init(selected: LocalDate?, notBefore: LocalDate?, written: Set<LocalDate>, weekStartsOnMonday: Bool,
                   timezone: String, onPick: @escaping (LocalDate) -> Void)
}
```

  The day screen sets `document.today` from the model and `document.onRowAction`. A request while `actingRow` is
  set does nothing. `.more` presents a `UIAlertController(.actionSheet)` of `menu.more` (`Cancel task`
  `.destructive`, the system's `Cancel` as its cancel action), a popover from `sourceRect(ofRow:)` on a wide
  screen. `.pickDate` presents the calendar (popover, a sheet on the phone, today selectable, no earlier day,
  nothing selected); a day picked closes it and runs `.move(day)`. Any other action: `document.commitComposition()`,
  `actingRow = rowID`, `model.act(…)`, `actingRow = nil`, then the notice: `.done` → `Notice(text, .done,
  undoing: model.offersUndo(op) ? op : nil)`; `.notDone` → `Notice("Not done · your text is kept", .failed, nil)`.
  While a notice offers Undo, every change of `offersUndo` to false calls `withdrawUndo()`. `Undo` runs like an
  action (`actingRow` is the row only if it is still on the page) and shows the notice it returns. A new action
  replaces the notice. The screen takes the answer's page as any outside change (`edit` → `replace`), and its
  typing goes on as a draft merged by §10.6.

- [ ] **Step 1: Write the failing tests** (hosted, the test server whose replies the test releases; the clock at
  `2026-11-26T12:00:00Z`, the copy's zone UTC; a reply's `undo` marker uses the operation id read from the server's
  `sent` while the reply is held):
  - `an_action_waits_for_unsaved_words_to_be_saved_first` (Review Focus 1): type a to-do, swipe `Tomorrow` at once:
    the server receives the save, then `plan-task` for that row's `taskId` with `from` today.
  - `an_action_is_not_sent_when_the_pages_draft_cannot_be_saved` (Review Focus 1): offline, and a stuck draft:
    no command sent, the notice `Not done · your text is kept` with no `Undo`, the row where it was, the words kept.
  - `the_row_leaves_and_the_caret_goes_to_the_line_above` (typing in the moved row; the keyboard stays).
  - `typing_during_an_action_is_merged` (Review Focus 1): reply held, type in another line, release: both the
    server's page and his line are on screen and in the next save.
  - `a_failure_says_so_and_changes_nothing` (refused: the page is the server's as before, `Not done · your text is
    kept`).
  - `the_notices_words`: `Moved to Fri, Nov 27`; `On today` (Bring to today on yesterday's page; Plan for today
    from a reference row's swipe); `Planned for today` (the button); `Not today — won’t carry over`, with
    ` · due Fri still tracked` when it has a Due date; `Not on Sat 11/28` on Saturday's page;
    `Removed from Thu · still planned for Fri` for a stale row; `Cancelled · Next Mon, Dec 7` when the receipt names
    one next to-do; `Restored`.
  - `undo_puts_the_row_back` (`Undone`; the row on today's page as before; the server got `undo` of that operation).
  - `undo_leaves_the_notice_when_he_types`, `…_when_he_ticks`, `…_when_the_slot_moves` (a load whose marker is
    another operation's), `…_when_a_day_page_is_made` (the engine's `ensure-day` answered with `undo: null`)
    (Review Focus 2). The words stay until their time.
  - `the_answer_arriving_before_its_state_still_offers_undo` (Review Focus 2): with the `StateRelay` holding the
    states, the answer comes first; the notice shows `Undo` once the state arrives, and not before it is known.
  - `a_refused_undo_says_so` (`Can't undo · changed since`); `a_failed_undo_says_so`
    (`Couldn't undo · your text is kept`).
  - `a_second_action_replaces_the_first_notice`.
  - `one_action_at_a_time_on_a_page` (Review Focus 5): while one is out its row is dimmed and a second swipe on
    another row sends nothing; typing and ticking go on.
  - `more_opens_the_action_sheet_with_the_rest_in_the_webs_order`.
  - `pick_date_opens_the_calendar_and_moves_to_the_day_picked` (no day before today selectable; `Moved to Mon,
    Nov 30`).
  - `the_marks_follow_the_drawn_workspace` (a load giving a to-do a Due date redraws that row's marks; a load that
    changes nothing a row shows hands the list no new workspace; the marks move at midnight).
  - `DayPickerTests.pick_date_selects_nothing_and_no_day_before_today`.
- [ ] **Step 2:** The app unit test command. Expected: fail. Commit
  `test(native): a row action sent after his words, with its notice and Undo (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md` every notice's words of §11.5's table (`Moved to Fri, Nov 27`,
  `On today`, `Planned for today`, `Not today — won’t carry over`, `Not on Fri 11/27`, `· due Fri still tracked`,
  `Removed from Fri · still planned for Mon`, `Cancelled`, `· Next Mon, Dec 7`, `Restored`, `Undone`,
  `Can't undo · changed since`, `Couldn't undo · your text is kept`, `Not done · your text is kept`), when each is
  shown and how long, and the action sheet and the calendar for `More` and `Pick date…`.
- [ ] **Step 4:** The app unit tests and the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): a row's actions run from the day, with the notice and Undo`.

### Task 11: On the simulator, and the record

**Files:**
- Modify: `native/scripts/ui-test.sh` (the seed), `native/UITests/Launch.swift`, `native/README.md`,
  `docs/plan/native-parity.md`, `docs/design/native-system.md`, `docs/plan/native-phase-1c.md` (status),
  `PRODUCT.md`
- Create: `native/UITests/RowUITests.swift`, `tests/evidence/native-phase-1c/*.png`

**The seed**, after today's page and the 1a/1b to-dos, on the seeded server's own commands (`send` returns the
receipt; a to-do's id is read from the workspace by its title). `plan-task` to today is never used: it is a
choice and restarts Since.
- Dated: `add-task` `Pay the rent` with `deadlineOn` tomorrow (`Due tomorrow`); `File the return` with `deadlineOn`
  three days ago (`Was due <weekday>`, red); `Book the venue` with `attentionOn` in four days and `deadlineOn` in
  ten (`Start <weekday> · Due <short label>`).
- Repeating: `add-task` `Water the fern`, then `set-todo-repeat` `{ every: "week", interval: 1, from: "schedule" }`
  with today and `at`.
- Blocked: `add-task` `Buy paint` and `Paint the fence`, then `link-tasks` `{ taskId: <Paint the fence>,
  add: [<Buy paint>], remove: [], at }` (`Blocked by Buy paint`).
- Cancelled: `add-task` `Return the parcel`, then `task-status` `cancelled` with today.
- Carried seven days: `ensure-day` for eight days ago; `add-task` `Renew the passport` on that page with `plannedOn`
  that day (so `createdOn` is that day); on today's page `set-draft` `{ status: "ready", items: [{ id: "carry-0",
  anchor: <today's first block id>, place: "after", taskId, source: "model", state: "open" }], moreOpen: [],
  allowedTaskIds: [taskId] }`, then `apply-draft` `{ itemIds: ["carry-0"], today }`: the plan row today is the
  draft's, not a choice (`Since <Mon D>`).
- For the actions, one each: `Move me`, `Set me aside`, `Cancel me`, `Undo me`, `Pick a day for me`.

- [ ] **Step 1: Write the failing UI tests** (expected words computed in the test from `Wrapper.today()` with a
  `en_US_POSIX` formatter in UTC; `SeededServer` gains `plannedDay(of title:)`, the newest day page holding a plan
  row of it):
  - `test_the_seeded_rows_show_their_marks` (each row's marks as listed above, read from the marks element).
  - `test_move_to_tomorrow_from_the_swipe`: swipe `Move me`, `Tomorrow`: the row leaves, the notice reads
    `Moved to <tomorrow>`; the server plans it tomorrow; the next day's page shows it.
  - `test_not_today`: `Set me aside`, `Not today`: `Not today — won’t carry over`; on the server it is paused.
  - `test_cancel_and_restore`: `Cancel me`, `More`, `Cancel task`: `Cancelled`, the row drawn cancelled with
    `Cancelled`; swipe, `Restore`: `Restored`; open on the server.
  - `test_undo`: `Undo me` moved to tomorrow, then `Undo`: `Undone`; back on today's page and on the server.
  - `test_pick_date`: `Pick a day for me`, `More`, `Pick date…`, the day three days on: `Moved to <that day>`.
  - `test_the_context_menu_holds_every_action`, where the spike found a touch and hold reaches it.
- [ ] **Step 2:** `native/scripts/ui-test.sh -only-testing:DaythreadUITests/RowUITests`. Expected: fail. Commit
  `test(native): the to-do row on the simulator (red)`.
- [ ] **Step 3:** Make them pass; a defect found in an earlier task's code is fixed with its own failing unit test
  first. Then `native/scripts/ui-test.sh` in full; `TypingFeelTests` still within its budget.
- [ ] **Step 4:** Screenshots on the seeded data into `tests/evidence/native-phase-1c/`: the marks (light, dark,
  largest text, landscape), the swipe open on today's plan row, the context menu, `More`'s sheet, the calendar,
  a notice with `Undo`, `Not done · your text is kept`. `Reference` and `Moved to` show only at regular width,
  which `iPhone 17` is not; their unit test of Task 6 stands for them. Look at each.
- [ ] **Step 5:** Update the documents: every string of 1c in `native-system.md` (check against §11's tables);
  `native-parity.md` (the to-do row's marks and actions, the commands the app now sends with `readsBeyond: true`,
  and where the app differs from the web: marks on a line under the words; actions by swipe and context menu, not a
  handle; nothing drawn ahead, so moving needs a connection; a to-do typed and not saved has its actions; the
  `Plan for today` button absent when planned today, where the web shows it); `PRODUCT.md`; the README; this plan's
  status. Commit `docs(native): what phase 1c holds, with screenshots`.

### Task 12: On his data

Nothing in this task is code, and Brian does the tapping: the app writes to his real workspace.

- [ ] A Debug build on the simulator or his phone against production, signed in by him. On today's page: move a
  to-do to tomorrow from the swipe; it is on tomorrow's page on the web after a reload. Undo it from the notice; it
  is back on the web. Not today, Cancel task and Restore on rows of his choosing, each seen on the web.
- [ ] The marks on his real rows match the web's, row for row, on today's page and on a past and a future day: the
  date tags, Since, the repeat mark, Blocked by, Cancelled (and at regular width on the Mac, Reference and Moved to).
- [ ] By hand, what no test drives: a swipe begun while typing in a long line on his phone; a touch and hold on a
  row with VoiceOver off and on; ⌘/ with his keyboard, on the phone and in the Mac app (on the Mac it has never
  been seen to present: if it does not, the fallback in the Corrections is built); the notice read by VoiceOver with `Undo` as its action.
- [ ] The audit still reports "0 of N pages fail". Record the results here and set the status line.

## Order and independence

- Task 1 first, alone, as its own pull request: the cases every Core test fails against. It touches `src/` and
  deploys on merge; the web does what it did.
- Tasks 2, 3, 4 are Core, in order (3 needs 2's words; 4 needs 3's index).
- Task 5 is the engine; it needs 4 (`UndoMarker`) and nothing of the editor.
- Task 6 needs 4; its spike can run as soon as Task 5 starts, and Tasks 7 and 8 wait for its answers. Task 8 does
  not need 7.
- Task 9 needs nothing but DaythreadUI as it is, and can be built beside 6 to 8.
- Task 10 needs 5, 7, 8 and 9. Task 11 needs all. Task 12 is his.
- Two pull requests: Task 1 alone, then Tasks 2 to 11.
- One departure from the task list this plan was written from: `ListReading` does not carry the width class. The
  facts hold the marks of both widths and the cell picks by its own size class in `updateConfiguration`, so a
  rotation redraws the marks without a new workspace; the width class in the reading would only redraw more.

## Spike result

Run on the simulator on 2026-11-26, ahead of Task 6, in a scratch branch (`spike/native-1c-row-actions`, never
merged). Observed unless marked as reasoning.

1. **A trailing swipe opens reliably on an editable row** (keyboard down; caret in that row; caret in another
   row), and the whole cell moves with it, the text view and the circle included: the 1b layout needs no change.
   The list layout's `trailingSwipeActionsConfigurationProvider` is enough (no delegate), it is asked once per
   swipe that starts, and its index path is the row to act on. The swiped row is drawn as the system draws it.
2. **Accidental starts.** It did not start while the caret was dragged with the loupe, while a selection handle
   was dragged, or on a vertical scroll that drifted 30 pt sideways. It did start on a quick 40 pt sideways flick
   inside a line and on a slow 40 pt drag. The space-bar caret drag was not tested (it happens on the keyboard).
3. **Typing after a swipe.** Opening a swipe on the row being typed in resigns its first responder (the keyboard
   goes down); with the caret in another row that row keeps the keyboard and typing goes on. A tap on the words
   while a swipe is open only closes the swipe. Tapping an action that redraws the row (a tick) closed the swipe
   cleanly and typing in the row afterwards worked.
4. **The list's context menu is unusable on these rows**: a touch and hold on the words opened it instead of
   placing the caret, and with the caret in the row it appeared together with the text's Select menu. On the
   trailing margin and on the marks line it opened alone. On the circle the list never asks; **a 1.2 s press on
   the circle ticked the to-do on release** (as the app is today). With `circle.menu` set and
   `showsMenuAsPrimaryAction` false, a touch and hold shows the button's menu and does not tick; a tap still
   ticks. Mac Catalyst built; not run.
5. **The marks line through `secondaryAttributedText` is safe**: the text view stays exactly over the words'
   guide, the row grows with both lines, typing reconfigures nothing, and the package's tests pass with marks on
   every to-do row. A touch on the marks goes to the text view (the caret lands in the words). The marks are not
   in the cell's accessibility elements and must be added.
6. **A key command can open a real menu for a row**: a `UIKeyCommand` calling
   `UIEditMenuInteraction.presentEditMenu(with:)` on an interaction added to the focused row's cell, placed at
   the caret; the keyboard and caret stay. On the phone the items show as the edit menu's bar. Not run on Mac
   Catalyst (reasoning: it presents as a pop-up menu there).
7. **Also seen.** Dragging the page down closes an open swipe. An open swipe when the page is replaced or the row
   deleted from outside was not tried. `UIListContentView` already carries a long-press recognizer whose delegate
   is the cell. **And one thing to pin down first in Task 6:** in the spike's runs a tap at the centre of a line
   put the caret at offset 0 (typing gave "ZWater the plants"), while a tap near the end put it at the end; it
   was seen after a swipe had been opened and closed, and not checked without one. If a tap in the middle of the
   words does not put the caret where it was tapped, that is a defect of slice 1b, to be fixed with its own
   failing test before anything else.

## Decisions made while building (2026-11-26 to 2026-11-27)

The calls I made on Brian's behalf while the plan ran, in the order they were made, each with what it costs if
it is wrong. The design (`native-phase-1.md` §11) and this plan's Corrections hold the ones that changed what
the app does.

| Decision | Why | If it is wrong |
|---|---|---|
| No control is added to a row; actions are on a trailing swipe, the circle's menu, ⌘/ and accessibility actions | An ellipsis on the caret's row would take width from the words or move them | On a phone the actions are found only by swiping or by holding the circle |
| The marks go on one line under the words, not at the trailing end of the first line | The words keep the row's full width; it is the system list's secondary text | A layout change in one cell |
| Row actions are sent and waited for, not queued; they need a connection | Nothing predicted is stored; a queued move would have to be drawn ahead | A later slice draws them ahead and queues them |
| `Reference` stays on a done or cancelled reference row | The web draws it | Nothing on a phone, where the mark is hidden |
| No list context menu; the full menu is the circle button's own (touch and hold; a tap still ticks) | The spike: a list context menu on rows whose touches go to a text view opened instead of placing the caret | The caret row's actions on a phone are found only by holding its circle |
| The row being typed in has no swipe; none while text is selected | Opening a swipe there drops the keyboard | He moves the caret to swipe that row, or holds its circle |
| ⌘/ presents the caret row's menu through the edit menu interaction | The only public way to present a menu from a key | On the Mac it may not present (never shown either way; in Task 12's hand checks, with an action sheet as the fallback) |
| `Plan for today` is on every open reference row, also when planned today | The web does this and the shared case says so | One condition |
| The notice's words wrap rather than staying on one line | Long notices and large text sizes would cut words | A one-property change |
| A red commit that does not compile because the API under test does not exist yet counts as the failing-tests commit | Swift cannot fail a test of a missing symbol otherwise; stubs would put product code in the red commit | Nothing in behaviour |
| Tasks 5 and 10 were started before the reviews of the tasks they build on had ended | They build only against those tasks' public interfaces | A merge of fix commits (it cost nothing) |
| Builders' commit trailers and two `fix(native)` prefixes are left as written | No history rewrite | Nothing in behaviour |
| A paste still waiting for the run loop's next turn when the page is replaced is dropped, as in slice 1b | Reporting it from inside `replace` made a draft that could undo the server's change; merging it inside the editor is a design of its own | A paste lost when a server update lands in the same turn; he sees it and pastes again |
| From the accessibility text sizes, `Plan for today` sits under the row's words and marks | Beside the words it cut its own title and left the words one per line | A layout constant |
| Task 10's `wip:` commit was not carried over: its red commit was cherry-picked and its implementation squashed under the plan's title | Keeps red-before-green and the commit convention without rewriting anything published | Nothing in the tree (checked by diff against the task branch) |
| The notice uses the system material, not glass | On the real screen the rows beneath showed through its words, badly in dark at the largest text size | One line and two screenshots |
| On a phone the notice sits directly under the status bar, over the previous and next-day buttons, not under the navigation bar | Under the bar it half-covered the day's title; the web's phone layout puts its notice under the status bar | One anchor and its tests; it hides those buttons while it shows (a swipe up dismisses it) |
| A row action on the row being composed in is not refused | §11.4 step 1: an action commits the composition and goes on | One action on facts a moment old, which the server judges |

Left for a later slice, with why: the model building one to-do index per published state and sharing it with
the editor (today one is built per arriving state on the main actor: about 49 ms in Debug for 3,000 to-dos,
with the keystroke budget holding); `expectedOwner` passed into `perform`; the paste merge above.
