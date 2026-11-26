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

- Only 1a is designed in full here (§3 to §8). Each later slice gets its own section in this document when its turn
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
  are merged line by line when the save is refused (the web's `mergeDraft`, run without being asked for), and he
  is asked nothing.

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
