# Native app, phase 1d.1 (The morning, above the page): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On today's page he sees, under the title, what the web's phone layout shows there: today's events in one
line, the to-dos due or started (`Due soon`), and the to-dos he set aside (`Not today · N`), which he can bring back
or plan for another day; on any other day's page he sees that day's `Due soon`. Every word and every rule is the web's.

**Architecture:** The web's pure pieces of the strip move out of its components into `.ts` functions, and their
answers become shared cases. `DaythreadCore` reads each `@date` chip's event in the pass that already builds the
`TodoIndex`, and works the strip out as one equatable value, `DayFacts` (strings and ids), from the workspace as drawn
and its index. The day screen hosts a SwiftUI view of it, `DayFactsView`, in the page's header under the title's
stack; the view's model holds the fold and reports taps. A strip action is a `plan-task` with no `from`, sent and
waited for through `AppModel.plan` as a row's action is, with the screen's one-action state now saying where the
action came from. The list gains `scroll(toRow:)` and keeps the typed line in place when the header's height changes.

**Tech Stack:** As 1c: Swift 6 language mode, UIKit, Observation, Swift Testing, XCTest; SwiftUI for `DayFactsView`
only (`Button`, `Label`, `GroupBox`, `DisclosureGroup`, `Menu`, `ViewThatFits`), hosted by a `UIHostingController`.
TypeScript only in Task 1's files.

**Spec:** `docs/design/native-phase-1.md` §12.1 to §12.6 (slice 1d.1), with §11.4 and §11.5 (how an action is sent;
the notice and Undo) behind them. Executors read §12.1 to §12.6 in full, and §12.7 to know what must stay possible.
The web's behaviour, with exact strings, is in `.superpowers/sdd/native-phase-1/web-facts-1d.md` §4 to §6; what the
app has today in `.superpowers/sdd/native-phase-1/native-facts-1d.md`. Where either disagrees with the code, the code
wins.

**Status (2026-11-27):** Planned; no task built.

## Questions the plan raised, answered (2026-11-27)

1. **The host of `DayFactsView`.** Task 5's first tests say whether a `UIHostingController` child takes a height that
   follows the header's width inside the list's self-sizing header. If it does not, the builder hosts the same view
   through `UIHostingConfiguration { DayFactsView(model:) }.makeContentView()` (no child controller; the fold still
   lives in the model) and records it under Corrections. Either way the height's changes reach the list and the typed
   line stays where it is.
2. **A third seeded server for the UI tests** (Task 8, port 3743) is accepted: one more server start in every run of
   `native/scripts/ui-test.sh`, in exchange for the earlier UI tests not moving.
3. **What VoiceOver reads** (Task 5) is as the plan proposes: the events line as its words then `, +N more`; a
   `Due soon` or `Not today` row as `<words>, <tag>` (the words alone when the tag is empty); the menu as
   `More for <words>`.

## Global Constraints

- **Behaviour tests first (Brian, 2026-11-25).** Each task commits its failing behaviour tests on their own, as
  `test(native): … (red)`, after seeing them fail for the expected reason, and only then the commit that makes them
  pass. The tests state what a person or a client of the code observes. Task 1 (the web) and Task 7 (a measurement)
  are exempt: Task 1's files are the expectations later tasks fail against; Task 7 asserts no behaviour.
- **Merging, not overwriting (Brian, 2026-11-26)** binds every task that touches a draft, a save or a load.
- The app holds no TypeScript, no JavaScript engine and no web view. Apple frameworks only; no third-party packages.
- Minimum iOS 26 and macOS 26; Swift 6 language mode with complete concurrency checking; no `@unchecked Sendable` or
  `nonisolated(unsafe)`. Mac Catalyst must keep building.
- `DaythreadCore` imports Foundation only, and words no date with `DateFormatter` or `Date.FormatStyle`: the names
  are the web's `en-US` ones, written out, whatever the device's language, region or zone. `DaythreadSync` never
  imports UIKit. **`DayFacts` holds strings and ids only: nothing of UIKit or SwiftUI.**
- The server stays the authority. **The only change under `src/` is Task 1's**, and the one thing it changes that the
  web shows is `Not today` in place of `Not today · ` for a to-do set aside whose tag is empty.
- Nothing predicted is stored as the server's, and **a row action or a strip action is never drawn ahead**: it is
  sent and waited for.
- **An action never sends while the page it writes has a draft** (§11.4 step 3): the row's page for a row action,
  today's page for a strip action; a strip action with no live page of today (in Trash) is sent with no page to wait
  for.
- **An Undo is never shown that the app already knows the server would refuse** (§11.5).
- **A row gains no control except the reference row's `Plan for today`.**
- **The strip's facts are read when a state is drawn, never on a keystroke** (§12.1's anti-goal).
- A keystroke awaits nothing. While a text view holds marked text, its row is not reconfigured, reloaded or changed
  from outside (the input-method rule of §10.4).
- Never rely on the order in which an actor's published state and the return of the call that published it arrive:
  count or version it (`SyncState.published`).
- Anything that waits and may be cancelled uses `SyncEngine.sleep` (`Task.sleep(nanoseconds:)`), in code and tests.
- "Today" is the app's today (`AppModel.today`, the workspace's time zone), never the device's clock.
- Every on-screen string is one of §11's or §12's, verbatim: the middle dot of `Not today · 2` and
  `Tomorrow · Sat 11/28` is U+00B7, the ellipsis of `Pick date…` is U+2026, `Can't` and `Couldn't` keep the ASCII
  apostrophe. Each is added to `docs/design/native-system.md` in the task that first shows it, with where it shows.
- Use the system component with its default appearance; configure, never restyle (`native-app.md` §9). SwiftUI is
  used for `DayFactsView` only; the page's list stays UIKit and is not touched by it.
- **What 1d.2 needs stays possible**: the header's outer stack is where 1d.2's draft line goes, directly under the
  title's stack and above the strip; `scroll(toRow:)` takes a row id, not a block's index, so a row that is not a
  line of the page can be scrolled to; `AppModel.plan` takes the notice's words from its caller, so `N more open`
  reuses it with `Added`.
- Never start anything on, or point a test at, port 3000, and never read `.daythread-local/`. Simulator: only
  `name=iPhone 17,OS=26.5`, never launched against production. Screenshots are of seeded data only.
- Commit messages: `feat(native): …`, `test(native): …`, `docs(native): …`, English only.

## Corrections to the spec made by this plan

- **`Command.planTask` without `from` already exists** (slice 1c: `Command.planTask(taskId:date:from:today:)` leaves
  `from` out when it is nil, `native/Packages/DaythreadCore/Sources/DaythreadCore/Command.swift:54-62`). §12.5 lists it
  as Core work; nothing is built. Task 3 holds it to the web's action through the new shared cases.
- **§12.3's menu example cannot occur.** It lists `Tomorrow · Sat 11/28` and `This weekend · Sat 11/28` together; the
  web's `anotherDayOptions` (`src/components/dates.ts:85-95`) offers `This weekend` Monday to Thursday only and never
  two options for one date. On Thursday Nov 26 the menu is `Tomorrow · Fri 11/27`, `This weekend · Sat 11/28`,
  `Next week · Mon 11/30`, `Pick date…`; on Friday Nov 27 `Tomorrow · Sat 11/28`, `Next week · Mon 11/30`,
  `Pick date…`. The plan follows the code (`RowMenu.anotherDayOptions`, already held to the web's by
  `fixtures/core/rows/another-day.json`).
- **The strip's shared commands are `fixtures/core/facts-actions/`, not `actions/`.** 1c's `RowCommandTests` reads
  every file of `actions/` as a row's command (it counts ten taken cases and needs each one's row intent), so a strip
  case there would break it.
- **The morning's UI tests have a seeded server of their own** (port 3743, Task 8). §12.6 asks for a seed "placed so
  the earlier tests do not meet them"; on the existing server that cannot be: the events line and `Due soon` show
  above today's rows, and every row the existing tests reach would move down by their height.
- **`Due soon` has no fold**, so on a day with many due the page starts below the screen's bottom (§12.1's anti-goal
  says "with no way to fold it"). The strip scrolls away with the header, so the page is reached by scrolling; the web
  has no fold either. Nothing is built for it; Task 8 takes a screenshot with a long `Due soon` for Brian, and §12.6
  already leaves limits to his data.
- **The events line has a chevron only when it is a button** (it scrolls to an `Events` heading). §12.3 says the
  chevron is never cut; with no heading the line is words, and a chevron would say it does something.
- **The strip's height reaches the list through the hosting controller's `preferredContentSize`**
  (`sizingOptions = [.intrinsicContentSize, .preferredContentSize]`, read in
  `preferredContentSizeDidChange(forChildContentContainer:)`), not through `DayHeaderView.onResize`: the header's
  bounds change only after the list has laid it out again, so `onResize` never sees the strip grow first.
- **The strip's hosting controller is a child of the list's controller, not of the day screen** (Task 5). Its view
  lies in the list's header, and UIKit refuses a child whose view is inside another controller's view
  (`UIViewControllerHierarchyInconsistency`: it "should have parent view controller" `DocumentViewController`). The
  day screen adds it to `document` (`document.addChild`) and keeps the model; so
  `preferredContentSizeDidChange(forChildContentContainer:)` reaches the list's controller, which the day screen
  does not override, and the height's changes are read instead from a subclass of the hosting controller
  (`DayFactsHostingController`) that observes its own `preferredContentSize`. The plan's other choice stands: the
  hosting controller's height follows the header's width in the list's self-sizing header (measured at 320, 402 and
  1024 points), so `UIHostingConfiguration` is not needed.
- **The events line takes up to three lines at the accessibility text sizes** (Task 5, Brian's ruling in review).
  §12.3 says it is one line, cut with an ellipsis, `+N more` and the chevron never cut; at
  `accessibilityExtraExtraExtraLarge` on a phone that left one letter of the words (`L… +1 more ›`). From the
  accessibility sizes `+N more` and the chevron go on a line of their own under the words, at the words' leading
  edge (after the symbol's column), so the words have the line's whole width after the symbol and take up to three
  lines, cut at the tail after that; a word that fits on a line is never broken. Below those sizes it is one line,
  `+N more` and the chevron uncut at its end, as §12.3 says. The line is still one button when it is one, and
  VoiceOver's words are unchanged.
- A correction found while building is written here with its reason before the code that follows it.

## Review Focus

1. **The line he types in moves when the strip's height changes**: a `Due soon` row arriving or leaving with a state
   while the keyboard is up, the fold opened, the text size changed, a row leaving `Not today`, the strip appearing
   on a page that had none. His line stays where it is on the screen. Tests in Task 4
   (`a_header_that_grows_keeps_the_typed_line_where_it_is`, `…_that_shrinks_…`) and Task 5
   (`the_line_being_typed_stays_when_the_strip_changes`).
2. **A choice made on a to-do that has changed since the menu or the calendar opened**: brought back on the web,
   ticked, deleted, its title emptied; the screen moved to another day; another account's copy shown. Nothing is sent.
   Tests in Task 6 (`a_choice_made_after_the_to_do_left_the_list_sends_nothing`,
   `a_day_picked_after_the_to_do_left_the_list_sends_nothing`,
   `an_account_change_while_bring_back_waits_shows_nothing`).
3. **The web's words at their edges**: an event's title with a chip, a page link, a link to a page in Trash or gone,
   JavaScript's white space (U+00A0, U+3000, U+FEFF and U+2028 collapse; U+0085 and U+200B do not); one event in two
   lines; a chip on a template, in Trash or on a day's draft; all-day first and ties; a to-do whose title is blank
   only in JavaScript's sense; an `Events` heading with odd spacing or case. Tests in Task 2 (`events_are_the_webs`,
   `headings_are_the_webs`) and Task 3 (`facts_are_the_webs`), against cases Task 1 generates.
4. **A day without its page**: today in Trash, today being made, a past day with no page, a later day with and without
   a page. The strip shows where the web's does, and its actions are disabled or sent with no page to wait for. Tests
   in Task 3 (`a_later_day_without_a_page_has_no_facts`), Task 5 (`the_parts_follow_the_workspace_and_the_day`) and
   Task 6 (`with_todays_page_being_made_bring_back_is_disabled`,
   `with_todays_page_in_trash_bring_back_is_sent_with_no_page_to_wait_for`).
5. **One account's facts under another**: the engine moves to another account's copy, or shows none, while the strip
   shows or an action is out. The strip empties at once and no notice of the first account shows. Tests in Task 5
   (`an_account_change_empties_the_strip`) and Task 6 (`an_account_change_while_bring_back_waits_shows_nothing`).

---

### Task 1: The web's strip as functions the fixtures can run, and the shared cases

This task is its own pull request: it touches `src/` and deploys. The web behaves as before except for the one
visible change named in Global Constraints.

**Files:**
- Create: `src/components/event-words.ts`, `src/components/day-facts.ts`, `src/components/plan-on.ts`,
  `tests/event-words.test.ts`, `tests/day-facts.test.ts`, `tests/plan-on.test.ts`
- Modify: `src/components/facts-strip.tsx`, `src/components/event-rows.tsx`, `src/components/task-row.tsx`,
  `scripts/export-core-fixtures.ts`
- Create (generated): `fixtures/core/events/cases.json`, `events/times.json`, `events/lines.json`,
  `events/headings.json`, `facts/cases.json`, `notices/strip.json`, `facts-actions/*.json`; README regenerated

**What moves where** (an old place that other files import from re-exports the function, so no importer changes;
nothing is copied):

| Function | From | To |
|---|---|---|
| `shortTime(time: string): string` | `event-rows.tsx` (imports React and ProseMirror) | `event-words.ts`; `event-rows.tsx` re-exports it |
| `eventsHeading(doc: readonly EditorNode[]): EditorNode \| undefined` | `event-rows.tsx` | `event-words.ts`; `event-rows.tsx` imports it for `eventsAnchor` and `eventsSection`, and re-exports it |
| `eventsLine(events: DayEvent[]): { text: string; more: string \| null } \| null` (new: `TodayEvents`'s `named`, `parts` and `more`; null for no events) | `facts-strip.tsx` | `event-words.ts`; `TodayEvents` draws its result |
| `dayFacts(view: DayView, workspace: Workspace, date: LocalDate, today: LocalDate): DayFacts \| null` (new: `FactsStrip`'s on-page filter, its tags, the `isToday` gates, `Not today · <N>`, and `DayScreen`'s rule that a later day without a page has no strip: null then) | `facts-strip.tsx`, `day-screen.tsx` (the rule only; `day-screen.tsx` is not edited) | `day-facts.ts`; `FactsStrip` draws its result |
| `planOnAction(taskId: string, date: LocalDate, today: LocalDate, from?: LocalDate): Action` and `planOnNotice(date: LocalDate, today: LocalDate): string` (new: `useTaskActions.planOn`'s action and `text` expressions) | `task-row.tsx` | `plan-on.ts`; `planOn` calls both |

`DayFacts` (exported from `day-facts.ts`):

```ts
export interface FactRow { taskId: string; words: string; tag: string; setAside: boolean }
export interface DayFacts {
  /** Today only. `headingId`: the page's top-level heading titled Events, or null. */
  events: { text: string; more: string | null; headingId: string | null } | null
  /** `view.attention` less every to-do with a row on the page; `tag` is `taskDateTag(t, today, date, plannedOn)`,
   *  and for a to-do set aside `Not today · <tag>`, or `Not today` when that tag is empty. */
  dueSoon: FactRow[]
  /** Today only, when one is set aside: `title` is `Not today · <N>`; each `tag` is
   *  `taskDateTag(t, today, today, plannedOn)`; `setAside` is true. */
  notToday: { title: string; rows: FactRow[] } | null
}
```

`tag` is `''` when there is none (the web hides an empty tag); `words` is the title as stored. `FactsStrip` keeps its
markup and classes (`app-tag quiet` for `setAside` in `Due soon`), drawing from `dayFacts`; `planOnAction` keeps the
web's key order (`type`, `taskId`, `date`, `today`, then `from` when given).

**Interfaces:**
- Produces, for Tasks 2 and 3 (every case built by running the functions above, `dayEvents`, `getDayView` or the
  server's own `applyCommand` through `harness()`, never written by hand; `today` is `2026-11-26`, a Thursday, unless
  a case says otherwise):
  - `events/cases.json`: `[{ name, workspace, day, events, unreadablePageId? }]`, `events` from `dayEvents` as
    `[{ id, title, date, time, line: { pageId, lineId } }]`. Cases: one chip in a line; a chip on the day template, a
    chip on a page in Trash, a chip on a day's draft page (none are events); one `eventId` in two lines on two day
    pages (the newer day's line), on a day page and a document page (the day page's), on two document pages (the first
    in page order); three on one day, `15:00`, none and `10:30` (the untimed first, then by time); two at the same
    time on two pages (the first met first); a title with a chip, a `pageRef` to a live page, one to a page in Trash
    (its title), one to a page that is gone (`''`), a link holding words and a nested chip, and the white space
    `"  a\t　b﻿ c "` (`a b c`) and `"a\u0085b​c"` (kept as is); a chip with no `eventId` beside
    a good one (the line's title reads it as one space; it is no event); a chip on a nested line; a page whose
    document has one node with `"props": 5` and a chip in another line (`unreadablePageId` names that page: the web
    reads the chip, the app reads nothing of that page).
  - `events/times.json`: `[{ time, text }]` from `shortTime` for `00:00`, `00:15`, `01:05`, `09:30`, `11:59`,
    `12:00`, `12:01`, `13:00`, `15:00`, `23:59`.
  - `events/lines.json`: `[{ name, events, line }]` from `eventsLine`: none (`null`); one with no time
    (`Lunch with Kathy · All day`, `more` null); one at `10:30` (`10:30 AM Standup with Lu`); one untitled with no time
    (`Untitled event · All day`); two with no time (no `All day`); two timed; three (`more` `+1 more`); five (`+3 more`).
  - `events/headings.json`: `[{ name, document, headingId }]` from `eventsHeading(JSON.parse(document))`: `Events`;
    ` events ` (matched); `EVENTS`; ` Events ` (matched: JavaScript's `trim`); `Events\u0085` (not);
    `Events:` (not); a paragraph `Events` (not); a heading `Events` nested under a bullet (not: top level only); two
    headings `Events` (the first); a heading holding `Events` and a chip (not: the chip reads as its stored text).
  - `facts/cases.json`: `[{ name, workspace, date, today, facts }]`, `facts` from
    `dayFacts(getDayView(ws, date), ws, date, today)`, `workspace` through `forBrowser`. Cases:
    - `today with all three parts`: an `Events` heading with `Standup with Lu` at `10:30` and `Dentist` at `15:00`
      under it, `Lunch with Kathy` with no time on yesterday's page (`Lunch with Kathy · 10:30 AM Standup with Lu`,
      `+1 more`, the heading's id); in `Due soon`, in the workspace's order: `File the taxes` due today (`Due today`),
      `Send the invoice` due Mon 11/23 (`Was due Mon`), `Start the report` starting today (`Start today`), `Fix the bike`
      set aside and due today (`Not today · Due today`), `Sort the shed` set aside, started 11/20 and planned on
      11/20 (`Not today`); left out: a to-do due today with a row on today's page, one due tomorrow, one done, one
      cancelled, one titled `"　 "`; in `Not today · 3`: `Fix the bike` (`Due today`), `Sort the shed` (`''`),
      `Mend the fence` set aside with no dates and no plan row (`Unscheduled`).
    - `the order is the workspace's`: a to-do made later and due earlier is listed after.
    - `a past day's page` (`2026-11-20`): due 11-19 (`Was due Thu`), due 11-20 (`Due that day`), started 11-20 with
      no plan row (`Unscheduled`); no events and no `Not today` although some are set aside.
    - `a later day's page` (`2026-12-03`): due 12-03 (`Due that day`), due today (`Due today`).
    - `a past day without a page` (`2026-11-24`): `Due soon` with no on-page filter.
    - `a later day without a page` (`2026-12-04`): `null`.
    - `today in Trash`: events with `headingId` null, `Due soon` with no on-page filter, `Not today`.
    - `today with events and no Events heading`: `headingId` null.
    - `nothing to show`: `{ events: null, dueSoon: [], notToday: null }`.
  - `notices/strip.json`: `[{ date, today, text }]` from `planOnNotice`: today (`On today`), `2026-11-27`
    (`Moved to Fri 11/27`), `2026-11-28` (`Moved to Sat 11/28`), `2026-11-30` (`Moved to Mon 11/30`), `2027-01-04`
    (`Moved to Mon 1/4`).
  - `facts-actions/<name>.json`: `{ before, taskId, date, today, action, receipt, after, notice }`: `action` is
    `planOnAction(taskId, date, today)`, applied as is; `after` through `forBrowser` (its Undo marker is
    `{ operationId: "cmd-<name>", revision }`); `notice` is `planOnNotice(date, today)`. Names:
    `bring-back-a-to-do-set-aside` (no row on today's page before; after, not paused and planned today, its new plan
    row at today's insert place), `bring-back-with-a-reference-row-on-today` (that row's block id is now its plan
    row's), `another-day-to-a-day-with-a-page` (`2026-11-28`, a page there), `another-day-to-a-day-without-a-page`
    (`2026-11-30`; `after` holds the new day page).

- [ ] **Step 1: Write the tests** (Node's runner, beside the web's own):
  - `tests/event-words.test.ts`: `shortTime` gives `10:30 AM`, `3 PM`, `12 PM`, `12:15 AM`; `eventsLine` gives
    `null` for none, `{ text: 'Lunch with Kathy · All day', more: null }` for one untimed,
    `{ text: 'Lunch with Kathy · 10:30 AM Standup with Lu', more: '+1 more' }` for three, `Untitled event` for an
    empty title; `eventsHeading` matches ` events ` and `EVENTS` at the top level and not a nested heading or a
    paragraph.
  - `tests/day-facts.test.ts`: on a harness world on `2026-11-26`, `dayFacts` gives the `today with all three parts`
    facts above, word for word; `Not today` (no dot) for a to-do set aside whose tag is empty; no `Not today` part on
    `2026-11-20`; `null` for `2026-12-04` with no page.
  - `tests/plan-on.test.ts`: `JSON.stringify(planOnAction('t', '2026-11-26', '2026-11-26'))` is
    `{"type":"plan-task","taskId":"t","date":"2026-11-26","today":"2026-11-26"}`; with `from` `2026-11-25` the same
    with `"from":"2026-11-25"` last; `planOnNotice` gives `On today` and `Moved to Sat 11/28`.
- [ ] **Step 2:** Move and write out the functions as the table says. `npm test`, `npm run typecheck`. Expected: all
  pass, the web's existing tests unchanged.
- [ ] **Step 3:** Add the areas above to `scripts/export-core-fixtures.ts`. The script asserts: each `facts-actions/`
  case's `after` no longer lists the to-do in `dayFacts(…).notToday` and `before` does; `bring-back-with-a-reference-
  row-on-today`'s plan row keeps that row's block id; `another-day-to-a-day-without-a-page`'s `before` has no page for
  the day and its `after` has one; the `unreadablePageId` case's page has a node the app cannot read (`props` not an
  object). `npm run fixtures`, `node scripts/export-core-fixtures.ts --check`, `npm test`, `npm run typecheck`.
  Expected: all pass.
- [ ] **Step 4: Look**: the web's phone layout (a dev server from this checkout on a port that is not 3000, sign-in
  off, a scratch SQLite file) on a seeded today: the strip reads as before, and a to-do set aside with an empty tag
  reads `Not today` in `Due soon`.
- [ ] **Step 5: Commit** `feat(native): the web's day facts in files the fixtures run; shared cases for the morning`.

### Task 2: Core: events, their titles, the events line and the Events heading

**Files:**
- Create: `native/Packages/DaythreadCore/Sources/DaythreadCore/DayEvent.swift`,
  `…/DaythreadCore/JavaScriptSpace.swift`
- Modify: `…/DaythreadCore/DateMention.swift`, `…/DaythreadCore/InlineText.swift`, `…/DaythreadCore/TodoIndex.swift`
  (`init`, the walk of `rows(in:of:day:)`), `…/DaythreadCore/Days.swift` (`isBlankInJavaScript` reads the shared set)
- Test: `…/DaythreadCoreTests/EventTests.swift`, `…/EventWordsTests.swift`, `Fixtures.swift`

**Interfaces:**
- Consumes: `events/*.json` (Task 1).
- Produces:

```swift
struct DateMention {
  /// The chip's `eventId`, never empty: one event however many lines hold it.
  let eventId: String
  // date, time, init?(_:), text(pageDate:), timeLabel(_:) unchanged
}

/// An event a `@date` chip makes (`DayEvent`, `chip-events.ts`): read from the documents, never stored.
public struct DayEvent: Hashable, Sendable {
  public let id: String
  public let title: String
  public let date: LocalDate
  /// `HH:mm`; nil for an event with no time (all day).
  public let time: String?
  /// The line holding it, on the page it is read from (1d.2's rows link back to it).
  public let pageId: String
  public let lineId: String
}

extension TodoIndex {
  /// `dayEvents`: the day's events, those with no time first, then by time (code units); ties keep the order in
  /// which each event's id was first met walking the live pages in the workspace's order, each page depth first.
  public func events(on day: LocalDate) -> [DayEvent]
}

/// The events line's words (`eventsLine`, `event-words.ts`).
public struct EventsLine: Hashable, Sendable {
  /// The first two events, each `10:30 AM Standup with Lu` (the title alone with no time; `Untitled event` for no
  /// words), joined by ` · `, then ` · All day` when there is exactly one event and it has no time.
  public let text: String
  /// `+N more` past two events; nil otherwise.
  public let more: String?
  /// Nil for no events.
  public static func of(_ events: [DayEvent]) -> EventsLine?
}

public enum EventWords {
  /// `shortTime`: `10:30 AM`, `3 PM`, `12 PM`, `12:15 AM`.
  public static func shortTime(_ time: String) -> String
  /// `eventsHeading`: the id of the first top-level `heading` whose words (`InlineText.plain` with no page date, so a
  /// chip reads with its year) trimmed as JavaScript's `trim` and lower-cased are exactly `events` (code units).
  public static func eventsHeading(in blocks: [Block]) -> String?
}

extension InlineText {
  /// An event's title (`titleOf`, `chip-events.ts`): a string is its own words; in an array, an item of type
  /// `dateMention` (a chip, good or not) is one space, a `pageRef` is `pageTitle(pageId)` (`""` when nil, and when
  /// `pageId` is not a string, where the web would spell a number: corrupt data only), an item with `text` is that text as JavaScript spells it, an item with `content` is
  /// that content read the same way, anything else nothing; then `collapsingJavaScriptSpace`.
  public static func eventTitle(_ content: JSONValue?, pageTitle: (String) -> String?) -> String
  /// Every run of JavaScript's `\s` made one space, then trimmed as `String#trim` trims.
  static func collapsingJavaScriptSpace(_ text: String) -> String
}

/// JavaScript's white space (`\s`, `String#trim`): U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A,
/// U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Not Swift's: U+0085 and U+200B are not in it.
enum JavaScriptSpace {
  static func contains(_ scalar: Unicode.Scalar) -> Bool
}
```

  The index reads chips in the walk it already makes (`isLive` pages only: not in Trash, not the template, not a day's
  draft), from each block's own `content` items (not inside links), at every depth. A holder is kept per event id: a
  later one replaces it only when its page is a day page with a newer date (a page that is not a day page counts as
  the empty date); titles are read after the walk, for the holders kept only, with `pageTitle` the first page of that
  id in the workspace (any page, in Trash or not, as `liveTitle` finds it). A page whose document does not read gives
  no events (`Document.blocks`), where the web reads its good lines: the shared case states the difference.
  `Workspace.isBlankInJavaScript` is rewritten over `JavaScriptSpace`, with no change of behaviour.

- [ ] **Step 1: Write the failing tests.**
  - `EventTests.events_are_the_webs`: for every case of `events/cases.json` without `unreadablePageId`,
    `TodoIndex(workspace).events(on:)` equals `events` (id, title, date, time, page and line, in order).
  - `EventTests.the_app_reads_no_event_of_a_page_it_cannot_read`: for the `unreadablePageId` case, the events equal the
    case's less those whose `line.pageId` is that page.
  - `EventTests.a_chip_with_no_event_id_is_no_event_and_one_space_in_a_title` (the line `["Call", <chip with no
    eventId>, "Lu", <good chip>]` gives one event titled `Call Lu`).
  - `EventTests.javascript_space_is_not_swifts` (`collapsingJavaScriptSpace(" \u{a0}a\t\u{3000}b\u{feff}\u{2028}c ")`
    is `a b c`; `"a\u{85}b\u{200b}c"` is unchanged; `Workspace.isBlankInJavaScript("\u{3000} ")` is true and
    `("\u{85}")` false, as before).
  - `EventTests.a_page_with_a_plan_row_and_a_chip_gives_both` (the to-do's planned day and the event, from one index).
  - `EventWordsTests.times_are_the_webs` over `events/times.json`; `lines_are_the_webs` over `events/lines.json`
    (`EventsLine.of` gives `text` and `more`, nil for the `null` case); `headings_are_the_webs` over
    `events/headings.json` (`EventWords.eventsHeading(in: Document.blocks(document))` equals `headingId`).
- [ ] **Step 2:** `cd native/Packages/DaythreadCore && swift test`. Expected: fail (the new symbols do not exist).
  Commit `test(native): events read from chips, their titles and the events line, as the web reads them (red)`.
- [ ] **Step 3:** Implement. The chips are read from the blocks the walk already has: no second `Document.blocks` of
  any page (the reviewer reads the walk for it). `shortTime` reuses the 12-hour arithmetic `DateMention.timeLabel` has
  (one helper, two spellings: `3pm` and `3 PM`).
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): events from chips, read in the index's pass; the events line and its heading`.

### Task 3: Core: the day's facts

**Files:**
- Create: `native/Packages/DaythreadCore/Sources/DaythreadCore/DayFacts.swift`
- Test: `…/DaythreadCoreTests/DayFactsTests.swift`, `…/FactsActionTests.swift`, `Fixtures.swift`
  (`factsActionNames()`, `factsActionCase(_:)`)

**Interfaces:**
- Consumes: Task 2 (`TodoIndex.events(on:)`, `EventsLine`, `EventWords.eventsHeading`); `DateTag.text`,
  `RowMenu.anotherDayOptions(today:)`, `RowMenu.Group`, `RowMenu.Item`, `RowAction`, `DayWords.shortLabel`,
  `Workspace.dayPage(_:)`, `Command.planTask(taskId:date:from:today:)` (all existing); `facts/cases.json`,
  `notices/strip.json`, `facts-actions/*.json`, `rows/another-day.json`.
- Produces:

```swift
/// What the strip above a day's page shows (`dayFacts`, `src/components/day-facts.ts`), as strings and to-do ids.
public struct DayFacts: Hashable, Sendable {
  public struct Row: Hashable, Sendable {
    public let taskId: String
    /// The to-do's title as stored.
    public let words: String
    /// Nil when the web's tag is empty: the row shows its words alone.
    public let tag: String?
    /// One line for VoiceOver: `File the taxes, Due today`; the words alone with no tag.
    public var spoken: String { get }
    /// The row's menu button, for VoiceOver: `More for Fix the bike`.
    public var menuLabel: String { get }
  }
  public struct NotToday: Hashable, Sendable {
    /// `Not today · 3`
    public let title: String
    public let rows: [Row]
    /// One group titled `Another day`: `Tomorrow · Fri 11/27`, `This weekend · Sat 11/28`, `Next week · Mon 11/30` as
    /// the weekday gives them (`.move(date)`), then `Pick date…` (`.pickDate`).
    public let menu: RowMenu.Group
  }
  /// Today only, when today has an event.
  public let events: EventsLine?
  /// The page's top-level heading titled `Events`, when there are events; nil: the events line is words, not a button.
  public let eventsHeadingId: String?
  /// Every open to-do with words whose Due or Start date is the day or earlier and that has no row (any role) on the
  /// day's live page, in the workspace's order; tagged `DateTag.text(pageDate: day, planned: plannedOn)`, and for a
  /// to-do set aside `Not today · <tag>`, or `Not today` when that tag is empty. Empty: the part is not drawn.
  public let dueSoon: [Row]
  /// Today only, when an open to-do with words is set aside (`paused`); in the workspace's order, tagged
  /// `DateTag.text(pageDate: today, planned: plannedOn)`.
  public let notToday: NotToday?
  public static let none: DayFacts
  /// Nothing to draw: the strip takes no room.
  public var isEmpty: Bool { get }
  /// The facts of `day` as `workspace` draws it (a page draft drawn in, ticks played over it); `index` is of
  /// `workspace`. `.none` for a later day without a live page. A day without a live page (past, or today in Trash or
  /// being made) has `Due soon` with no on-page filter.
  public static func of(day: LocalDate, in workspace: Workspace, index: TodoIndex, today: LocalDate) -> DayFacts
  /// `planOnNotice`: `On today` when `date` is today, else `Moved to Sat 11/28` (the short label: not a row's
  /// `Moved to Sat, Nov 28`).
  public static func planNotice(date: LocalDate, today: LocalDate) -> String
}
```

  "With words" is `!Workspace.isBlankInJavaScript(task.title)`; "open" is `status == .open`; dates compare as
  `LocalDate` (code units, as the web compares strings). The on-page filter reads `index.rows(of:)` for a row whose
  `pageId` is the day page's id by code units; nothing parses a document but the day page's, for its heading.

- [ ] **Step 1: Write the failing tests.**
  - `DayFactsTests.facts_are_the_webs` over every case of `facts/cases.json`: `DayFacts.of` gives `events`
    (`text`, `more`), `eventsHeadingId`, `dueSoon` and `notToday` (`title`, rows) equal to the case's, a `tag` of `''`
    read as nil; a `null` case is `.none`.
  - `DayFactsTests.a_later_day_without_a_page_has_no_facts` (Review Focus 4) and
    `a_later_day_with_a_page_has_due_soon_only`.
  - `DayFactsTests.a_to_do_set_aside_reads_not_today_in_due_soon` (`Not today · Due today`; `Not today` with an empty
    tag; never `Not today · `).
  - `DayFactsTests.a_row_with_an_empty_tag_has_none` (`tag == nil`, `spoken == "Sort the shed"`).
  - `DayFactsTests.a_title_blank_only_in_javascripts_sense_is_not_listed` (`"\u{3000} "` is not listed; `"\u{85}"` is).
  - `DayFactsTests.the_spoken_words` (`File the taxes, Due today`; `More for Fix the bike`).
  - `DayFactsTests.the_another_day_menu_on_each_weekday` over `rows/another-day.json`: `notToday.menu` is titled
    `Another day` and holds `<label> · <shortLabel(date)>` per option, then `Pick date…`, none destructive.
  - `DayFactsTests.the_strips_notices_are_the_webs` over `notices/strip.json`.
  - `FactsActionTests.bring_back_and_another_day_are_written_as_the_web_writes_them`: for every case of
    `facts-actions/`, `JSON.write(Command.planTask(taskId:, date:, from: nil, today:))` equals `JSON.write(action)`,
    and `DayFacts.planNotice` equals `notice`.
  - `FactsActionTests.the_answer_takes_the_to_do_out_of_not_today`: `DayFacts.of(today)` of `before` lists it in
    `notToday`; of `after`, not (with its index); `after.undoMarker` is `cmd-<name>` at `after.revision`.
- [ ] **Step 2:** `swift test`. Expected: fail. Commit `test(native): the day's facts as the web works them out (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` in Core, Sync and Editor. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the day's facts: events, Due soon and Not today as values`.

### Task 4: Editor: scrolling to a row, and the typed line kept when the header changes height

**Files:**
- Modify: `native/Packages/DaythreadEditor/Sources/DaythreadEditor/DocumentViewController.swift` (`headerDidChange`,
  a new `scroll(toRow:animated:)`)
- Test: `native/Packages/DaythreadEditor/Tests/DaythreadEditorTests/HeaderTests.swift` (in the `OnScreen` suite)

**Interfaces:**
- Produces:

```swift
extension DocumentViewController {
  /// Scrolls the list so the row's top is at the top of what the list shows (under its top inset), as far as its
  /// content allows. False, and nothing moves, when the list has no row of that id. `rowID` is a row's id.
  @discardableResult public func scroll(toRow rowID: String, animated: Bool) -> Bool
  /// Lays the header out again after its host changed what it holds or its height changed. While a line holds the
  /// keyboard, the list's offset moves by as much as that line moved, so it stays where it is on the screen (within
  /// the list's top and bottom); otherwise the rows move with the header. Never animated; never reconfigures a row.
  public func headerDidChange()
}
```

  The line's place is read from its cell's frame in the list before the layout is invalidated and after
  `layoutIfNeeded`; the offset is clamped as `revealCaret` clamps it.

- [ ] **Step 1: Write the failing tests** (a page of 60 lines `l1`…`l60`, a header view whose height is a constraint
  the test changes, 390 × 844):
  - `HeaderTests.scroll_to_a_row_puts_it_at_the_top` (`scroll(toRow: "l40", animated: false)` is true; the cell's
    `minY` equals `contentOffset.y + adjustedContentInset.top` within 0.5).
  - `HeaderTests.scroll_to_a_row_near_the_end_stops_at_the_end` (`l60`: the offset is the list's bottom; the row shows).
  - `HeaderTests.scroll_to_a_row_that_is_not_there_does_nothing` (false; the offset unchanged).
  - `HeaderTests.a_header_that_grows_keeps_the_typed_line_where_it_is` (Review Focus 1): the caret in `l30`, the list
    scrolled so it shows; the header from 100 to 300 points, `headerDidChange()`: `l30`'s frame in the window is the
    same within 0.5, it is still first responder, its selected range unchanged.
  - `HeaderTests.a_header_that_shrinks_keeps_the_typed_line_where_it_is` (300 to 100).
  - `HeaderTests.a_header_that_shrinks_with_the_page_at_its_top_leaves_it_at_its_top` (the offset stays at the top).
  - `HeaderTests.without_a_line_typed_in_the_rows_move_with_the_header` (the offset unchanged; `l1` moves by 200).
  - `HeaderTests.a_header_change_while_he_composes_keeps_his_marked_text` (`setMarkedText("今")` in `l30`, then a
    change: the marked range is unchanged and no snapshot was applied).
- [ ] **Step 2:** `cd native/Packages/DaythreadEditor && xcodebuild test -scheme DaythreadEditor -destination
  'platform=iOS Simulator,name=iPhone 17,OS=26.5' -only-testing:DaythreadEditorTests/OnScreen/HeaderTests`. Expected:
  fail. Commit `test(native): scroll to a row; the typed line stays when the header changes height (red)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `swift test` and the package's whole `xcodebuild test`; the Mac Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): scroll to a row; the typed line stays when the header changes height`.

### Task 5: UI: the strip's view in the day's header

**Files:**
- Create: `native/Packages/DaythreadUI/Sources/DaythreadUI/DayFactsView.swift` (`DayFactsModel`, `DayFactsView`),
  `native/Tests/DayScreenFixtures.swift`, `native/Tests/DayFactsViewTests.swift`
- Modify: `…/DaythreadUI/DayHeaderView.swift`, `…/DaythreadUI/DayViewController.swift` (`viewDidLoad`, `showDay`,
  `edit`, `preferredContentSizeDidChange(forChildContentContainer:)`), `native/Tests/RowActionTests.swift` (its
  helpers move out), `docs/design/native-system.md`

**Interfaces:**
- Consumes: `DayFacts`, `EventsLine` (Tasks 2, 3); `scroll(toRow:animated:)`, `headerDidChange()` (Task 4).
- Produces:

```swift
/// What the strip shows and what it was asked; the fold lives here, so a new host keeps it.
@MainActor @Observable
final class DayFactsModel {
  /// Set only through `show`.
  private(set) var facts: DayFacts = .none
  /// The `Not today` fold: closed at first, and closed again whenever the facts have no `Not today` part (he left
  /// today, or the list emptied).
  var notTodayOpen = false
  /// False while an action is out on the screen, or while today's page is being made: every control is disabled.
  var enabled = true
  /// The to-do a strip action is out for: its words in the tertiary colour.
  var acting: String?
  /// Each `Not today` row's menu button, in the hosting view's coordinates, by to-do: where the calendar is anchored.
  private(set) var menuFrames: [String: CGRect] = [:]
  var onEvents: (() -> Void)?
  var onBringBack: ((_ taskId: String) -> Void)?
  var onAnotherDay: ((_ taskId: String, _ date: LocalDate) -> Void)?
  var onPickDate: ((_ taskId: String) -> Void)?
  /// How many times `show` changed `facts` (tests read it).
  private(set) var changes = 0
  /// Takes `facts` when they differ from those shown; returns whether they did.
  @discardableResult func show(_ facts: DayFacts) -> Bool
  /// What the view's controls call, also from tests: each reports only while `enabled`. `choose` reports
  /// `onAnotherDay` for `.move(date)` and `onPickDate` for `.pickDate`.
  func eventsTapped()
  func bringBack(_ taskId: String)
  func choose(_ item: RowMenu.Item, for taskId: String)
}

struct DayFactsView: View {
  let model: DayFactsModel
}

extension DayHeaderView {
  /// Puts `view` under the title's stack, the header's full width inside its margins; hidden, it takes no room.
  func hold(facts view: UIView)
}

// New members of `DayViewController`, internal, read by tests:
//   let factsModel: DayFactsModel
//   var factsView: UIView { get }              // the hosting controller's view
//   private(set) var factsReads = 0            // how many times `DayFacts.of` ran
```

  **The view**, in this order, each absent when the facts have none (the system's parts, configured):
  - The events line: a `Label` with the `calendar` symbol whose title is `events.text` (one line, cut at its tail),
    then `more` and a `chevron.right` that never shrink (`fixedSize`), all in a plain `Button` calling
    `eventsTapped()` when `eventsHeadingId` is set; otherwise the same `Label` and `more`, not a button, no chevron.
    Accessibility: one element, label `text` then `, +N more` when there is `more`, the button trait only as a button.
  - A `GroupBox` titled `Due soon`, one row per `dueSoon` row.
  - A `DisclosureGroup` titled `notToday.title`, `isExpanded` bound to `notTodayOpen`; per row the words and tag, then
    under them a bordered `Button("Bring back")` calling `bringBack` and a `Menu` under the `ellipsis` symbol holding
    one `Section("Another day")` of `notToday.menu`'s items, calling `choose`, labelled `menuLabel`; the menu
    button's frame (`onGeometryChange` in the root's named coordinate space) is recorded in `menuFrames`.
  - A row: `ViewThatFits(in: .horizontal)` of the words then the tag on one line, else the tag under the words; the
    words wrap, the tag is one line (footnote, secondary colour). One accessibility element per row's words and tag,
    labelled `spoken`; the button and the menu are their own. `acting`'s row draws its words in `.tertiary`.
  - `.disabled(!enabled)` on every control. No colour is red. No horizontal padding of its own: the header's margins
    are the rows'.

  **The host**: `UIHostingController(rootView: DayFactsView(model: factsModel))`, a child of the day screen, with
  `sizingOptions = [.intrinsicContentSize, .preferredContentSize]`, `safeAreaRegions = []` and a clear background;
  its view goes to `headerView.hold(facts:)`. `DayHeaderView`'s existing vertical stack (leading-aligned) becomes the
  first arranged subview of an outer vertical stack (`.fill`, `UIStackView.spacingUseSystem`) whose second is the
  strip; the outer stack is pinned to the margins on all four sides (trailing equal, no longer less-than-or-equal), so
  the strip has the full width and the labels keep their own. The strip's view is hidden when `facts.isEmpty`.
  `preferredContentSizeDidChange(forChildContentContainer:)` for the host, and every change of the view's hidden
  state, call `document.headerDidChange()`.

  **The facts**: `showDay` works them out for every content (a page, in Trash, being made, none) with
  `DayFacts.of(day: date, in: source, index: todoIndex(of: source), today: model.today)`, counting `factsReads`, and
  hands them to `factsModel.show`. `source` is the workspace the open page is drawn against (`edit` keeps it: the
  `drawn` workspace while his words stay, `workspace` when the list takes the page), else `model.workspace`. With no
  `model.workspace` (signed out, another account's copy not shown) the facts are `.none`. The events line's
  `eventsTapped` scrolls the list with `document.scroll(toRow: eventsHeadingId, animated: true)` (the tap is wired here;
  its tests are Task 6's).

  `DayScreenFixtures.swift` holds what `RowActionTests.swift` keeps private today, moved and made internal, not copied:
  `line`, `row`, `page`, `task` (gaining `paused: Bool = false` and `start: LocalDate? = nil`), `marker`, `copy`,
  `changes`, `applied`, `savedAs`, `words(of:)`, `soon`, `eventually`, `turns` and `RowScreen` (gaining `facts`, the
  screen's `factsModel`, and `factsView`); and `chip(_ eventId:, on:, at:)`, a `dateMention` inline item.

- [ ] **Step 1: Write the failing tests** (`DayFactsViewTests`, hosted as `RowActionTests` are; today Thursday
  `2026-11-26`; the workspace of Task 1's `today with all three parts` built with the fixtures' helpers):
  - `the_parts_follow_the_workspace_and_the_day` (Review Focus 4): on today, `facts.events?.text ==
    "Lunch with Kathy · 10:30 AM Standup with Lu"`, `more == "+1 more"`, the five `Due soon` rows and
    `Not today · 3`; on yesterday `Due soon` only; on a later day with a page `Due soon` only; on a later day without
    one `factsView.isHidden`; on a past day without a page the strip shows above `No page for …` (the empty state's
    top is under the strip's bottom); on today in Trash and on today being made, the strip shows.
  - `a_load_that_changes_the_facts_redraws_them_and_one_that_does_not_hands_nothing_over` (a load giving a to-do a Due
    date of today adds its row; a load changing a line of the page only leaves `factsModel.changes` as it was).
  - `the_facts_are_not_worked_out_on_a_keystroke` (typing a character in a line and laying out leaves `factsReads` as
    it was until a state arrives).
  - `an_empty_strip_takes_no_room` (the header's height with no facts equals `DayHeaderView`'s without a strip).
  - `the_strip_takes_the_headers_width_inside_the_rows_margins` (at 320, 402 and 1024 points: the strip's frame in the
    header starts at its leading margin and ends at its trailing margin).
  - `the_strips_words_wrap_and_its_height_follows_the_width` (a `Due soon` row of 200 characters: at 320 points
    the strip is taller than at 1024, and the header's supplementary frame is as tall as the header's content).
  - `opening_the_fold_lays_the_header_out_again` (`notTodayOpen = true`: after the run loop turns, the strip and the
    header's supplementary grow by the same amount and the first row moves down by it).
  - `the_line_being_typed_stays_when_the_strip_changes` (Review Focus 1): the caret in a line, a state adds a `Due soon`
    row: the line's frame in the window is unchanged, the keyboard up.
  - `at_the_largest_text_size_the_strip_grows_and_keeps_its_width` (`accessibilityExtraExtraExtraLarge`: taller; the
    strip's width is still the margins').
  - `the_fold_is_closed_at_first_and_forgotten_off_today` (opened, then yesterday, then today: closed; opened, then
    the last to-do set aside brought back by a load: closed).
  - `the_fold_survives_a_new_host` (a second `UIHostingController` of the same model keeps `notTodayOpen` and its
    height).
  - `an_account_change_empties_the_strip` (Review Focus 5): a state with no workspace (another account's copy):
    `facts == .none`, the strip hidden; then that account's workspace: its own facts.
  - `the_controls_report_only_while_enabled` (`enabled = false`: `bringBack`, `choose`, `eventsTapped` report nothing).
- [ ] **Step 2:** The app's unit tests: `xcodebuild test -project native/Daythread.xcodeproj -scheme Daythread
  -only-testing:DaythreadTests/DayFactsViewTests -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5'
  -derivedDataPath native/DerivedData`. Expected: fail. Commit `test(native): the strip of facts in the day's header (red)`.
- [ ] **Step 3:** Implement. If `the_strips_words_wrap_and_its_height_follows_the_width` cannot pass with the hosting
  controller's view, stop and report (Open question 1). Add to `native-system.md`: `Due soon`; `Not today · 3`; the
  events line (`10:30 AM Standup with Lu`, `Untitled event`, ` · All day`, `+1 more`, the `calendar` symbol, the
  chevron only as a button) with its VoiceOver words; the tags of the strip (`Due today`, `Was due Mon`,
  `Start today`, `Due that day`, `Unscheduled`, `Not today · Due today`, `Not today`), and that none is red; the strip
  itself under "Views built because the system has none" as the SwiftUI parts it configures.
- [ ] **Step 4:** The app's unit tests in full (`RowActionTests` must pass unchanged after its helpers moved); the Mac
  Catalyst build. Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the strip of facts above the page: events, Due soon, Not today`.

### Task 6: UI: the strip's actions, one action at a time for the screen

**Files:**
- Modify: `native/Packages/DaythreadUI/Sources/DaythreadUI/AppModel.swift`, `…/DaythreadUI/DayViewController.swift`
  (`acting` and `Acted` become the origin, `rowRequested`, `run`, `undo`, the strip's actions),
  `docs/design/native-system.md`
- Test: `native/Tests/DayFactsActionTests.swift`

**Interfaces:**
- Consumes: Tasks 3 and 5; `RowActed`, `Notice`, `NoticeView`, `DayPickerViewController(selected:notBefore:written:
  weekStartsOnMonday:timezone:onPick:)`, `offersUndo(_:)` (all existing).
- Produces:

```swift
extension AppModel {
  /// §12.4: plans a to-do that is not a row of the page shown (`plan-task` with no `from`): the strip's `Bring back`
  /// and `Another day`, and 1d.2's `N more open`. As `act`: his words handed over first, then the command sent and
  /// waited for, `pageId` not overtaken (nil: no page to wait for); returns once a state holding the answer has
  /// arrived. `notice` is the words of a done answer. `.notDone` when the to-do is not in the workspace, for another
  /// owner, or when it fails, is refused or is not sent.
  public func plan(_ taskId: String, on date: LocalDate, notOvertaking pageId: String?, owner: String, notice: String)
    async -> RowActed
  /// As before; `pageId` nil for an action that had no page to wait for.
  func undo(_ operationId: String, pageId: String?, owner: String) async -> Notice
}

/// Where the action out on the day screen came from (§12.4): what is dimmed, and what its notice's Undo dims again.
enum ActionOrigin: Equatable {
  case row(String)              // the row's id
  case strip(taskId: String)
}
```

  In `DayViewController`, `acting: Bool` becomes `actionOut: ActionOrigin?`, and `Acted` carries `origin` in place of
  `rowID` and an optional `pageId`. Setting `actionOut` sets `document.actingRow` (for `.row`), `factsModel.acting`
  (for `.strip`), and `factsModel.enabled` (`actionOut == nil` and the content is not `.askingForToday`); `showDay`
  sets `enabled` too. `rowRequested`, `run` and `undo` check `actionOut == nil` where they checked `!acting`.

  **A strip action** (`Bring back`: today; a day of `Another day`: that day; a day picked: that day), on today's
  screen only:
  nothing while an action is out or something is presented; the to-do must still be a row of `DayFacts.of(…)`'s
  `notToday` worked out now (the same source as `showDay`), and the day not before today. Then
  `document.commitComposition()`, `actionOut = .strip(taskId:)`, the old notice's Undo withdrawn, and
  `model.plan(taskId, on: day, notOvertaking: <today's page id when the content is .page, else nil>, owner:
  model.state.owner, notice: DayFacts.planNotice(date: day, today: model.today))`. The answer is said as `run` says
  it, only while the screen still shows today under that owner; its `Acted` origin is the strip. `onPickDate` presents
  the calendar `presentDatePicker` presents (nothing selected, no day before today; today selectable) as a popover whose
  `sourceView` is the strip's view and `sourceRect` its `menuFrames[taskId]`, a sheet on the phone. `Undo` of a strip
  action dims that to-do's row again while it is out if the to-do is in the list, and sends with no page when none.

- [ ] **Step 1: Write the failing tests** (`DayFactsActionTests`, hosted, the test server whose replies the test
  releases; the clock at `2026-11-26T12:00:00Z`; `Fix the bike` (`t-aside`) set aside on a Thursday; a tap is the
  model's call the view's control makes):
  - `bring_back_waits_for_unsaved_words_then_sends_plan_task_without_from`: type in a line, `bringBack("t-aside")`:
    the server gets the save, then exactly `{"type":"plan-task","taskId":"t-aside","date":"2026-11-26",
    "today":"2026-11-26"}`; the notice `On today` with `Undo`.
  - `another_day_sends_that_day_and_says_the_short_form`: `choose(This weekend · Sat 11/28)`: `"date":"2026-11-28"`, no
    `from`; `Moved to Sat 11/28` with `Undo`.
  - `pick_date_opens_the_calendar_from_the_menus_button` (a `DayPickerViewController`, nothing selected, no day before
    today; its popover's `sourceView` is the strip's view and `sourceRect` the row's menu frame).
  - `a_day_picked_moves_the_to_do_there_and_today_brings_it_back` (`2026-11-30`: `Moved to Mon 11/30`; today:
    `"date":"2026-11-26"`, `On today`).
  - `a_choice_made_after_the_to_do_left_the_list_sends_nothing` (Review Focus 2): the menu's item chosen after a load
    in which it was brought back elsewhere, ticked, or deleted: no command.
  - `a_day_picked_after_the_to_do_left_the_list_sends_nothing` (Review Focus 2): the calendar open, the load, the pick.
  - `the_row_leaves_when_the_state_holding_the_answer_arrives` (the `StateRelay` holding the states: the answer first,
    the row still listed and dimmed; the state: the row gone, `Not today · N` one less; the last one gone, the part
    and the fold closed).
  - `a_failure_changes_nothing_and_says_so` (refused, and offline: `Not done · your text is kept`, no `Undo`, still
    listed, enabled again).
  - `undo_brings_the_to_do_back_to_the_list` (`Undone`; the server got `undo` of that operation; listed again).
  - `undo_leaves_the_notice_when_he_types` (the words stay; the button goes).
  - `one_action_at_a_time_across_the_strip_and_the_rows`: a row's action out: `factsModel.enabled` is false and
    `bringBack` sends nothing; a strip action out: `acting == "t-aside"`, a swipe's action on a row sends nothing,
    typing and ticking go on.
  - `with_todays_page_being_made_bring_back_is_disabled` (Review Focus 4; `.askingForToday`: `enabled` false).
  - `with_todays_page_in_trash_bring_back_is_sent_with_no_page_to_wait_for` (Review Focus 4; a draft-free screen in
    Trash: the command is sent, `On today`).
  - `an_account_change_while_bring_back_waits_shows_nothing` (Review Focus 5): the reply held, a load under another
    owner, the reply: no notice, nothing dimmed.
  - `leaving_today_while_bring_back_is_out_says_nothing_there`.
  - `the_events_line_scrolls_to_the_events_heading` (`eventsTapped()`: the heading's row at the top of what the list
    shows); `with_no_events_heading_the_events_line_is_not_a_button` (`eventsHeadingId == nil`; `eventsTapped`
    scrolls nothing).
- [ ] **Step 2:** The app unit test command of Task 5, `-only-testing:DaythreadTests/DayFactsActionTests`. Expected:
  fail. Commit `test(native): bring back and another day from the strip, with the notice and Undo (red)`.
- [ ] **Step 3:** Implement. Add to `native-system.md`: `Bring back` (bordered, under the row's words), the menu
  (`ellipsis`, VoiceOver `More for <words>`) with its group `Another day` and items `Tomorrow · Fri 11/27`,
  `This weekend · Sat 11/28`, `Next week · Mon 11/30`, `Pick date…`, the calendar from the menu's button, and the
  notices `On today` and `Moved to Sat 11/28` (the short form; a row's says `Moved to Sat, Nov 28`), each with `Undo`.
- [ ] **Step 4:** The app's unit tests in full (`RowActionTests` unchanged and passing); the Mac Catalyst build.
  Expected: pass.
- [ ] **Step 5: Commit** `feat(native): the strip's actions, sent and waited for, one action at a time for the screen`.

### Task 7: The cost of the facts

A measurement, not a budget (§12.6); no red commit.

**Files:**
- Modify: `native/Tests/TypingFeelTests.swift`, `native/README.md` (how to read the numbers),
  `docs/plan/native-phase-1d.md` ("Cost, measured")

**Interfaces:**
- Consumes: `TodoIndex`, `DayFacts.of` (Tasks 2, 3); the day screen of Task 5.

- [ ] **Step 1:** Add `test_the_strips_facts_on_a_large_workspace`: a workspace of 3,000 to-dos on 300 day pages (10
  rows a day), 200 lines holding one chip each (spread over those pages, 3 dated today), 100 to-dos set aside, 100 due
  on or before today with no row today; today `2026-11-25`, UTC. Five runs, each timing `TodoIndex(workspace)` and
  then `DayFacts.of(day: today, …)`; it prints `TypingFeel: facts index <ms> facts <ms>` per run and the medians, and
  asserts only that the facts hold 100 `Not today` rows and 100 `Due soon` rows.
- [ ] **Step 2:** The typing fixture (`model(page:)`) gains the strip: of its past to-dos 100 are set aside and 100 are
  due on `2026-11-24`, and its past pages hold 200 chip lines (2 dated today), so the two typing tests type with the
  strip on screen. The lines typed into, and what the tests assert, are unchanged.
- [ ] **Step 3:** Run `TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test … -only-testing:DaythreadTests/TypingFeelTests`
  (the README's command). Expected: the two typing tests within their budget; the numbers printed. If they are not,
  stop and report: the remedy in §12.6 (keep each page's part of the index between states) is a design decision.
- [ ] **Step 4:** Write the medians under "Cost, measured" at the end of this plan, with the machine and the date.
  Commit `test(native): the cost of the day's facts, measured`.

### Task 8: On the simulator, and the record

**Files:**
- Modify: `native/scripts/ui-test.sh` (a third server, seeded), `native/UITests/Launch.swift`, `native/README.md`,
  `docs/plan/native-parity.md`, `docs/design/native-system.md`, `docs/plan/native-phase-1d.md` (status), `PRODUCT.md`
- Create: `native/UITests/MorningUITests.swift`, `tests/evidence/native-phase-1d/*.png`

**The morning's server**: `morning_port=3743`, started and checked as the other two (`start morning $morning_port
DAYTHREAD_AUTH=off`, `wait_for $morning_port 200`, the port free first), passed to the runner as
`TEST_RUNNER_DAYTHREAD_MORNING_SERVER_URL`; `--serve` serves it too; the script's header comment names it. Its seed,
a second node script run from the repository root (so it can import `pageContentKey` from
`src/domain/editor-document.ts`), on the server's own commands (`/api/v1/commands`, and `/api/v1/saves` for
`save-editor` with `expectedContent` the page's `pageContentKey`):
- `ensure-day` for today and yesterday.
- Today's page saved once with, after its template's blocks, a heading `Events` and two bullets: `Standup with Lu `
  then a chip of today at `10:30`, and `Dentist ` then a chip of today at `15:00`; yesterday's page saved with a line
  `Lunch with Kathy ` and a chip of today with no time. (Events line: `Lunch with Kathy · 10:30 AM Standup with Lu`,
  `+1 more`.)
- On yesterday's page: `add-task` `Pay the gas bill` with `deadlineOn` today (`Due today`), `Start the essay` with
  `attentionOn` today (`Start today`), and `Call the insurance company about the claim from last spring` with
  `deadlineOn` today (its tag goes under its words on a phone).
- On today's page: `add-task` `Fix the bike` planned today, then `not-today` with today: set aside (`Not today · 1`;
  tag `Unscheduled`); `Bring me back later` the same, for the Undo test; `Plan me for later` the same, for Another day.
  (`Not today · 3`.)
- `MorningUITests` reads its server with `Wrapper.value("DAYTHREAD_MORNING_SERVER_URL")`; `SeededServer` gains
  `paused(_ title:)`.

- [ ] **Step 1: Write the failing UI tests** (expected words computed from `Wrapper.today()` with an `en_US_POSIX`
  formatter in UTC):
  - `test_the_three_parts_show_on_today`: the events line's element reads `Lunch with Kathy · 10:30 AM Standup with
    Lu, +1 more`; the `Due soon` rows `Pay the gas bill, Due today`, `Start the essay, Start today`; `Not today · 3`.
  - `test_the_events_line_scrolls_to_the_events_heading` (after the tap the `Events` heading's line is at the top).
  - `test_a_long_title_puts_its_tag_under_it` (the tag's frame starts under the words' frame).
  - `test_bring_back`: open `Not today · 3`, `Bring back` on `Fix the bike`: `On today`; its row on today's page;
    on the server not paused and planned today.
  - `test_undo_a_bring_back`: `Bring back` on `Bring me back later`, then the notice's `Undo`: `Undone`; paused again
    on the server and listed again.
  - `test_another_day`: `More for Plan me for later`, `Tomorrow · <short label>`: `Moved to <short label>`; on the
    server planned tomorrow.
  - `test_yesterday_shows_due_soon_only` (no events line, no `Not today`).
- [ ] **Step 2:** `native/scripts/ui-test.sh -only-testing:DaythreadUITests/MorningUITests`. Expected: fail. Commit
  `test(native): the morning on the simulator (red)`.
- [ ] **Step 3:** Make them pass; a defect found in an earlier task's code is fixed with its own failing unit test
  first. Then `native/scripts/ui-test.sh` in full: every earlier UI test passes unchanged; `TypingFeelTests` within its
  budget.
- [ ] **Step 4:** Screenshots on the seeded data into `tests/evidence/native-phase-1d/`: today with the three parts
  (light, dark, the largest text size, landscape), `Not today` open, the menu open, the calendar from the menu, the
  notice `On today` with `Undo`, `Not done · your text is kept`, a past day's `Due soon`, and today with twenty
  `Due soon` rows (the page below the screen's bottom: for Brian's call, see Corrections). Look at each.
- [ ] **Step 5:** Update the documents: every string of 1d.1 in `native-system.md` (checked against §12.2 to §12.4);
  `native-parity.md` (the strip: events line, `Due soon`, `Not today` with `Bring back` and `Another day`; the command
  the app now sends from it, `plan-task` with no `from`, `readsBeyond: true`; and where the app differs from the web:
  the events rows under `Events` absent, a tap on the events line without an `Events` heading does nothing, the
  web's screen for a later day without a page absent, these actions not drawn ahead and so needing a connection,
  "today" the account's day); `PRODUCT.md`; the README (the third server; the cost numbers); this plan's status.
  Commit `docs(native): what phase 1d.1 holds, with screenshots`.

### Task 9: On his data

Nothing in this task is code, and Brian does the tapping: the app writes to his real workspace.

- [ ] A Debug build on the simulator or his phone against production, signed in by him. On his real today, the strip
  against the web's phone layout side by side: the events line's words and `+N more`, each `Due soon` row and its
  tag, `Not today · N` and each row's tag. On a past day and a later day with a page, `Due soon`.
- [ ] `Bring back` on a to-do of his choosing: on the web, it is on today's page after a reload; `Undo` from the
  notice: set aside again on the web. A day from `Another day`, and one from `Pick date…`, each seen on the web.
- [ ] By hand, what no test drives: VoiceOver reading the events line, a `Due soon` row and a `Not today` row with its
  button and menu; the strip at his text size; typing in a line while a load changes `Due soon` (his line stays put).
- [ ] The length of his `Due soon` and `Not today`, and the cost line the Debug build logs for his workspace, against
  "Cost, measured": whether either list needs a limit or a fold, and whether the index needs the §12.6 remedy, decided
  then. Record the results here and set the status line.

## Order and independence

- Task 1 first, alone, as its own pull request: the cases every Core test fails against. It touches `src/` and
  deploys on merge.
- Tasks 2 and 3 are Core, in order (3 reads 2's events and line).
- Task 4 needs nothing of the Core tasks and can be built beside them.
- Task 5 needs 3 and 4. Task 6 needs 5. Task 7 needs 3 for its measurement and 5 for the strip on screen; it can be
  built beside 6. Task 8 needs all. Task 9 is his.
- Two pull requests: Task 1 alone, then Tasks 2 to 8.
- Departures from the task list this plan was written from: the test helpers of `RowActionTests.swift` move to a
  shared file in Task 5, the first task that needs them in a second file; the strip's shared commands are their own
  folder (Corrections); the morning's UI tests have their own seeded server (Corrections); `Command.planTask` needs no
  change (Corrections); the Events heading rule is Task 2's, beside the events, since `DayFacts` only reads it.

## Cost, measured

Measured 2026-11-27 on an Apple M4 Mac (macOS 27.0.1, Xcode 27.2), the iPhone 17 simulator on iOS 26.5, a Debug
build, `TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test ... -only-testing:DaythreadTests/TypingFeelTests` (the
README's command), nothing else running (`pgrep -fl xcodebuild` empty before each run). Each figure is the median of a
run's five inner runs; the spread is the lowest and highest of the invocations.

The facts on a large workspace (`test_the_strips_facts_on_a_large_workspace`: 3,000 to-dos on 300 day pages of 10
rows, 200 chips, 100 set aside, 100 due with no row today), milliseconds, five invocations:

| | medians per invocation | spread |
|---|---|---|
| `TodoIndex(workspace)` | 56.905, 57.162, 54.225, 55.450, 53.773 | 53.8 to 57.2 |
| `DayFacts.of(day: today, ...)` | 3.617, 3.403, 3.426, 3.382, 3.278 | 3.3 to 3.6 |

The index is about 55 ms on a workspace of this size (300 pages), nearly all of a state's cost for the facts: it parses
every page's document. Whether the strip adds it depends on the path the state takes in the day screen (`showDay`,
`drawnWith`, `DayViewController.todoIndex(of:)`). While his words stay on the page (the typing path), the screen's
`ListReading` of the drawn workspace has already built its index, and the facts take it from the screen's two-slot
cache: there the index is not the strip's addition, and what the strip adds is `DayFacts.of` itself, about 3.4 ms, and
the strip's drawing (below). When the list takes the page as the server has it, when another page is opened, and on a
day with no page, nothing on the screen has read that workspace yet: the facts build a whole index for it, about 55 ms a
state on this workspace in Debug, which the typing figures below do not show. The editor builds its own index of the
same workspace for the rows it draws (`DocumentViewController`'s `TodoIndex`); sharing one index between the editor and
the screen is a follow-up for slice 1d.2. The typing fixture is not this workspace: it holds the same 3,000 to-dos on
about 30 pages.

Typing with the strip on screen (100 set aside, 100 due, 200 chips on the past pages), milliseconds per keystroke to
the list laid out, five invocations (the budget's figures, 7.040 and 2.671, were measured before slice 1c made the
fixture heavier; the limit is 1.5 times them, 10.56 and 4.01):

| | medians per invocation | spread |
|---|---|---|
| 300 lines, line 150 | 9.472, 9.291, 9.274, 9.298, 9.377 | 9.27 to 9.47 |
| 10 lines, line 5 | 3.287, 3.278, 3.248, 3.344, 3.349 | 3.25 to 3.35 |

The same, before the fixture gained the strip (this branch's base, three invocations): 300 lines 9.973, 9.301,
9.373; 10 lines 3.651, 3.181, 3.197. The keystroke's own cost is unchanged within the noise.

Per keystroke to the engine's state drawn (not budgeted), where the strip's cost shows, milliseconds:

| | before the strip | with the strip |
|---|---|---|
| 300 lines | 164.089, 159.142, 159.443 | 170.317, 173.486, 175.487, 174.158, 171.303 |
| 10 lines | 87.185, 83.644, 82.977 | 88.475, 88.817, 89.035, 89.555, 89.623 |

So the strip costs about 14 ms a state on the 300-line page (about 160 to about 173) and about 6 ms on the 10-line one
(about 84 to about 89): the facts' 3.4 ms, the index now holding 200 chips, and the strip's rows being drawn. Both
typing tests held their budget (the 300-line median is about 89 percent of its limit, the 10-line one 82 percent). The remedy
of §12.6 (keeping each page's part of the index between states) was not needed on the typing path; that is a conclusion
about the typing path only, not about the paths above where the facts build an index of their own.

A reading for the budget: on this machine the 300-line median is 9.27 to 9.47 ms against a limit of 10.56 ms derived
from a fixture that was lighter, so the margin is about 10 to 12 percent; runs on the same machine while other builds ran
have read up to 10.3. The limit was not changed.
