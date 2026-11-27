# Native app, phase 1: the day

- Author: Claude · 2026-11-25 · status: **written on Brian's word to go on ("进入下个 phase 好吗？主动一点", 2026-11-25).
  He approved the phase and what it holds in `docs/design/native-app.md` §10; the cut into slices and every call
  marked "my call" below are mine, and he has not read this document.** Building starts with slice 1a.
- Parent: `docs/design/native-app.md` (the app's design). This document does not repeat it. Where the two differ,
  this one is newer and says so.
- Facts about the web app and the app as built were read from the code at `6a29b4c8`, not from documents.

## 1. What phase 1 is for

"He opens and closes his day in the app for seven days in a row without opening the web app for day work"
(`native-app.md` §10). Phase 0 shows today's page and nothing can be changed. Phase 1 is everything between that
and the sentence above, and it is too large for one plan.

## 2. The slices

Each slice is planned, built, reviewed and merged on its own, and each ends with something he can use on the
simulator or his phone. The order is mine: first what makes the app answer a tap, then the heart of it (writing),
then what surrounds the day.

| Slice | Holds | He can then |
|---|---|---|
| **1a. Tick, and other days** | A tick drawn at once and kept through offline and a relaunch; what happens when the server holds a change; moving to another day | Tick his to-dos and read any day |
| **1b. Writing** | Text in a cell: typing, Return, Backspace, lists, headings, a new to-do row, Chinese input. The save path: the draft on the device, `save-editor`, and what he sees when the server refuses a save | Write his day |
| **1c. The to-do row** | What a row shows beside its words (due and start dates, "Since", the repeat mark, Reference, Moved to, Blocked by) and its menu (Move, Bring to today, Not today, Cancel, Restore, dates). The notice that carries Undo | Manage a to-do without leaving the page |
| **1d. The morning** | The day draft as bands on today's page (`POST /api/v1/day-draft`, the draft's commands), the Not today list, events and Due soon above the page | Start his day in the app |
| **1e. Tasks, Upcoming, Calendar** | The three screens and the system tab bar that holds them | Plan beyond today |
| **1f. Chips, menus, moving lines** | `@date` chips drawn and made, the `/` and `@` lists, the formatting bar, drag to move lines | Write as he does on the web |
| **1g. The day keeps running** | Reminders scheduled on the device; `run-repeats` on opening | Stop opening the web app |

- 1a is designed in §3 to §8 and 1b in §10. Each later slice gets its own section in this document when its turn
  comes, written against what the earlier slices built, as phase 1 was written against phase 0.
- 1b follows 1a whatever happens. The order after 1b is looked at again then.
- **Changed from `native-app.md`:** it lists Tomorrow in phase 1. The web's Tomorrow block is gone (B76); the day
  draft reads the template's own "Tomorrow" section. Nothing called Tomorrow is built.
- **The tab bar waits for 1e.** A bar whose other tabs are empty would be a control that does nothing.

## 3. Slice 1a: goals, non-goals, anti-goals

**Goals**

1. A tap on a to-do's circle changes it in the frame it is tapped, with a haptic. Nothing waits on the network.
2. A tick made offline is still drawn after the app is quit and opened again, and is sent when the server can be
   reached, without him doing anything.
3. When the server will not apply a change, he is told which one and why, and chooses what happens to it. No change
   disappears silently.
4. He can move to the day before, the day after, any day from a calendar, and back to today.

**Non-goals**

- Cancelling a to-do, its dates, its menu, and Undo (1c). Editing any text (1b).
- A tab bar, and anything on Tasks or the Calendar (1e).
- The next to-do of a repeating to-do drawn before the server makes it (§4).

**Anti-goals**

- A tick that shows unticked for a moment, then ticked.
- A tick that the app shows as done and the server never received, with nothing on screen saying so.
- A second copy of the workspace on the device that can disagree with the first.

## 4. The rules: what the app predicts

**The command.** A tap sends `{ "type": "task-status", "taskId": …, "status": "done" | "open", "today": … }`, the
web's action (`src/domain/types.ts`). A tap on a done to-do sends `open`; on anything else, `done`. A cancelled
to-do's circle is disabled, and a row whose to-do the copy does not hold does nothing, as on the web. `today` is the account's day (the day the app's Today shows), so a tick
at 00:30 in his zone is dated the day his page says it is. The web sends the device's date; the two differ only
when the device is in another zone than the account. My call.

**What the app predicts** is exactly what the server always does for this command (`applyCommand`,
`src/domain/workspace.ts`): on the task row, `status` becomes the new status, `doneOn` becomes `today` when the
status is `done` and otherwise `null`, and `version` goes up by one. Nothing else: not the revision, the receipt or
the Undo slot.

**What it does not predict:** a repeating to-do's next one (a new task, a line on another day's page, the repeat
record), taking that next one back on reopening, and anything a To-dos rule does. The server's reply brings those.
A repeating to-do ticked offline shows as done and its next one appears when the tick is sent. This is the partial
prediction of `native-app.md` §6.

**A command the app cannot predict** (`ensure-day`, `restore-batch`, any it does not know) changes nothing on screen
until the server answers.

**In `DaythreadCore`:**

- `Command` makes the actions as JSON values (`Command.taskStatus(taskId:status:today:)`, `Command.ensureDay(_:)`,
  `Command.restoreBatch(trashId:)`).
- `Workspace.predicting(_ action: JSONValue) -> Workspace` returns the workspace with the predicted rows changed,
  and the same workspace for an action it does not predict or that does not apply (the task is not there).
- `TodoTask.Status` gains `other(String)`: a status this build does not know is kept as written, drawn as an open
  to-do whose circle is disabled, and no longer makes the whole workspace unreadable (carried from phase 0).

**Shared cases.** A new area, `fixtures/core/commands/*.json`, written by `scripts/export-core-fixtures.ts`:

```json
{ "before": <workspace as the browser gets it>, "action": { … }, "rows": { "tasks": ["<task id>"] },
  "after": <the same after the server applied it> }
```

`rows` names the rows the prediction claims. The Swift test holds `before.predicting(action)` to two things: each
named row equals the row in `after`, as JSON text; every other page and task equals `before`. Cases: open to done,
done to open, open to open (only `version` moves), a status of `cancelled` with `today` (`doneOn` stays `null`), a
task that is not there (no rows), and a repeating to-do ticked (the ticked row is claimed; the next to-do in
`after` is not). The last case is the test of "partial".

**`readsBeyond`** is `false` for `task-status` and `true` for everything else the app sends. A tick reads nothing
beyond its row; if a rule fires on it while another device has changed something, the server itself holds it
(`sqlite-repository.ts`, the `rows` rule). Phase 0 sent `true` for everything.

## 5. The engine: one copy, and what is drawn

**One copy, as now.** The engine's copy stays what the server last sent, in memory and in the store. Nothing
predicted is ever stored.

**What is drawn is derived.** `SyncState.workspace` becomes: the server's copy with every pending entry's action
replayed over it through `predicting`, in the order they were made. It is worked out again whenever the copy or the
outbox changes. A held entry is left out, so the page shows what the server has. Because the outbox is stored, the
same derivation after a relaunch draws an offline tick again. This is the web's `predicted()`.

**The frame of the tap.** The engine is an actor and its store writes to disk, so its answer cannot be in the same
frame. `AppModel` therefore keeps the actions it has handed to the engine and not yet seen come back, and what the
screens read is the engine's workspace with those replayed on top, on the main actor, at once:

- `AppModel.tick(taskId:)` works out the status to send from what is drawn now, records the action, plays the
  haptic, and calls `engine.enqueue`.
- `enqueue` returns as soon as the entry is stored and a state containing it has been published. It no longer
  waits for the server. It returns a ticket: a count the engine keeps in memory for its lifetime, one higher for
  each entry accepted, never reset (an entry's stored number restarts when the store is erased, so it cannot serve).
  Every `SyncState` carries the highest ticket given (`enqueued`). `AppModel` drops its own record of an action
  once it knows the ticket and has seen a state with `enqueued` at or past it; it checks both when a state arrives
  and when `enqueue` returns, since either can come first. So there is no moment with the prediction in neither
  place, and none where a record outlives its entry.
- If `enqueue` throws, the entry was not stored: the record is dropped and the circle shows what the copy has.
- Signing out or in drops every record.
- A second tap on the same to-do within 500 ms is dropped, the web's guard against a double tap.

**Sending.** One pass at a time, as now. New in 1a:

- After a pass that ends with an entry it could have sent still pending, for any reason but being signed out
  (no connection, a 5xx, a 429), the engine tries again after 2 s, 5 s, 15 s, then every 30 s (the web's schedule;
  a 429's own wait is used when it is longer), and at once when the system reports the network is back
  (`NWPathMonitor`, from Apple's Network framework). It stops when no entry is left that it could send.
- A `task-status` for a to-do is not sent while an earlier entry for the same to-do is held. Such an entry is
  waiting, not pending: it does not keep the retries going and is not counted in "will be sent". Later slices
  widen this to the web's rule for any two entries that touch the same thing.
- **The only `ensure-day` in the outbox is the engine's own**, for today (the buttons of §6 do not use the
  outbox). A held one is removed, as the web removes its app writes, and asked again after the next load if today
  still has no page. Held `ensure-day` entries left in a store by phase 0 are removed the same way at start.
  Carried from phase 0.
- A launch runs one pass, not two, and a launch with no session logs it at the default level, once. Carried.

**A held change.** `SyncState.held` becomes a list: for each held entry its number, its label, and why. The
server's own reasons are `conflict`, `changed-since` and `maybe-applied`; a refusal's message is sorted into
`gone`, `conflict` or `refused` by the web's patterns (`sendOutbox` in `use-day.tsx`); a 400, and any reason a
phase 0 store holds that is none of these, reads as `refused`. `SyncState` also carries how many entries are
pending and how many are waiting behind a held one. Two new calls: `keep(_ number:)` puts the entry back as
pending on the copy's current revision with no revisions of its own (the web's Keep mine), and
`discard(_ number:)` removes it.

**After the server holds a change, the engine loads the workspace once** in the same pass, before anything else is
sent. The server holding it means the copy is behind, so without the load the page would show what was last loaded,
not what the server has, and Keep mine would be sent on the same old revision and held again. (Found by the review
of the whole slice, 2026-11-25.)

**Merging, not overwriting (Brian, 2026-11-26).** "不是直接覆盖 server data，你要看在离线期间有没有新的本地内容，进行交叉合并."
Neither side replaces the other. What he changed on the device while the server was out of reach is put together
with what changed on the server, by the app, without asking; he is asked only when both changed the same thing in
two different ways. This is a rule for every slice, and it differs from the web, whose Keep mine "is never
automatic" (`outbox.md` §8.3).

- It already holds between rows: a change made offline is sent on the revision it was made on, and the server
  applies it over whatever else changed, unless someone changed the same row.
- For the same row, the app now settles it. When the server holds a tick because the to-do changed elsewhere
  (`conflict` or `changed-since`), the engine loads, as above, and looks at the to-do as the server has it:

  | The to-do on the server | The app |
  |---|---|
  | Already has the status he tapped | Drops his change; there is nothing left to do |
  | Still has the status he tapped it from (so something else about it changed: its words, a date) | Sends his tick again on the loaded revision, once. His status and their change both stand |
  | Has a third status (he ticked it, someone cancelled it) | Holds it and asks, with the menu of §7. This is the one case with no right answer |
  | Is gone | Holds it, with Discard only, as now |

  The status he tapped from is read from the tap itself: a tick to done came from a to-do that was not done, a
  tick to open from one that was done.
- When the server says his tick may already have been applied (`maybe-applied`), the app cannot tell which write
  came last: his tick may have gone in and been undone on another device, and sending it again would undo that
  device's change without a word. So the app only drops it when the server already has the status he tapped, and
  otherwise asks, as before. (Found by the review, 2026-11-26.)
- While this is being settled the tick stays drawn. Nothing is published in which it is undone, unless it ends
  held.
- A tick sent again this way and held a second time is held and asked about; the app does not try a third time.
- Slice 1b applies the same rule to a page's words: lines written on the device and lines changed on the server
  are merged line by line when the save is refused (a three-way merge of the app's own, §10.6; not the web's
  `mergeDraft`), and he is asked nothing.

**A command that is sent and waited for** does not go through the outbox. `perform(action:)` sends it once, after
anything pending has been sent, on the copy's revision, and returns what happened: applied (the reply's changes
are in the copy before it returns), no connection, or refused with the reason. Nothing is stored, so a tap made as
the network drops is not replayed hours later. The buttons of §6 use it. When the server answers that the copy is
behind, the engine loads and sends the command once more; after any other refusal it loads, so "try again" is
tried on what the server has now, as the web resyncs before a retry.

**The network coming back** also asks for one load when the last pass ended offline, whether or not anything is
waiting to be sent, so the offline line does not outlast the outage.

**The label** is the web's (`labelFor`, `src/components/outbox.ts`): a past-tense verb and the name in quotes, cut
to 40 characters with "…". The app makes it for the commands it sends: `ticked "…"` for a tick and whatever
`labelFor` gives for the others. A shared case holds the Swift label to the web's.

**Signing out with changes not sent.** Sign-out first tries one pass. If entries are still pending or held, the
app asks, in a system alert, before erasing them (§7). Carried from phase 0.

**A store that cannot be opened** still falls back to memory. With changes now made on the device, the screen says
so (§7), because a tick made offline would not survive a relaunch. Carried.

**The account's address** is published by the engine in `SyncState` whenever the server has told it (sign-in, and
the account check each launch makes when it is online), so the menu no longer depends on a sign-in in this launch.
A launch that never reaches the server has none. Carried.

## 6. Other days

**One screen, a date.** `TodayViewController` becomes `DayViewController`, holding the date it shows. Changing the
date replaces the page in place; nothing is pushed, so there is no Back.

**Today.** The account's day, moving at the account's midnight, not the device's: a timer for the next midnight in
the account's zone, and a check whenever the app becomes active. While the screen shows today it follows today;
while it shows another day it stays there. Carried from phase 0.

**Controls: the web phone app's arrangement, in the system's components (Brian, 2026-11-26).** He saw two
arrangements of mine and corrected both. Six glass buttons around the title: "尽量简洁，不要一大堆常驻按钮". Then
Previous, Calendar and Next in a bottom toolbar: "前/后一天还是要在顶部的，但是不需要用一个显著的按钮，而是类似 ghost
按钮这种低打扰的就好了。底部的 toolbar 基本上维持和当前移动端一样的布局。整体上还是和现在的 web mobile 差不多，但是使用
原生组件". So where a control goes is the web phone app's answer, and how it looks and behaves is the system's
(`native-app.md` §9 is about the second, not the first).

- **The bottom bar is the system tab bar**: Today, Tasks, Calendar, Pages, and the system's search tab, which the
  system draws as the round button at the end, where the web has its round Search button. The web's fifth place, Tags,
  has no tab yet: on a phone the system's bar holds five items, the search tab included, and a sixth puts Tags and
  Search behind a More tab of the system's (tried on the simulator, 2026-11-26). Which place gives way is Brian's to
  say; until he does it is Tags, the place a search reaches most easily. Until a place is built its tab shows the
  place's name and `Not in the app yet`. This replaces §2's "the tab bar waits for 1e": the bar is there from now, and
  each slice fills a tab.
- **The day's header is the first row of the page**, as on the web: the word `Today`, `Yesterday` or `Tomorrow`
  above the title when it applies; the title ("Wed, Nov 25", the web's wording) with a small chevron, which
  opens the day picker (`UICalendarView`, a dot on each day with something written, the week starting as the
  account has it; future days too); the status line under it when there is one.
- **Previous day and Next day are at the top right, quiet**: two plain chevrons with no capsule around them, in
  the secondary colour. Next is disabled from today on, as on the web. After them, only while a change is held,
  "Not saved"; then a More button (`ellipsis`) whose menu holds the address and "Sign out". There is no account
  button.
- **No Today button on the phone**: the Today tab goes back to today, as the web's does. On a wide screen a plain
  `Today` shows before the chevrons while another day is open, as on the web from 600 px up.
- No swipe between days. The web has none, a horizontal swipe is the system's Back and will be a row's actions in
  1c, and the picker already reaches any day. My call.

**Which page is a day's.** The web's rule (`dayPage` in `src/domain/workspace.ts`): the page of type `daily` with
that date that is not in Trash. Phase 0 looks for the id `day:<date>`, which is wrong twice: it finds a page that
is in Trash, and it misses the page started after one was trashed, whose id is `day:<date>:2`. `Workspace.dayPage`
is corrected, `Workspace.trashedDayPage(_:)` gives the newest one in Trash, and the engine asks for today's page
only when today has neither, as the web does. Shared cases: `fixtures/core/day-page/cases.json`.

**"Something written"** is the web's `writtenDays` (`src/domain/page-tree.ts`): a day's page, not in Trash, that
has content or a page under it. Content (`hasContent`) is any of: a to-do row whose task id does not start
`editor-task:`, a file block with a URL, a smart note, or a line that is not a heading and has words. Ported to
`DaythreadCore` as `Workspace.writtenDays() -> Set<LocalDate>` with shared cases
(`fixtures/core/written-days/cases.json`).

**A day with no page.**

| The day | The app |
|---|---|
| Today, no page and none in Trash | The engine asks the server for it (`ensure-day`), as phase 0 does |
| A past day, no page | "No page for Tuesday, Nov 3" and an "Add page" button (Brian, 2026-11-26: a past day is not "started"; it was "No page for … yet" and "Start this page", the web's words). **The app does not make the page by opening the day**, which the web does. My call: stepping back through a month should not write a month of pages, and each `ensure-day` also ends the server's Undo |
| A future day, no page | "Thursday, Dec 3 hasn't happened yet" and "Create page". The web's lists of what is planned or due that day come with 1e |
| The day's page is in Trash | "Today's page is in Trash." or "The page for Tuesday, Nov 3 is in Trash.", with "Restore" and "Add a new page" |

- These are `UIContentUnavailableConfiguration`s. The buttons send `ensure-day`, or `restore-batch` with the
  page's `trashId` (what the web's Restore sends for a day), with `perform` (§5): the button shows the system's
  activity indicator until it returns. With no connection, or when the server refuses, the state's second line
  reads `Couldn't add a page · try again` (after "Add page" or "Add a new page"), `Couldn't create a page · try
  again` (after "Create page") or `Couldn't restore · try again`, and the button works again.
- A draft page is never shown as a day or counted as one (`Page.isDraft`).

## 7. What he sees

Every string below goes into `docs/design/native-system.md` in the same change.

| State | On screen |
|---|---|
| A tick | The circle fills with the system's symbol replace transition; a light impact haptic; the words dim and strike, as now |
| The circle, to VoiceOver | A button labelled `Complete <the to-do's words>`, the web's label, with the value "done", "cancelled" or "not done" |
| Offline with changes to send | The line under the title: `Offline · showing what was last loaded · 1 change will be sent` (`2 changes will be sent`), the web's words |
| Changes waiting behind a held one | A disabled last line in the held menu: `1 later change waiting` (`2 later changes waiting`), the web's words |
| A held change (only what the app could not merge, §5) | A button appears in the navigation bar (`exclamationmark.triangle`, in the system's red; to VoiceOver, "Not saved"). Its menu has one section per held change, titled with the web's sentence, holding "Keep mine" and "Discard" (destructive) |
| …held because the row changed elsewhere | `Not saved — ticked "Water the plants" was changed elsewhere` · Keep mine · Discard |
| …held because the to-do is gone | `Not saved — "Water the plants" was deleted elsewhere` · Discard |
| …held because something changed since | `Not saved — ticked "Water the plants" · changed since` · Keep mine · Discard |
| …held because it may already be applied | `Not saved? — ticked "Water the plants" may already be in` · Keep mine · Discard |
| …refused for any other reason | `Not saved — can't do this now: ticked "Water the plants"` · Discard |
| Sign out with changes not sent | A system alert: title `2 changes not sent` (`1 change not sent`), buttons "Sign out and discard" (destructive) and "Cancel". My words |
| The store could not be opened | The line under the title: `Changes aren't kept on this device`. My words |

- The held button stays until each change is resolved, on every day, as the web's banner does. It is a button
  with a menu and not a banner because the system has a menu and has no banner (`native-app.md` §9, rule 1). The
  web also links the name to its row; that comes with 1c.
- The account menu is built when it is opened (`UIDeferredMenuElement.uncached`), not on every state change.
  Carried.

## 8. How 1a is checked

- **The rules:** the shared cases of §4 and §6 in `swift test`.
- **The engine:** with the fake transport: a tick is in the published workspace before the transport is asked; an
  offline tick is drawn again by a new engine on the same store; a reply replaces the prediction; two ticks are
  re-derived when the first is answered; a held tick leaves the server's state on screen and holds a later tick
  for the same to-do; keep and discard; the retry schedule with a clock the test owns; sign-out with pending
  changes; a store whose write fails inside a transaction leaves the outbox as it was.
- **The frame:** a unit test taps the circle and reads the cell in the same run-loop turn, with the engine not yet
  answered.
- **The screens:** UI tests on the simulator against the seeded local servers: tick and untick; tick offline,
  relaunch, see it done, come back online, see it sent; previous, next, calendar, Today; a past day with no page.
  The seed gets one to-do per test that changes it, since the tests share a server.
- **His data:** the Debug build against production, as phase 0 was: a tick made in the app is done on the web,
  and one made on the web is done in the app after a refresh. He signs in himself.

## 9. Not in 1a, recorded so it is not lost

- `/api/v1/saves` has no `expectedOwner`; a block key the app adds lands after `children`. Both before 1b sends a
  save.
- Opening a day ends the server's Undo (`ensure-day` clears the slot even when the page exists). 1c's Undo must
  not offer what the server no longer holds.
- The web keeps a ticked row in place for a second in lists that drop done rows. That is for Tasks (1e); a day
  page keeps its rows.
- Row spacing, chips as text, cell polish: with 1b, when the cells are rebuilt for typing.
- A kept entry does not learn the revisions of entries acknowledged after it (it keeps its early place in the
  queue). Harmless for a tick; before a slice puts an entry that reads beyond its rows in the outbox, it must.
- `writtenDays()` reads every day's document on the main actor each time the calendar opens (0.18 s for 730 days
  in a Debug build on the Mac). Cache it per revision, or work it out off the main actor, with 1e's Calendar.
- "Sign out" shows nothing while it waits for its one pass; on a network that hangs that is the request's timeout.
- Carried unchanged from phase 0 and still open: an entry whose reply the app cannot read, or that the server
  answers with a 5xx every time, blocks every entry behind it, with no way to discard it; nothing is sent while
  the app is suspended; the Mac build has no way to refresh and cannot keep a session under its current signing;
  today's page that cannot be made shows a blank page with no words; the day title has no year.

## 10. Slice 1b: writing

- Written 2026-11-26 from the code at the head of the three changes after 1a, and from two fact sheets read out of
  the web app and the Swift app. Brian has not read it. Every call is mine unless it names him.

### 10.1 Goals, non-goals, anti-goals

**Goals**

1. He taps a line of a day page and types. The words appear as he types them, with no stutter, and Return,
   Backspace and the typed shortcuts do what they do on the web.
2. Chinese input never splits a line, loses a character or doubles one.
3. What he writes is on the device the moment he writes it and is saved on its own. Writing done offline is still
   there after the app is quit, and is saved when the server can be reached.
4. When the page changed on the server while he wrote, his lines and the server's are merged line by line, by the
   app, without asking (Brian, 2026-11-26, §5 "Merging, not overwriting").
5. A page saved by the app opens in the web app with nothing missing, and the reverse.

**Non-goals**

- Making `@date` chips, page links, `/`, `@` and `[[` lists, the formatting bar, bold and the other styles from the
  keyboard, moving lines by drag (1f). A chip or link already in a line is kept and drawn as now.
- Selecting across lines, and pasting anything but plain text.
- Nesting from the phone's keyboard. Tab and Shift-Tab work from a hardware keyboard and on the Mac; the phone gets
  its buttons with the formatting bar (1f).
- Undo of a split, a join or a deleted row (1c, with the notice). Undo of typing inside one line is the text
  view's own.
- Pages that are not days (phase 2).

**Anti-goals**

- A keystroke that waits on the network, the store or a redraw of the list.
- A save that replaces what the server has, or a load that replaces what he wrote.
- A line the web then shows differently from how the app showed it.

### 10.2 The page while it is edited

**One editable document per open page**, in `DaythreadCore`, with no UIKit: the page's blocks as a tree, and the
operations of §10.3 as pure functions that return the new tree, where the caret goes, and the rows whose to-dos
were let go. The screen draws from it and the engine saves from it.

**What is written back.**

- A block he did not touch is written exactly as it was read. A block whose words he changed keeps its id, type and
  props; only `content` changes.
- A block is written with its keys in the web's order: `id`, `type`, `props`, `content`, `children`. Phase 0 put a
  key the app added after `children`; fixed here, before the first save is sent.
- A block the app makes gets a lowercase UUID, as the web's do, and the props BlockNote writes for that type:

  | Type | `props` as written |
  |---|---|
  | paragraph, bulletListItem, numberedListItem | `{"backgroundColor":"default","textColor":"default","textAlignment":"left"}` |
  | heading | the same three, then `"level":N,"isToggleable":false` |
  | quote | `{"backgroundColor":"default","textColor":"default"}` |
  | divider | `{}`, and no `content` key |
  | task | `{"taskId":"editor-task:<block id>","role":…,"planDate":…}`: `plan` and the page's date on a day page, `reference` and `""` otherwise |

  These come from BlockNote 0.56's source and from pages the web saved; they cannot be made by the fixtures script,
  which has no editor, so they are constants with a test each, and a comment saying where they were read.
- The web rewrites every block's props to its defaults the next time it saves the page. That is the web's doing
  and changes nothing he sees.

**Words.** A line's `content` becomes a typed list of runs for editing: text with its styles, a link holding runs,
and a token for anything else (a date chip, a page reference, an item this build does not know). Typing inside a
run keeps the run's styles; typing between two runs takes the styles of the one before the caret. A token is one
position wide in the line: it can be deleted, and it cannot be typed into. Whatever the app does not understand in
a run or an item is kept as it was read and written back. A line break inside a run (`\n`, the web's
Shift-Return) is kept and drawn; the app does not make one.

### 10.3 The keys

The web's rules, read from its editor (BlockNote 0.56's keyboard handling and the app's own handlers in
`page-editor.tsx`). Where the web has a rule, the app has the same one, so a page behaves the same in both.

| Key | Where | What happens |
|---|---|---|
| Return | in or at the end of a paragraph, bullet, numbered item or quote | The line splits. The first half keeps its id; the second is a new block after it: the same type for a list item, a paragraph otherwise. Lines nested under it go with the second half |
| Return | at the start of a line that has words | An empty line goes in above (a list item for a list item, a paragraph otherwise); the line itself is untouched |
| Return | in a heading | The words after the caret become a paragraph below |
| Return | on an empty list item | It becomes a paragraph at the same depth |
| Return | on an empty nested paragraph | It moves out one level |
| Return | in or at the end of a to-do's words | A new to-do after it and everything nested under it, holding the words after the caret, with its own `taskId`. Styles are kept in both halves (the web drops them; that is not a rule worth copying) |
| Return | at the start of a to-do that has words | An empty to-do goes in above; the row and its to-do are untouched. **Not as the web**, which leaves the old to-do with no words and moves the words to a new one, so a done or dated to-do would lose its words |
| Return | on an empty to-do | It becomes a paragraph; no to-do is made |
| Backspace | at the start of a bullet, numbered item, quote, heading or to-do | It becomes a paragraph; words and nested lines stay. A to-do lets go of its to-do (below) |
| Backspace | at the start of a paragraph | It joins the line above: that line's id, type and props stay and the words are added to it; lines nested under the lower one move up a level. If the line above is empty and of the same kind, the lower line takes its place instead and keeps its id |
| Backspace | at the start of a paragraph under a block that holds no words (an image, a database, a placeholder) | Nothing, if the paragraph has words; if it is empty it is removed |
| Backspace | at the start of a line with words under a divider | The divider is removed |
| Backspace | on an empty line under a divider | The line is removed |
| Backspace | at the start of a line under a synced block or a database | Nothing. The web joins it into the synced block's last line, which would write it into every page showing that block |
| Backspace | on a to-do with no words | The row is removed |
| Tab | hardware keyboard, and the Tab key of an iPad's software keyboard | The line moves under the line before it, with its own nested lines. Not on a heading, not right under a heading, not on the first line of its group, and not under a block the app does not draw the inside of (a database, a synced block, an image): the line would vanish, or be written into a shared block |
| Shift-Tab | hardware keyboard | The line moves out one level; the lines after it at its old level come under it, as on the web |
| `# `, `## `, `### `, `- `, `* `, `1. `, `[] `, `> ` at the start of a paragraph | | The line becomes that kind, keeping its id, depth and nested lines. `7. ` starts a numbered list at 7 (`"start":7` in its props, as the web stores it). Backspace straight after puts the characters back. Inside a to-do they are just characters |
| `---` on a line of its own | | The line becomes a divider and the caret goes to an empty paragraph after it |

- **The caret** goes where the web puts it: the start of the second half after a split, the joining point after a
  join, the same place in the words after nesting.
- **A to-do let go.** When a to-do's row leaves the page, the server decides what becomes of the to-do, as it
  does for the web: it goes to the to-dos' Trash unless it still has a row on another page. The save names the
  rows he removed one at a time (`singleDeleteIds`) in exactly the web's two cases: Backspace on an empty to-do,
  and Backspace turning the page's first line from a to-do into a paragraph. The screen keeps naming such a row
  while it is still absent from the page, across a redraw and across a merge (the server settles a row as removed
  one at a time only if the save that removes it says so), and forgets it when the row is back or another page
  is opened.
- **A new to-do can be ticked at once**, offline too. The server will make its to-do under the row's own
  `taskId` when the save lands, so the app draws it as an open to-do from the draft, and a tick on it waits in the
  outbox behind that page's save (`native-app.md` §7: one ordered queue). The web cannot tick it until the save
  lands; an app whose point is working offline should.
- **While an input method is composing**, none of these run: Return commits the composition and nothing else.

### 10.4 The cells

- A line's words are a `UITextView` on TextKit 2 in the row's cell, not scrolling, sized by its content. It is
  added to the cell as the circle is, because a view inside the list's content view gets no touches (found in 1a).
  Bullets, numbers, the quote bar and the circle stay as they are.
- A tap in a line puts the caret there. A tap in the empty space under the last line puts it at the end of the
  last line when it is one he can type in (an empty one too), or in a new paragraph when the page ends with a
  block that takes no caret.
- **Typing touches one row.** A keystroke changes that line in the document and lets the text view lay itself
  out. The list is told a row's height changed only when it did. Nothing else is redrawn, and nothing is awaited.
- **Input methods come first** (`native-app.md` §7). While a text view holds marked text: its row is never
  reconfigured or reloaded; nothing from outside (a load, a save's answer, a merge) changes its words; no shortcut
  is looked for; and what is being composed is not yet the document. When the composition ends the line is read
  once. Anything that arrived for that row meanwhile is applied then.
- **What arrives from outside** while he writes (the answer to his own save, a load) changes only rows whose
  block really changed, and the row holding the caret keeps its caret.
- **The keyboard.** The list follows the system's keyboard layout guide, so the line being typed is never under
  it, and dragging the list down dismisses it. The toolbar of §6 is under the keyboard while it is up.
- The Mac build takes the same code: a hardware Return, Backspace, Tab and the arrow keys moving from one line to
  the next at the top and bottom of a line.

### 10.5 The draft and the save

**Who holds the words.** The open page's document lives with the screen, on the main actor, and only the screen
changes it. The engine stores and sends; it never rewrites a page he is typing in. So a keystroke can never meet a
copy of itself coming back, and nothing computed a moment ago can overwrite what he typed since.

**The draft.** Each change is handed to the engine, which writes it to the store at once, as that page's draft
under his account: the document; the page it started from (its text and its key); the rows he removed; and, while
a save is on its way, exactly what was sent and under which operation: the whole action as first sent, because
the server recognises a repeated operation only when its action is the same, timestamps included (the revision
it is sent on is outside the action and is the copy's at each send). A crash or a
quit loses nothing. This is a new kind of row in the store, added with a migration that keeps what the store
already holds.

- **The page a draft started from is the page he typed on**, which the screen tells the engine with his first
  change, never the engine's copy at the moment the change arrives: a load can land between the keystroke and the
  engine, and a draft that took the newer page as its start would be sent over another device's words. One
  exception, for the same reason turned round: when his last save has just landed and removed its draft, a
  keystroke that was already on its way still names the page from before that save. The screen's words always
  come from what it last sent, so such a keystroke starts from what that save sent, not from the older page;
  otherwise the line he is typing in would be merged with itself and doubled.

- A draft belongs to its account. Day pages and their template lines have the same ids in every account, so a
  draft is never drawn, merged or sent under another one. It is kept, out of sight, until its own account is back;
  signing out asks first, as for any change not sent. A sign-out removes the drafts of the account signing out,
  and only when he chose to discard them; it never removes another account's (my call: an account that never
  returns leaves its unsent words on the device, neither drawn nor sent, which costs less than erasing words
  nobody was asked about).

**What is drawn.** Where a page has a draft, the workspace the engine publishes has the draft's document for that
page, and an open to-do for each new to-do row that has words. So every screen and a relaunch show what he wrote.

**The save** is the web's command through the route phase 0 made for it:
`POST /api/v1/saves` with `{ operationId, expectedRevision, expectedOwner, action }`, the action being
`{ "type": "save-editor", "pageId", "expectedContent", "document", "singleDeleteIds", "today", "at" }`.

- `expectedContent` is the key of the page the draft started from: the web's `pageContentKey`, a hash of the
  stored text, ported to `DaythreadCore` and held to the web's by shared cases.
- `expectedRevision` is the copy's revision when the save is sent, not when he typed.
- `expectedOwner` is new and optional on the route (the one server change of this slice): a save made under one
  account is refused under another, as a command already is, and the engine then loads and stops, as for a command.
- **One save per page is on its way at a time.** Until it is answered, the same document goes again under the same
  operation id, however much he has typed since. The server answers a repeated operation with what it answered
  the first time, so a save that landed while its answer was lost is recognised, not sent as a second change.
  Newer words wait for the answer, then go as the next save.

**When.** 450 ms after the last change, as on the web; at once when he leaves the day, when the app leaves the
foreground, and when the network returns. What an input method is still composing is never in the document, so
it is never saved; words already committed are saved on the same schedule while he composes the next ones.

**In a pass** the saves go in the same queue as the outbox, each in the order it was made, so a tick on a to-do
that exists only in a draft is sent after that draft's save. A save's answer is applied to the copy as a
command's is. Then:

- If he typed nothing since it was sent, the draft is removed and the page is the server's.
- If he did, the draft stays. When the server's page is what was sent, the draft now starts from it and his
  newer words go as the next save. When the server changed what he sent (it marks a new to-do's row as planned
  for the day, and stamps links), the draft starts from what was sent, and the server's page and his newer words
  are put together by the merge of §10.6.

### 10.6 When the page changed on the server

**Brian's rule (§5): neither side replaces the other, and he is not asked.** It applies when a save is refused
because the page changed, when a load brings a changed page while a draft is waiting, and when a save's answer
comes back to newer words. In each, three versions are known: the page the draft started from, his draft, and
the page as the server now has it. The app merges them line by line, by line id.

**This is not the web's "Load latest".** The web's `mergeDraft` was written for a button he presses rarely: it
starts from the server's page and adds each line he touched as a copy below it, brings back what he deleted, and
turns a changed to-do into a bullet. Run without being asked, it would double the line he is typing in at every
merge. The app's merge is a three-way merge, written for running unasked, in `DaythreadCore`, with no TypeScript
twin. The web keeps its button until it is given the same merge; the parity list says so.

| The line | In the merged page |
|---|---|
| Changed only by him | His |
| Changed only on the server | The server's |
| Changed by both to the same words | Those words, once |
| Changed by both, differently | The server's stays, and his words go in as a new line right below it. Nothing of either is lost, and the one place where the app cannot know which he wants is on the page for him to see, not in a dialog |
| Added by him | After the line it followed in his draft, or the nearest line before that which still exists |
| Added on the server | Where the server has it |
| Deleted by him, untouched on the server | Deleted |
| Deleted by him, changed on the server | The server's line stays |
| Deleted on the server, untouched by him | Deleted |
| Deleted on the server, changed by him | His words go back in where the line was |

- **What "changed differently" means.** A line is its kind, each of its properties, and its words, and each is
  merged on its own: a line conflicts only when the same one of these was changed by both to different values.
  The server changes what he sends (it marks a new to-do's row as planned for the day, and stamps links), and he
  keeps typing while a save is on its way; if the whole line were compared, his words would be doubled under a
  to-do he had just typed. A stamp the server puts on a link inside the words is not a change of words: his words
  stand and take the stamp.
- **To-dos.** A to-do's row is a line like any other, and its `taskId` travels with it. When both changed a
  to-do's words, the server's row keeps the to-do and his words go below it as a plain line: one to-do must not
  become two. For the same reason, when the server deleted a to-do's row and he changed its words, his words go
  back in where the row was as a plain line, without the `taskId`: a to-do removed elsewhere does not come back
  because he was typing in it (my call; what it costs is making that line a to-do again by hand).
- **Nesting and order.** If only one side moved or nested lines, that side's arrangement is kept and the other's
  words and added lines are fitted into it. If both rearranged, the server's arrangement is kept and his words,
  additions and deletions are applied to it; his rearrangement is the one thing given up, and it is the rarest.
- **What must always hold**, and is tested as such: merging with an unchanged server page gives his draft
  exactly; merging an unchanged draft gives the server's page exactly; when both made the same change the result
  is that change; and every line's words that either side wrote and the other did not delete are in the result.
- **Who runs it.** The screen, at a moment when no input method is composing, with the document as it is then,
  and it becomes his draft on the server's page and is saved. For a page that is not open, the model runs it on
  the stored draft. The engine only says that a draft is behind the server's page and holds the save until the
  merge has run.
- **Two devices both writing** each merge against what the other saved, and the page settles: a line both typed
  in differently ends as two lines, once.
- The line under the title reads `Latest loaded · your changes are below their lines` (the web's words) until he
  types again, only when some line was changed by both, differently. Otherwise nothing is said.

**When a save cannot be taken at all.**

| The server says | The app |
|---|---|
| nothing (no connection, a 5xx, a 429) | Keeps the draft and tries again on the schedule of §5 and when the network returns |
| "Saved elsewhere…" (something in the workspace changed since the copy was loaded) | Loads. If this page is as it was, sends the same save once more; he sees nothing. If the page changed, merges |
| "Page changed elsewhere…" | Loads and merges |
| the page is gone, or is in Trash | Keeps the draft and does not save into a page he cannot see. The "Not saved" button of §7 offers "Copy draft" and "Discard draft" |
| the document is not acceptable (it never should be) | The same: keeps the draft, offers "Copy draft" and "Discard draft", and does not send it again until he changes it (and once more at the next launch) |

**What he sees otherwise.** Nothing while a save is on its way or has landed. Under the title, only when it
matters: `Offline · saves when you're back`; `Not saved yet · trying again`; `Couldn't save · draft kept`. These
are the web's words.

### 10.7 How 1b is checked

- **Shared cases** from the TypeScript: the content key (CJK, emoji, a page with a synced block); saves
  (`before`, `action`, `after`: typed words; a new to-do with words, which the server makes a to-do with the
  row's own id; a to-do's words deleted; a row removed, whose to-do goes to Trash; a row removed whose to-do has
  a row on another page; a page holding a synced block and a database block the app did not touch; a stale key
  refused; the same operation sent twice, answered the same).
- **The merge**, in Swift alone: each row of §10.6's table; the four things that must always hold, over many
  generated pages; a to-do changed by both ends as one to-do and a line; nested lines under each rule; a merge of
  a merge (two devices) settles.
- **The keys:** one test per row of §10.3 on the document alone, with the caret; each block kind as first and
  second half; nested lines following the right half.
- **What is written:** a document typed into by the app is accepted by the server's own `save-editor` in a shared
  case; an untouched block is byte for byte as read; a new block has the props of §10.2.
- **The engine:** a draft is in the store before the call returns and is drawn by a new engine on the same store;
  the save goes 450 ms after the last change with a clock the test owns; a retry carries the same operation id;
  "Saved elsewhere" resends once; a save whose answer was lost is sent again as it was and recognised; a draft
  behind the server's page is held until merged; the answer to a save while he typed more leaves his newer words;
  a tick on a to-do typed offline is sent after its page's save; a draft is never drawn or sent under another
  account; sign-out counts drafts; a store written by 1a opens
  and keeps its workspace and outbox.
- **The cells:** typing changes the document and only that row; marked text is never reconfigured, never read
  early, and Return during it only commits (driven through the text view's own marked-text calls); a load during
  composition is applied after it; the caret survives an outside change to another row.
- **The screens:** UI tests on the seeded local servers: type a line, see it on the server; type offline,
  relaunch, see it, come back, see it saved; Return and Backspace; a to-do typed and then ticked; a page changed
  on the server while he typed is merged. Chinese is typed with the simulator's Pinyin keyboard if a UI test can
  drive it; if it cannot, that check is his, by hand, and the plan says so.
- **Feel:** the time from a keystroke to the list laid out again, on a page of 300 lines and, for comparison, of
  10. Measured on 2026-11-26 on the iPhone 17 simulator (the median of five runs of 50 keystrokes each):
  **7.0 ms on 300 lines, 2.7 ms on 10**. The budget is one and a half times each (10.6 ms and 4.0 ms), enforced
  where the machine is known (`DAYTHREAD_FEEL_BUDGET=1`; CI only measures). What grows with the page, from a
  profile: the page is written out whole on every keystroke for `onChange`, and parsed again by the screen and by
  the engine when they draw the draft. It is well inside a frame today; these are the places to work on if a
  longer page ever is not.
- **His data:** as before, by him: a line typed in the app is on the web, and one typed on the web is in the app.

### 10.8 Not in 1b, recorded

- Document-wide Undo. A split, a join and a removed row cannot be undone in 1b; the text view's own undo is cleared
  when the structure changes, so it can never put back words that are no longer that line's.
- `receipt.renamed` (the server renames a line whose id another page holds). It cannot arise from what 1b can do
  (no paste of lines); if it arrives, the page is merged as a changed page.
- A repeating to-do ticked while the next day's page has a draft: the server writes that page, and the draft is
  merged at its next save.
- Every save takes the server's one Undo slot, as on the web. 1c's Undo must know.
