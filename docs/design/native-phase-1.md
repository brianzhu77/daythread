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
| **1c. The to-do row** | What a row shows beside its words (due and start dates, "Since", the repeat mark, Reference, Moved to, Blocked by) and its menu (Move, Bring to today, Not today, Cancel, Restore; the web's day row sets no dates, see §11). The notice that carries Undo | Manage a to-do without leaving the page |
| **1d. The morning** | The day draft as bands on today's page (`POST /api/v1/day-draft`, the draft's commands), the Not today list, events and Due soon above the page | Start his day in the app |
| **1e. Tasks, Upcoming, Calendar** | The three screens and the system tab bar that holds them | Plan beyond today |
| **1f. Chips, menus, moving lines** | `@date` chips drawn and made, the `/` and `@` lists, the formatting bar, drag to move lines | Write as he does on the web |
| **1g. The day keeps running** | Reminders scheduled on the device; `run-repeats` on opening | Stop opening the web app |

- 1a is designed in §3 to §8, 1b in §10, 1c in §11 and 1d in §12 (in two parts: above the page, then the day draft). Each later slice gets its own section in this document when its turn
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

## 11. Slice 1c: the to-do row

Written 2026-11-26, against what 1a and 1b built and against the web as it is (`row-actions.tsx`,
`page-editor.tsx`'s `EditorTask` and `rowAct`, `dates.ts`, `carried.ts`, `use-day.tsx`), and read once by a
builder before the plan. §2 said this slice holds "its menu (Move, Bring to today, Not today, Cancel, Restore,
dates)". **The web's day row has no item that sets a date**: Start and Due are set in the To-dos database only.
So dates are shown here and set nowhere yet; setting them comes with Tasks (1e).

### 11.1 Goals, non-goals, anti-goals

**Goals.** A to-do's row on a day page shows what the web's shows beside its words, and he can do to it what the
web's row menu does, without leaving the page: move it to another day, bring it to today, set it aside, cancel
it, restore it. After each, a notice says what happened and offers Undo while the server can still undo it.

**Non-goals** (each recorded in §11.8): the repeat editor and the "Blocked by" picker (their marks are shown, not
changed); Copy, Copy link to line, Comment; opening a blocker's line; the notice after a tick; moving or setting
aside while offline; the system's own undo (shake, three fingers, ⌘Z) for a row action.

**Anti-goals.** A row action that loses words he has typed and not saved. An Undo button that the server will
refuse for a reason the app already knows. A row so full of marks or buttons that its words are hard to read on
a phone, or that moves while he types. An action he triggers by accident while typing or scrolling.

### 11.2 What a row shows

The words are the row, as now. What the web puts at the line's end, the app puts on **one quiet line under the
words**, as the system's own Reminders does for a date and a repeat (footnote size, the secondary colour): on a
phone the web's end-of-line group wraps under the words anyway when they are long, and a row whose words keep
their full width reads better. What is shown, its words and its order are the web's (my call on the placement;
the alternative is the same group at the trailing end of the first line).

In this order, separated by ` · `, each only when it applies, and only on an **open** to-do unless noted:

| Mark | Words | When |
|---|---|---|
| Cancelled | `Cancelled` | the to-do is cancelled (the only mark such a row has) |
| The date tag | the web's `taskDateTag`: `Due today`, `Due tomorrow`, `Due Sun`, `Due Wed 12/2`, `Was due Mon`, `Due that day`, `Start tomorrow`, `Start Mon · Due Sun 12/6`, `Unscheduled` | it has a Due or a Start date (the web's rules, case for case, held to the web's by shared cases). The whole tag is the system's red when the Due date has passed |
| Since | `Since Nov 3` (with the year when it is not this one) | a plan row on **today's** page of a to-do carried seven days or more (the web's `carriedSince`) |
| The repeat mark | the `repeat` symbol; read by VoiceOver as the web's `Repeats every week` | it is a repeat's current to-do |
| Reference | `Reference` | the row is not the to-do's plan. **Regular width only**: the web hides it on a phone |
| Moved to | `Moved to Fri 11/27` | a plan row whose to-do is now planned on another day. **Regular width only**, as on the web |

- **Blocked by** is a line of its own under that one, as on the web: `Blocked by Buy paint`, or `Blocked by 2`
  for several. It is words only in this slice.
- **A done row** shows none of these (the web drops them the moment it is ticked), a cancelled row only
  `Cancelled`; except `Reference`, which the web keeps on a reference row whatever its status. A to-do typed and not saved yet has no dates, repeat or blocker, so it shows none.
- **A reference row of an open to-do** has the web's quiet `Plan for today` button at its trailing end (a plain
  button, caption size, the secondary colour), on every such row as on the web (also when the to-do is already
  planned today; only the swipe leaves the action out then, as the web's phone bar does). It is the only control
  a row gains, and it is on the web's phone row too.
- A paused to-do has no look of its own on a day page, as on the web (its plan row is gone).
- The marks are read from the workspace as drawn (with drafts and queued ticks), so they follow what he sees.
  They move with the app's today at midnight.
- Dates are worded as the web words them (`en-US`, the Gregorian calendar), whatever the device's language, as
  every other string of the app is English.
- **VoiceOver**: the marks are one element of their own after the line's words (`Due tomorrow, Since Nov 3,
  Repeats every week, Blocked by Buy paint`); the circle keeps its label.
- At the largest text sizes the marks line wraps; nothing is cut.

### 11.3 The row's actions

**What can be done** is the web's `rowMenu`, case for case (held to it by shared cases):

| The row | Actions, in order |
|---|---|
| done, or not on a day page | none (the circle reopens a done one) |
| cancelled (on any day) | `Restore` |
| open, on a past day | `Bring to today` |
| open, a reference row, today or later | `Plan for today` (unless planned today) · **Another day** · `Cancel task` |
| open, a plan row, today or later | `Tomorrow · Fri, Nov 27` (today's page only, unless planned tomorrow) · the off item · **Another day** · `Cancel task` |

- The off item is `Not today` on today's page, `Not on Fri` on a later day, and `Remove from Fri` when the to-do
  is planned on another day than this row's.
- **Another day** is a group titled so, with the web's `anotherDayOptions` (`Tomorrow`, `This weekend`, `Next
  week`, less the page's own day and less a `Tomorrow` already shown above), each as `This weekend · Sat 11/28`,
  then `Pick date…`.
- `Cancel task` is the one destructive item.
- A to-do typed and not saved yet has the actions of its row too: the action saves it first (§11.4).

**Where they are.** The web's phone app has a handle on the caret's line that turns the bottom bar into the
row's actions; it has that because a web page has no swipe. The app adds **no control to a row**: a button on
the caret's row would take width from its words or move them when the caret arrives. It uses what the system
gives a list's row and a button, as a trial on the simulator showed they behave on rows whose words are a text
view (2026-11-26):

- **A trailing swipe on a to-do row**, as in Mail and Reminders: the actions the web's phone bar puts first,
  then `More`. On today's plan row: `Tomorrow`, the off item, `More`. On a later day's plan row: the off item,
  `More`. On a reference row: `Plan for today` (when it applies), `More`. On a past day: `Bring to today`. On a
  cancelled row: `Restore`. `More` opens the system's action sheet with the rest in the web's order (the
  Another day options, `Pick date…`, `Cancel task` as its destructive item). No full-swipe action: a swipe that
  runs on never does anything by itself, and a short sideways flick only shows the buttons. A leading swipe
  stays the system's Back. So a to-do can be moved without bringing the keyboard up.
  **The row being typed in has no swipe**: the system would take the keyboard away to open it, and a flick
  while typing would do that by accident.
- **A touch and hold on the row's circle** opens all of the row's actions as one system menu (the button's own
  menu), in the web's `⋯` order, with **Another day** as a titled group; a tap still ticks. This is how the row
  being typed in is reached on a phone, and on the Mac a click and hold or a secondary click on the circle does
  the same. (Before this a long press on the circle ticked when released; it no longer does.)
- **⌘/** with a hardware keyboard opens the same menu for the caret's row at the caret, as on the web (the
  system's edit menu, which a key may open).
- **VoiceOver**: the same actions are custom actions of the line.
- `Pick date…` opens the system's calendar (`UICalendarView`, as the day picker of 1a: a popover on a wide
  screen, a sheet on the phone), days before today not selectable; choosing a day moves the to-do there and
  closes it.

**Not used, and why** (the trial): the list's own context menu. On a row whose words are a text view a touch
and hold on the words opened it in place of the caret, and with the caret in the row it appeared together with
the text's own Select menu. A touch and hold on the words is the text's.

### 11.4 What an action sends, and when

| Action | Command |
|---|---|
| `Tomorrow`, an Another day option, a picked date | `{ type: "plan-task", taskId, date, from: <the page's day>, today }` |
| `Bring to today`, `Plan for today` | `{ type: "plan-task", taskId, date: today, today }` (no `from`: a past row stays as history) |
| the off item | `{ type: "not-today", taskId, date: <the page's day>, onlyThisDay: true }` |
| `Cancel task` | `{ type: "task-status", taskId, status: "cancelled", today }` |
| `Restore` | `{ type: "task-status", taskId, status: "open", today }` |
| Undo | `{ type: "undo", targetOperationId }` |

**A row action is sent and waited for; it is not queued and not drawn ahead** (the engine's `perform`, as 1a's
"Add page"). The web draws a move ahead by running the server's own code in the browser; the app has no such
code, and a move rewrites two pages (the day template, the place to-dos go, nesting). Drawing that ahead would
put pages the app guessed under the drafts of 1b, which are merged against the page they started from. So, in
one pass of the engine:

1. Anything being composed in the list is committed first, and words not yet handed to the engine are.
2. What is queued goes first, as always: ticks, then the saves of drafts. So a to-do typed a moment ago exists
   on the server before it is moved, and a tick on it is not undone by the move's answer.
3. **If the page the row is on still has a draft after that** (offline, behind the server's page, stuck), the
   action is not sent: a move must not rewrite a page under words that are not on it yet.
4. The command is sent on the copy's revision (a stale copy is loaded and the command sent once more, as
   `perform` already does). Its answer changes the copy, and the screen takes the page as an outside change, as
   it takes any (§10.5). A new day page the server made for the move arrives with the answer.
5. When the row that holds the caret leaves the page, **the caret goes to the end of the line above and the
   keyboard stays**; rows nested under a row that left stay, as the server leaves them.
6. If he types meanwhile, his words become a draft on the page as it was, and the merge of §10.6 puts them on
   the page as it now is.
7. If step 3 stops it, or the command fails or is refused, nothing changes and the notice says `Not done · your
   text is kept` (the web's words), with no Undo.

- What it costs: **moving, setting aside, cancelling and restoring need a connection** in this slice; a tick
  does not (1a). Recorded in §11.8.
- **One action at a time on a page.** While one is out, the row it was made on is drawn dimmed and the page's
  other row actions do nothing; typing and ticking go on.
- `today` in a command is the app's today (the account's time zone, as 1a decided), where the web sends the
  device's day.
- A move to a day whose page has a draft of its own: the server writes that page, and the draft is merged when
  it is next saved or opened (§10.6).

### 11.5 The notice, and Undo

**The notice** is one line of words with at most one button, floating at the top of the screen under the
navigation bar, where the web's phone app shows its notices. iOS has no system component for it; it is a small
view of the app's own on the system's material, as quiet as the status line. One at a time: a new one replaces
the one showing. It leaves after 8 seconds (`Undone` after 4, a failure after 6), or when he swipes it up. With
VoiceOver running it is announced, it does not leave on a timer while it has a button, and `Undo` is also an
accessibility action of it. It never covers the line being typed (it is at the top; the keyboard is at the
bottom).

**Its words are the web's**, composed by the app as the web composes them:

| After | Words |
|---|---|
| a move | `Moved to Fri, Nov 27` |
| `Bring to today`, and `Plan for today` from the swipe or the menu | `On today` |
| the row's own `Plan for today` button | `Planned for today` |
| the off item, when the to-do was set aside | `Not today — won’t carry over` on today's page; `Not on Fri 11/27` on another day; then ` · due Fri still tracked` when it has a Due date |
| the off item, when only a stale row left (the receipt's message begins `Removed from`) | `Removed from Fri · still planned for Mon` (the day it is planned for, read after the answer) |
| `Cancel task` | `Cancelled`, then ` · Next Mon, Dec 7` when the receipt names exactly one next to-do of a repeat (with the year when it is not this one) |
| `Restore` | `Restored` |
| Undo, done | `Undone` |
| Undo, refused because something changed since | `Can't undo · changed since` |
| Undo, failed for any other reason | `Couldn't undo · your text is kept` |
| an action that failed or was not sent | `Not done · your text is kept` |

**Undo is the server's**: one slot, holding the workspace as it was before the newest command; `undo` puts all of
it back and is refused once anything later has been applied. Every save of typed words takes the slot, and so
does a tick. So:

- The notice has `Undo` only while **nothing of his is waiting to be sent** (no draft, no queued change) **and**
  the copy says the server's slot is still this action's, at the copy's own revision. When any of that stops
  being so (he types, he ticks, a change from another device arrives, a day page is made), the button leaves the
  notice and the words stay until their time is up. **The app never shows an Undo it already knows the server
  would refuse.** This is the web's rule too: typing after an action ends its Undo.
- `Undo` is sent and waited for like an action. If the server still refuses (a change the app had not heard of),
  the notice says `Can't undo · changed since`.
- There is no Undo once the notice is gone, and none after a relaunch. There is no redo, as on the web.
- An undo is whole: it also takes back what a rule or a repeat did in that command, and a day page the move
  made, as on the web.

### 11.6 What is built

- **The web**: nothing changes in what it does. The functions the app must match are pure, but several live
  where the fixture script cannot load them (`.tsx` files that import React; expressions written inline in
  `rowAct`; private helpers of `page-editor.tsx`). They are moved, or written out as functions, in `.ts` files
  beside their callers, which then call them; the web's own tests must still pass. The fixture script runs with
  a fixed time zone, because `dates.ts` reads the device's.
- **`DaythreadCore`** (pure, each held to the web's by shared cases in `fixtures/core`): date arithmetic and the
  web's date words; a to-do's dates and the day it was made; `plannedOn` (the newest day page holding a plan row
  of it), kept per workspace so that a keystroke does not read every page again; the date tag; the server's day
  drafts as far as `carriedSince` needs them, `carriedSince` and its label; repeats (which to-do is a repeat's
  current one, the rule's words); blockers in force and their words; the row's menu model and Another day's
  options; the notices' words; the commands `plan-task`, `not-today`, `undo`, written as the web writes them.
- **`DaythreadSync`**: `perform` answers with the receipt and the operation's id, and can be told the page a
  command must not overtake (step 3 of §11.4); the state publishes the server's Undo marker. (And the leftover
  of 1b: the "trying again" mark is forgotten when the engine changes account.)
- **`DaythreadEditor`**: a to-do row draws its marks; the trailing swipe, the context menu, ⌘/, the
  accessibility actions; `Plan for today`; the caret going to the line above when its row leaves. The list
  reports an action to its host and does nothing else: it knows no commands.
- **`DaythreadUI`**: the action's steps of §11.4; the notice; the action sheet and the date picker; Undo.

### 11.7 How 1c is checked

- **The Core, against the web**: shared cases generated by running the web's own functions: the date tag (every
  row of the examples in the web's behaviour, on today's, a past and a future page); `carriedSince` (the cases
  of the web's own tests); the repeat words; blockers in force; `rowMenu` for each kind of row on a past day,
  today and a future day, and Another day on each weekday; each notice's words; each command's text equal to
  the web's action, and `plan-task` (to a day with a page and to one without), `not-today` (set aside, and a
  stale row only) and `undo` applied by the server's own code in a case, pages included.
- **The engine**: `perform` gives the receipt and the operation's id; a command told not to overtake a page is
  not sent while that page has a draft, and is sent after the draft's save in the same pass; the Undo marker
  follows the copy; an undo refused is reported as refused.
- **The row**: each mark drawn when it applies and not otherwise, at the largest text size and in landscape;
  the swipe's actions per kind of row; the context menu's items, in order, per kind of row; typing in a row with
  marks still redraws nothing else, and the swipe never starts while he selects text; the caret goes to the line
  above when its row leaves, with the keyboard up.
- **The screen** (hosted, the test server): an action waits for unsaved words to be saved first; it is not sent
  when the page's draft cannot be saved; the row leaves; typing during an action is merged; a failure says so
  and changes nothing; the notice's words; Undo puts the row back; Undo leaves the notice when he types, when he
  ticks, and when the slot moves; a refused undo says so; a second action replaces the first notice.
- **On the simulator** (the seeded servers, with a to-do that has dates, one that repeats, one blocked, one
  carried, one cancelled): move to tomorrow from the swipe and see it on tomorrow's page and on the server;
  Not today; Cancel and Restore; Undo; `Pick date…`.
- **His data**, by him: a to-do moved in the app is moved on the web, and the marks on his real rows match the
  web's.

### 11.8 Not in 1c, recorded

- Moving, setting aside, cancelling and restoring while offline (a row action is waited for). If he needs it,
  it is drawn ahead and queued in a later slice, with the pages it guesses kept apart from drafts.
- Setting a Start or a Due date (the web's day row cannot either); with Tasks (1e).
- The repeat editor and the "Blocked by" picker; tapping a blocker to open its line. Their marks are shown.
- Copy, Copy link to line, Comment, Delete line as menu items (Backspace removes a line).
- The notice after a tick (`Task completed · Next Mon, Dec 7`): a tick is queued and may be answered much
  later; the next to-do appears on its day's page when the answer arrives.
- The system's undo gestures and ⌘Z for a row action; the text view's own undo is the line's.
- `Reference` and `Moved to` on a phone (the web hides them there too).
- A sign that an action is taking long (the row is dimmed; nothing says "working").

## 12. Slice 1d: the morning

Written 2026-11-27 against the web as it is (the survey: every string and rule below was read from the code and
the running phone layout) and the app after 1c. The slice table promised "the day draft as bands on today's
page, the Not today list, events and Due soon above the page". Two things the table did not know:

- **`POST /api/v1/day-draft` does not exist.** The web calls a server function (`prepareDayDraft`), which
  stores nothing: it answers with a `set-draft` command that the client then sends like any other. The route
  has to be written, over the same function.
- **The slice is two things of very different size.** What sits above the page is read from the workspace the
  app already holds, and needs one existing command. The day draft needs a new route, the port of the web's
  draft readings, six commands, rows in the list that are not lines of the page, and its own notices.

So 1d is built and merged in two parts, each of which he can use: **1d.1, above the page** (§12.1 to §12.6),
then **1d.2, the day draft** (§13, written when 1d.1 was in, as each slice was written against what the one
before it built).

### 12.1 Goals, non-goals, anti-goals (1d.1)

Goals: on today's page he sees, above the page and under the title, what the web's phone layout shows there:
today's events in one line, the to-dos that are due or started (`Due soon`), and the to-dos he set aside
(`Not today · N`), which he can bring back or plan for another day. On any other day's page he sees that day's
`Due soon`. Every word and every rule is the web's.

Non-goals: the day draft's line and bands (1d.2); the rows the web draws under the `Events` heading for events
written on other pages (they are rows that are not lines of the page: 1d.2 brings that kind of row); making or
editing a `@date` chip (1f); anything on Tasks (1e).

Anti-goals: a fact that disagrees with the web's for the same workspace; anything here costing a keystroke
(the facts are not read on the typing path); a list above the page that pushes the page off the screen with no
way to fold it; a control that restyles a system one.

### 12.2 What is shown, and when

In this order under the day's title and the status line, each absent when it has nothing to show (the strip
then takes no room). The draft's line of 1d.2 will sit above them, directly under the title, as on the web.

| Part | Shown on | Holds |
|---|---|---|
| The events line | today, when today has an event | The first two events, each `10:30 AM Standup with Lu` (the title alone when it has no time; `Untitled event` for no words), joined by ` · `; `All day` added when there is exactly one event and it has no time; then `+N more` when there are more than two |
| `Due soon` | today and any past day, page or no page; a later day only when it has a page | Every open to-do with words whose Due or Start date is that day or earlier and that has no row on that day's page; each with its date tag |
| `Not today · N` | today | Every open to-do with words that he set aside; each with its date tag, a `Bring back` button and a menu |

- **Where it shows** follows the web: the strip is there whenever the day is not a later day without a page,
  so also above "No page for …" and above today's page in Trash. (The web's screen for a later day without a
  page, with that day's planned and due to-dos, is not in the app: left out, recorded.)
- **An event** is a `@date` chip in a line of any page that is not in Trash, not a template and not a day
  draft. The same chip (`eventId`) in two lines is one event, read from the line on the newest day page, else
  the first in the workspace's page order. Its title is the line's words with each chip read as one space, a
  page link as that page's title (`''` when the page is gone), runs of white space (JavaScript's `\s`) made
  one space, trimmed. A day's events are ordered all-day first, then by the time's text; ties keep the order
  in which each event's id was first met walking the pages. Times are worded `10:30 AM`, `3 PM`. This is the
  web's `chipEvents`, `dayEvents` and `shortTime`.
- **`Due soon` is not a window.** It is "due or started by this page's day": on today an overdue to-do stays
  until it is done and a Due date next week does not show. The order is the workspace's own, with no limit.
  A to-do he set aside is in it too.
- **`Not today`** is every to-do set aside, whenever that was (`paused` has no date), in the workspace's
  order. It is folded when the page opens; the fold is forgotten when he leaves today or the list empties.
- **The date tag** is the web's `taskDateTag` with the planned day (slice 1c's `DateTag`), worded against
  today and the page's day: `Due today`, `Was due Thu`, `Start today`, `Due that day` on another day's page,
  `Unscheduled` for a to-do with no dates and no planned day. It is empty for a to-do with no Due date, no
  Start date of today or later, and a planned day, which is the usual case for one that was carried and then
  set aside; the row then shows its words alone. Nothing in the strip is red: the web's strip does not mark a
  passed date (a row does).
- In `Due soon`, a to-do he set aside reads `Not today · <tag>`, and `Not today` alone when its tag is empty.
  (The web writes `Not today · ` with nothing after the dot there; that is corrected on the web in this
  slice's web pull request, the one place it changes what the web shows.)
- "Today" is the app's today (the workspace's time zone, as in 1a), not the device's clock. The web uses the
  device's local date; the two agree unless the device is in another zone than the account.

### 12.3 How it looks

The web's phone layout, with the system's parts (rule: the system component, configured, never restyled):

- The three parts are one view under the title's stack, inside the page's header, so they scroll away with the
  title. It is written in SwiftUI (the app's sign-in screen already is), because these are SwiftUI's stock
  parts and the page's list is not touched: a plain `Button` with a `Label` (the `calendar` symbol) for the
  events line; a `GroupBox` titled `Due soon`; a `DisclosureGroup` titled `Not today · N` whose rows hold the
  words, the tag, a bordered `Bring back` button and a `Menu` under the ellipsis symbol (spoken `More for
  <words>`).
- **The menu** is one group titled `Another day`: `Tomorrow · Sat 11/28`, `This weekend · Sat 11/28`,
  `Next week · Mon 11/30` as the weekday gives them (the web's `anotherDayOptions`, none left out here), then
  `Pick date…`.
- **A row's words wrap; its tag never does**, and the tag goes under the words when the two do not fit on a
  line, as on the web. The events line is one line, cut with an ellipsis; `+N more` and the chevron are never
  cut. Everything follows the text size. A `Not today` row's button and menu sit under its words, as on the
  web's phone layout.
- The view takes the header's full width inside the rows' own margins, at every width; nothing invents a
  narrower column.
- The view is hosted by a hosting controller that is a child of the day screen. Its height is its own
  (`sizingOptions`), and every change of it (the fold opening, a row leaving, the text size) tells the list
  to lay the header out again. The fold's state lives outside the view, so re-hosting keeps it.
- **A change of the strip's height never moves the line he is typing in**: while a line holds the keyboard,
  the list's offset is moved by the change, so his line stays where it is on the screen.

### 12.4 What a tap does

- **The events line** scrolls the page to its heading titled `Events` (top level, trimmed, any case) when the
  page has one. With no such heading it is words, not a button. (On the web it is always a button that
  scrolls to the events rows or the heading; the rows come with 1d.2.)
- **A `Due soon` row** does nothing, as on the web.
- **`Bring back`** sends `plan-task` with the to-do, today as its date and as `today`, and no `from`. The
  server plans it for today as `planOn` does (a row it already has on today's page becomes its plan row;
  otherwise a new row at the day's insert place), and it is no longer set aside. The notice is `On today`,
  with `Undo`.
- **A day from `Another day`** sends the same command with that date, and no `from`. The notice is
  `Moved to Sat 11/28` (the short form: this notice is worded differently from a row's `Moved to Sat, Nov 28`,
  as on the web), with `Undo`. `Pick date…` opens the calendar a row's `Pick date…` opens (nothing selected,
  no day before today); today can be picked, and then it is `Bring back` (`On today`). The calendar opens from
  the menu's button.
- These are sent as a row's actions are (§11.4): his unsaved words of today's page first, then the command,
  waited for; nothing is drawn ahead; a failure says `Not done · your text is kept` and changes nothing; `Undo`
  follows §11.5. Offline they are not done (the web draws them ahead; recorded).
- **One action at a time for the whole screen**: while a row's action or one of these is out, every control
  of the strip is disabled, the acting row's words are drawn in the tertiary colour, and the page's rows
  start no action either. The screen holds this as one state, with where the action came from (a row of the
  page, an item of the strip; a band in 1d.2).
- After the calendar closes, the choice is sent only if the to-do is still in the list (still open, still set
  aside), as a row's is checked.
- When today has no page to write (it is in Trash, or is still being made), `Bring back` and `Another day`
  are disabled while the page is being made, and otherwise sent with no page to wait for.
- A row leaves `Not today` when the state that holds the answer arrives, not before.

### 12.5 What is built (1d.1)

- **Web (its own pull request)**: the pure pieces the shared cases need move out of the components into
  `.ts` functions the web then calls: the events line's words, `shortTime`, the `Events` heading rule, the
  `Due soon` list for a page (with its on-page filter) and each row's tag words, the `Not today` rows, and
  the strip's two notices. `scripts/export-core-fixtures.ts` gains the cases: a day's facts (which to-dos,
  the order, each tag, the empty tag, one set aside, another day's page, a day without a page), events (a
  chip on a template or in Trash; one id in two lines; ties; a title with a chip, a page link and odd white
  space; a page with one unreadable line, where the app reads less than the web), the line's words, the
  notices, and `plan-task` without `from` applied by the server's own code. The one visible change:
  `Not today` instead of `Not today · ` for an empty tag.
- **Core**: events (`DateMention` keeps its event id; the title reader), collected in the pass that already
  builds the to-do index, so no document is read twice for them; `DayFacts` (the three parts as values:
  strings and to-do ids, nothing of UIKit or SwiftUI), equatable; the strip's notices; `Command.planTask`
  without `from`.
- **UI**: `DayFactsView` hosted in the day's header as §12.3 says; `DayFacts` worked out from the index the
  screen already builds for each drawn workspace (also when the day has no page), and handed to the view only
  when it differs; `AppModel` gains "plan a to-do that is not a row of the page" with the notice's words given
  (so that `N more open` of 1d.2 reuses it); the screen's one-action state and the action's origin, used by
  the rows too; `Undo` for an action that has no row.
- **Editor**: `scroll(toRow:)`, and keeping the typed line in place when the header's height changes.

### 12.6 How 1d.1 is checked, and what is left out

- **Core**, against the web's own functions through the shared cases listed above.
- **The screen** (hosted, the test server): the parts appear and go with what the workspace holds and with the
  day, also on a day without a page; the words and tags; `Bring back` waits for unsaved words, sends
  `plan-task` without `from`, says `On today` and offers `Undo`; a day from `Another day` and from the
  calendar, today included; a failure changes nothing; one action at a time across the strip and the page's
  rows; a choice made after the to-do left the list sends nothing; the header's height follows the fold and
  the line being typed in stays where it is; an account change empties the strip.
- **Cost**: the time from a state arriving to the strip's facts being ready, on a workspace with 3,000
  to-dos, 300 pages, 200 chips, 100 to-dos set aside and 100 due, is measured and recorded (not a budget
  yet); the typing budget is run with the strip on screen. If a state costs too much on his data, the remedy
  is to keep what each page contributes to the index between states (a page's document rarely changes).
- **On the simulator** (the seeded server gains events, a to-do set aside, one due, one started, placed so
  the earlier tests do not meet them): the three parts, light and dark and at the largest text size; bring
  back and undo; another day.
- **His data**, by him: the strip on his real today against the web's.
- Left out, recorded: the events rows under `Events` (1d.2); the web's screen for a later day without a page;
  these actions offline; a tap on a `Due soon` row (the web has none); remembering the fold; limits or "more"
  for long lists (the web has none; seen on his data and decided then).

### 12.7 The day draft

The day draft has its own section, §13, written when 1d.1 was in.

## 13. Slice 1d.2: the day draft

Written 2026-11-27 against the web as it is (the survey `web-facts-1d.md`, sections 1 to 3 and 6) and the app
after 1d.1, and checked against the code by a builder before the plan (four corrections came of it: the route's
404, when `Couldn’t draft` shows, what holds `set-draft` back, and the empty row under the caret). On the web,
when he opens today's page the app asks the server for the day's draft once; what comes back is drawn inside the
page as suggestions he applies or skips one at a time, or all at once. This slice brings that to the app.

It is about twice the size of 1d.1, and one part of it reaches the typing path. So it is built and merged in
parts, each of which he can use, after a narrow spike (§13.5) that the plan waits for:

- **1d.2a, the draft** : the route, the readings, asking, the draft's line under the title, the suggestions as
  rows in the page, Apply, Skip, Apply all, Dismiss, their notices and Undo. A suggestion that would fill an
  empty row is drawn after that row.
- **1d.2b, the draft among his typing**: a suggestion drawn in the place of the empty row it would fill, the
  hold of suggestions that arrive while he types, and `N more open`.
- **1d.3, moving from the draft and the events rows** (§13.9, an outline): `Move to` from the `Skipped` notice,
  `Another day` on a suggestion he skipped on earlier days, and the rows under `Events` for events written on
  other pages. 1d.2 already reads and shows everything those need; 1d.3 adds their controls and commands.

§13.1 to §13.8 describe 1d.2a and 1d.2b together; where a rule belongs to 1d.2b it says so.

### 13.1 Goals, non-goals, anti-goals (1d.2)

Goals: on today's page, in the morning, he sees what the web's phone layout shows: a line under the title that
says where the draft stands (`Preparing…`, `3 suggestions · Apply all · Dismiss`, `Couldn’t draft · Retry`,
`Offline`), each open suggestion as a row in the page where it would land, and `N more open` at the end of the
planning part. He applies or skips one, or all. A suggestion that the web would show, the app shows, in the same
place and order; one the web would hide, the app hides.

Non-goals: rewording a suggestion before applying it (the web lets him type in a line or new to-do suggestion;
here he applies it and edits the row, which is then an ordinary line of the page); moving a to-do to another
day from the draft, and the events rows (1d.3); a quiet state for an account with no model (the web says
`Couldn’t draft · Retry` for it, and so does the app); the draft on any day but today; making the draft
without the server.

Anti-goals: a suggestion that becomes part of the page's document, is saved, copied or typed into before he
applies it; a row that moves under the line he is typing in; the draft's arrival costing a keystroke; a model
call the web would not have made (a second ask for a draft that stands); the draft's arrival taking away an
`Undo` he is being offered.

### 13.2 The route

`POST /api/v1/day-draft`, a thin wrapper of the server function the web already calls (`prepareDayDraft`), with
the same reading of the account as the other v1 routes.

- Request: `{ "date": "YYYY-MM-DD", "operationId": "<1 to 200 characters>" }`. The operation id is only logged.
- Reply `200`: `{ "setDraft": <string or null>, "owner": <string>, "modelOn": <boolean>, "remakeFailed":
  <boolean> }`. `setDraft` is the `set-draft` command as JSON text, exactly as the web's client receives it.
  The server stores nothing: the app sends that command itself, through `/api/v1/commands`.
- Errors are the v1 routes' own: `401` signed out, `415` not JSON, `400` a body that does not read. A date with
  no live day page answers `404 { "error": "not-found" }`, which is new: no v1 route has a 404 body today, and
  the function throws a plain error there that a v1 handler would turn into a 500 (which the app reads as "the
  server failed, try later"). So the decision table of `prepareDayDraft` moves into a plain server function
  (workspace, account and model in; reply out) that both the web's server function and this route call. An
  unexpected throw stays a 500.
- It is a change under `src/` and is its own pull request, merged first, as 1d.1's web change was. The same
  pull request moves the two wordings the app must share out of React files into plain functions the fixture
  script can run (`skippedLabel`, and the draft line's words), and adds the shared cases of §13.7.

### 13.3 When the app asks, and what it does with the answer

The rules are the web's (`use-day-draft.ts`), with the app's today in place of the device's date.

- **It asks** when today's page is on screen, the app is online and signed in, today's page exists, and no
  draft stands for it. A draft stands when it is stored (its JSON reads) and is not stale; it is stale when it
  is settled (marked ready, or any item decided) and its recipe is older than the current one. So a stored
  draft marked failed stands (reopening the app does not pay for another try; `Retry` does), and so does an
  unsettled one of any recipe.
- **At most twice** by itself for each day page in a run of the app: once when the page is first shown, and, if
  that ask failed or got no answer in 60 seconds, once more the next time he comes back to today's page (the app
  returning to the foreground, or today shown again). `Retry` always asks. A stale draft's suggestions stay on
  screen while it is asked for again.
- **The recipe** is a number the web raises when the draft's making changes (5 today). The app carries the same
  number, and a shared case holds the web's, so a raise on the web fails the app's tests until the app follows.
- **The answer.** A reply whose `owner` is not the workspace's owner is dropped. `remakeFailed` counts as a
  failed ask. `setDraft` null means the server's draft already stands: nothing to send, and the app loads the
  workspace so that a draft another device made shows now. Otherwise the app sends the command as its own write,
  waited for and not kept in the outbox, with no notice; if the send fails it is tried once more. A refusal
  `This day already has its draft` is success (another device's draft won). Any other refusal, a `400` among
  them (the command has limits of 50 items, 200 `moreOpen` and 500 allowed to-dos that the server's maker does
  not keep to), is a failed ask.
- **`set-draft` takes the server's one Undo**, like any command. So the app holds it back while an action is
  out, and while a notice offers an `Undo` that the server's slot holds (after an apply, an add, a row's or the
  strip's action). It sends as soon as that `Undo` is withdrawn or the notice is dismissed or times out. A
  `Skipped` notice does not hold it: its `Undo` does not use the slot. (The web sends at once and the `Undo` he
  is looking at then fails.) With VoiceOver on, a notice with a button does not time out; the draft then waits
  for him to dismiss it, which is the right order for someone still deciding.
- **Where it lives.** The model owns the ask (so "once for a page in a run" survives a screen being rebuilt) and
  learns of the app returning to the foreground; the screen tells it whether the Undo slot is being held.
- **The page never waits.** Typing, ticking and every row action go on while the draft is asked for. Nothing
  about the ask is stored on the device; an ask in flight when the app is closed is simply asked again.

### 13.4 The draft's line

One line directly under the day's title and status line, above the events line (the web's order), only on
today. It is the first row of the strip of 1d.1 (the same SwiftUI view, the same rules for the typed line when
its height changes).

| State | When | Shows |
|---|---|---|
| nothing | no draft stored and no ask in flight; or a ready draft with no open suggestion | no line |
| preparing | an ask is in flight and no suggestion is shown | the system's small progress view, `Preparing…` |
| held (1d.2b) | suggestions arrived while he was typing (§13.6) | `Suggestions ready`, button `Show` |
| open | at least one suggestion is shown | `1 suggestion` / `N suggestions`, buttons `Apply all` and `Dismiss` |
| failed | an ask in this run failed or got no answer in 60 seconds and nothing is stored; or the stored draft is marked failed and he has decided none of its items | `Couldn’t draft`, button `Retry` (after the open state's words when there are suggestions too) |
| offline | offline and no draft stored | `Offline` |

- The words are secondary text at the strip's size; the buttons are plain system buttons, `Apply all` and `Show`
  in the accent colour (they are the line's one primary action), `Dismiss` and `Retry` quiet. Each is at least
  44 points tall. At the accessibility sizes the buttons go under the words.
- `N` counts the suggestions shown in the page, not the stored items.
- While a second ask runs after a failed one, the line says `Preparing…` again.
- `Couldn’t draft` is secondary text like the rest (the web colours it as a warning): recorded.
- VoiceOver reads the line as its words; each button is its own element.

### 13.5 The suggestions in the page

A suggestion is a row of the page's list that is not a line of the page: it has no place in the document, the
caret never enters it, it is not selected, copied, saved, dragged or counted as a line. It sits where applying
it would put its row.

- **Which and where** is the web's `draftView`, read again against the page and the to-dos as they are each
  time the engine's state changes or a page is merged (never for a keystroke: a suggestion's place may lag his
  typing by one save): an open item whose to-do is done, cancelled, set aside, planned for a later day or
  already a row on the page is not shown; a line decided in another day's draft, or taken over by a later one,
  is not shown; one with no safe place is not shown. An item goes after its anchor's whole block (the line and
  what is nested under it). One with no anchor, a gone anchor or an anchor outside the planning part goes right
  after the planning heading and the run of to-do rows directly under it, and is not shown if that falls outside
  the planning part. Several on one anchor keep the draft's order.
- **A suggestion that fills an empty row** of the right kind: in 1d.2a it is drawn after that row. In 1d.2b it
  is drawn in the row's place and the empty row is not shown while it is, unless that row holds the caret: the
  row he is in is never taken out of the list, and the suggestion is drawn after it until the caret leaves.
- **What one shows.** Three kinds, by what it would become: a to-do (the system's dashed circle where a row has
  its circle; the web's is a dashed box, as its rows have boxes), a bullet (a dashed dot), a plain line (the
  web underlines it with dashes; here secondary ink alone, unless the spike's screenshots show it cannot be told
  from his own lines). The words in secondary colour: a carried to-do's current title, a new to-do's or line's
  own words. In the marks' place under the words, the age: the short date of the day the to-do was made
  (`Thu 11/19`), or of the day a carried line was written. A carried to-do he skipped on earlier days shows
  `skipped Sat, Sun` there instead (the web's wording, up to three days, then `skipped 5 times`); its `Another
  day` control comes with 1d.3.
- **Its two controls**, at the row's trailing end, always visible, each a 44-point plain button with a system
  symbol: `checkmark` (label `Apply <words>`) and `xmark` (label `Skip <words>`). There is no swipe and no menu
  on a suggestion, and the buttons are always visible, also with a pointer (the web hides them until hover
  there): recorded. VoiceOver reads the row as `Suggestion, <words>, <age or skipped days>` (the skipped days in
  their full form, `skipped Sat 11/21, Sun 11/22`) with `Apply` and `Skip` as its actions.
- **How it is told from his own rows**: secondary ink and the dashed circle (or, for a bullet or line, a dashed
  leading mark), nothing else; no box drawn around the row, no background. (The web's intent: "his row layout
  in muted ink, a dashed box, dot or underline as the only not-yours-yet mark".)
- **The list.** The editor gains rows of this kind as a general thing ("guest rows"). The host hands it the
  page and its guest rows in one call, so that a suggestion can leave in the same update that brings the real
  row. Each guest row has an id, the line it follows (or none: the start of the page) or replaces, a kind,
  words, a second line of small text, and actions, each a button or a menu, with an optional tap on the row
  itself (1d.2 uses two buttons; 1d.3 a menu and a tap); the host is told which was used. The editor knows
  nothing of drafts. Its list's items become "a line of the page, or a guest", so no guest can be mistaken for a
  line: today an id the editor does not know is drawn as a separator, a keystroke compares the page's lines with
  the list's items (with a guest present every keystroke would rebuild the list), the row that can be dimmed
  and the tap under the last line both assume lines only.
- **The spike**, before the plan is fixed, as the swipe was in 1c. It answers: whether items added or removed
  above the cell that holds the keyboard, in an animated update, keep the keyboard, and whether the list's
  offset can be corrected with no visible jump; whether marked text survives an update that adds items
  elsewhere; what VoiceOver's order and actions are on a row with no text view; and what the change of the
  list's items costs on the typing path with guests present.
- **`N more open`** (1d.2b) sits after the last block of the planning part (before a divider that closes it;
  with no headings, after the last top-level block that holds a to-do row), when the draft lists to-dos that are
  still offered and not on the page. A guest row with the system's disclosure chevron, folded when the page
  opens (the fold is the screen's, forgotten when he leaves today, as `Not today`'s is); open, one guest row for
  each to-do: dashed circle, title, age, and one `plus` button (label `Add <title> to today`). It shows for a
  failed draft too, and not while preparing or held.

### 13.6 Suggestions arriving while he types

Rows appearing above the line he is typing in must not move it, and must not appear under his thumbs.

- Whenever guest rows are added, removed or change while a line holds the keyboard, the list keeps that line
  where it is on screen, as it does when the strip's height changes (§12.3). A composition in progress is not
  disturbed: the cell being typed in is not reconfigured. (1d.2a; the list has this today only for the header.)
- (1d.2b) When suggestions become ready while the page is on screen and a key was pressed in the last 3
  seconds, they are held: the line says `Suggestions ready` with `Show`, and no suggestion row or `N more open`
  is drawn. They are released by `Show` or by 3 seconds without a key. A page opened with its draft already
  stored shows them at once. (The web's rule and timing.)

### 13.7 The readings in the Core

Pure, Foundation only, each checked against cases generated from the web's own functions:

- The draft's document as a value (`status`, `items` with every field of §1.2 of the survey, `moreOpen`,
  `recipe`), extending the small reader slice 1c made for `Since`. A draft whose JSON does not read is no draft
  (the web's `draftOf`); beyond that the web checks no shape and has no case to match, so a field of the wrong
  kind reads as absent. (The fixture script's hand-made draft with `moreOpen: false` is corrected in the web
  pull request.)
- `draftSettled`, `draftStale`, the planning part of a page (`planningRange`, its end, where `N more open`
  goes), what is offered (`eligibleTask`, `offeredOn`, `plannedAfter`), where an item sits (`placeItem`,
  `amongApplied`), what another day's draft decided or took over (`decidedElsewhere`, `takenOver`,
  `sameWords`, which lowercases as JavaScript's `toLocaleLowerCase` and reads white space as JavaScript's
  `\s`), the days a to-do was skipped (`skippedDays`) and their words (`skippedLabel`), and `draftView`
  over them: the suggestions to show with their places, and the `N more open` list.
- The draft line's state and words from the view, the ask's state and whether he is offline.
- The commands: `apply-draft`, `skip-draft`, `reopen-draft` (and `set-draft` as text passed through unread).
- Shared cases under `fixtures/core/draft/`: worlds built with the web's commands, covering at least every
  test name of `tests/day-draft.test.ts` and `tests/draft-apply-order.test.ts` that is about what is shown and
  where, the "not twice" cases across days, skipped-day counting, a draft that does not parse, and the recipe.

### 13.8 What a tap does

All are sent and waited for, like a row's actions (§11): one action at a time for the whole screen, they need
a connection, nothing is drawn ahead. While one is out its row is dimmed and every suggestion's buttons, the
line's buttons, the strip's controls and the rows' swipes are held.

| Tap | Command | Notice |
|---|---|---|
| `checkmark` on a suggestion | `apply-draft` with that item | `Applied`, `Undo` (8 s) |
| `Apply all` | `apply-draft` with every suggestion shown | `Applied` / `Applied N` (the server's count), `Undo` |
| `xmark` on a suggestion | `skip-draft` with that item | `Skipped`, `Undo` (10 s) |
| `Dismiss` | `skip-draft` with every suggestion shown | `Skipped` / `Skipped N`, `Undo` |
| `plus` in `N more open` | `plan-task` for the page's day | `Added`, `Undo` |
| `Retry` | asks again (§13.3) | none |
| `Show` | releases the held suggestions | none |

- **Undo** of an apply or an add is the server's `undo` of that operation, offered while the server's Undo slot
  still holds it (§11). Undo of a skip is `reopen-draft` naming the skip's operation and, for every skipped
  to-do, the day it was planned for when the skip was answered (none, written as JSON `null`, when it was not
  planned); it does not depend on the Undo slot, so its button is not withdrawn when the slot changes. After
  it the notice says `Undone`.
- **A partial Apply all.** The server applies what it can and leaves the rest open; the notice says its count
  (`Applied 2`), and what was left stays a suggestion if it is still shown. (The web also writes `Not applied ·
  changed elsewhere` where each dropped one was: left out.)
- **Refusals** read as the web's notes: `Not applied · changed elsewhere` (the server's `Nothing to apply`),
  `Not skipped · changed elsewhere` (`Nothing to skip`), and for a refused undo or reopen the web's own `Can't
  undo · edited since` here (a row's refused undo keeps slice 1c's `Can't undo · changed since`); offline and
  the other failures as §11's. The refusal's reason has to reach the screen, which today learns only "not done".
- **The `Skipped` notice stays 10 seconds** (the web's time for it; the other notices keep theirs).
- After an apply the row is an ordinary line of the page, with the marks of 1c (`Since Nov 19` when it has been
  carried seven days or more). The suggestion row leaves in the same list update that brings the real row, so
  nothing jumps.
- The `Skipped` notice has no `Move to` yet (1d.3).

### 13.9 Moving from the draft, and the events rows (1d.3), in outline

- `Move to` in the `Skipped` notice when a skipped item is a to-do: a second control in the notice that opens
  the system menu of days (`Mon 11/30`, `Pick date…`), sending `snooze-draft`; its notice `Moved to Mon, Nov
  30` with `Undo` (the server's `undo`), which brings the `Skipped` notice back.
- `Another day` on a suggestion with skipped days: the same menu, sending `move-draft`; `Moved to …`, `Undo`.
- The rows under the `Events` heading for events whose chip is on another page: guest rows with the time, the
  title and where the line is (`in Notes`, a page's title), tapped to go there.

### 13.10 Checks, and what is left out

- Every shared case passes in the Core; the parity table lists each web behaviour of the survey's sections 1
  to 3 as done, left out with its reason, or 1d.3.
- UI tests on a seeded server whose draft is made by a hand-written `set-draft` (no model): the line's states,
  suggestions in their places, apply, skip, apply all, dismiss, undo of each, `N more open`, held while typing,
  and the typed line's place through every one of them. A failed draft (the seeded server has no model) shows
  `Couldn’t draft · Retry` with `N more open`. `Preparing…` is seen in the app's unit tests with a held answer:
  a server with no model answers at once.
- The typing budget holds with a draft's suggestions on the page.
- Left out, recorded: rewording a suggestion before applying; a quiet no-model state; the web's decided looks
  drawn ahead (the app waits for the server); the 1-second struck-through hold of a skipped suggestion; the
  web's focus hand-over between suggestions' buttons; the per-row note after a partial Apply all; the warning
  colour of `Couldn’t draft`; the two buttons hidden until hover with a pointer; the darker ink of the opened
  `N more open` rows.
