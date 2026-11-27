# Native app: what it holds against the web app

- Author: Claude · 2026-11-25 · status: **phase 1c built and seen on the simulator** (`docs/plan/native-phase-1c.md`),
  its check on his own data to come (task 12); phases 1b, 1a and 0 before it (`docs/plan/native-phase-1b.md`,
  `native-phase-1a.md`, `native-phase-0.md`).
- The app ticks a to-do, starts or restores a day's page, types into a day page's lines, and moves, sets aside,
  cancels and restores a to-do from its row, with Undo; nothing else is changed from it. This list is checked
  against the Swift code, not the plan; where it says "draws", the code draws it today. Update it in the same change
  as any screen or block kind it names.
- Marks: **built** (the app has it, and the note says how much), **placeholder** (the app shows a named stand-in and
  no content), **absent** (the app has nothing for it).

## Screens

| Web | App | What the app does today |
| --- | --- | --- |
| Today (`/`) | built | The first tab of the system's tab bar (its symbol the day of the month). The account's day page from the copy on the device, offline too. The page's first row is the day's header, as on the web: "Today" above the title "Thu, Oct 22" with a chevron that opens the day picker, and the status line under it. Tapping the Today tab goes back to today from another day, and to the top on today. Moves at the account's midnight, not the device's. Pull to refresh; refreshes when the app becomes active and when the day changes. Asks the server for today's page when the copy has none and none is in Trash. A to-do can be ticked (see the to-do row), and the page's lines typed into (see Editing) |
| A past or future day (`/day/$date`) | built | The same screen, in place (no Back). Previous day and Next day are two quiet chevrons at the top right (Next stops at today, as on the web), then "Not saved" while a change is held and More; the header says "Yesterday" or "Tomorrow" when it applies. "Today" before the chevrons only at regular width (iPad, Mac), as the web shows it from 600 px up; on the phone the Today tab does it. Any day, future ones too, from the title's picker, the system's calendar with a dot on each day with something written. A day without a page says so instead of making one: "No page for …" with "Add page", "… hasn't happened yet" with "Create page", and a page in Trash with "Restore" and "Add a new page" (the web says "No page for … yet", "Start this page" and "Start a new page"). The web's lists of what is planned or due on a future day are absent |
| Tasks (`/tasks`) | absent | The tab is there and says `Not in the app yet` |
| Upcoming | absent | Part of Tasks on the web |
| Calendar (`/calendar`) | absent | The tab is there and says `Not in the app yet` |
| Pages and the tree (`/pages`) | absent | The tab is there and says `Not in the app yet` |
| A document page | absent | The row drawing exists (see below) but only the day screen uses it |
| Tags (`/tags`, `/tags/$tag`) | absent | No tab: a phone's tab bar holds five items, the search tab included, and a sixth puts Tags and Search behind the system's More tab. Which place gives way is Brian's choice; until then it is Tags |
| Search | absent | The system's search tab, the round button at the end of the tab bar, is there and says `Not in the app yet` |
| Trash (`/pages?view=trash`) | absent | |
| Account menu | built, minimal | The More button (`ellipsis`) at the end of the navigation bar; there is no account button. Rows: the account's address as the server last gave it, "Sign out" while a session is stored, and in Debug builds "Round trip · N of M pages fail" when any page fails. "Sign out" tries once to send what is waiting and, when changes are still not sent, asks before discarding them ("2 changes not sent", "Sign out and discard", "Cancel") |
| Changes not saved (the web's banner) | built, merges first | The app settles a held tick itself before asking: dropped when the server already has the status, sent again on the loaded revision (once) when only something else about the to-do changed, held only when the to-do now has another status or is gone. A tick the server says may already be in is held and asked about unless the server already has its status (then dropped): the app cannot tell whether another device undid it. The web asks (Keep mine) in every case, never automatically. What is held shows as a red `exclamationmark.triangle` button in the navigation bar, between Next day and More, on every day. Its menu has one section per held change titled with the web's sentence, with "Keep mine" (when the server held it) and "Discard", and a last line "1 later change waiting" when ticks wait behind a held one. A day's words the app keeps and will not send (the page is gone or in Trash, or the server would not take them) come first, one section each titled with the day and why ("Tue, Nov 3 · This page is in Trash"), with "Copy draft" and "Discard draft". The web's link from the name to its row is absent |
| Account settings (time zone, delete account, reminders) | absent | |
| Sign-in (`/sign-in`) | built | Email, password, "Sign in"; one line under the button for a refusal, in the web's words. The session is kept in the Keychain |
| Sign-up (`/sign-up`) | absent | |
| Password reset ("Forgot password?") | absent | |
| Forms (`/form`) | absent | |
| Review (`/review`) | absent | |
| Load failure | built | "Couldn't load" and "Retry" when there is no copy to show; a prompt over the copy when there is |

## Block and inline kinds

The app reads a page's document into rows, depth first, nested as written. A kind it does not draw becomes a
placeholder row: its name and a dashed rectangle, no content, and its children are not listed.

| Kind (web) | App | What the app draws today |
| --- | --- | --- |
| Paragraph | built, typed into | Body text |
| Headings 1 to 3 | built, typed into | Title 1, 2, 3 text styles, bold; a level outside 1 to 3 is drawn as 2 |
| Bullet list item | built, typed into | A bullet marker and the text; children are indented |
| Numbered list item | built, typed into | "1." and on, counted per run of siblings (from its `start` when it has one) |
| Quote | built, typed into | Body text with a bar at the leading edge |
| Divider | built | One hairline; made by `---`, removed by Backspace on the line under it |
| To-do row (`task`) | built, typed into and ticked | Its words are typed into like any line's. The status of its to-do, as the copy has it with the ticks not yet answered played over it: open, done, cancelled. Done and cancelled are dimmed and struck through. A tap on the circle (a button, VoiceOver "Complete …") ticks an open to-do and reopens a done one in the frame it is tapped, with a light haptic; a second tap within 500 ms is dropped. A cancelled to-do, one the copy does not hold and one of a status the app does not know cannot be ticked. A repeating to-do's next one appears when the server answers. Paused is read but not drawn. A to-do typed in the app is drawn open and can be ticked at once, before its save (see Editing). Its marks and actions are the next rows |
| A to-do row's marks | built | The web's, in its order and words (held to the web's by shared cases): `Cancelled`; the date tag (`Due tomorrow`, `Was due Tue` in red, `Start Tue · Due Mon 12/7`, …); `Since Nov 19` on today's plan row of a to-do carried a week or more; the repeat mark (the `repeat` symbol, read by VoiceOver as `Repeats every week`); `Reference` and `Moved to Fri 11/27` at regular width only, as the web hides them on a phone; `Blocked by Buy paint` (or `Blocked by 2`) on a line of its own, words only. A done row shows none of them, and a cancelled row only `Cancelled`, except that a done or cancelled reference row keeps `Reference` at regular width, as the web draws it whatever the status. **Differs:** on one quiet line under the words (footnote, secondary colour), where the web puts them at the line's end |
| A to-do row's actions | built | The web's `rowMenu`, case for case: `Tomorrow`, `Not today` (`Not on Fri`, `Remove from Fri`), `Plan for today`, `Bring to today`, Another day (`This weekend`, `Next week`, `Pick date…`, the system's calendar), `Cancel task`, `Restore`. Each says what it did in a notice at the top, in the web's words, with `Undo` while the server can still undo it (the web's rule: nothing of his waits to be sent and the server's one Undo slot is that action's). The reference row's own `Plan for today` button is on every open reference row, as on the web. **Differs:** the actions are reached by a trailing swipe (the phone bar's first actions, then `More` with the rest) and by a touch and hold on the row's circle (all of them, the web's `⋯` order), and ⌘/ at the caret, not a handle on the caret's line; the row being typed in has no swipe. Nothing is drawn ahead: an action is sent and waited for, so it needs a connection (offline: `Not done · your text is kept`), and while it is out its row is dimmed. A to-do typed and not saved has its actions too: its words are saved first. The repeat editor, the Blocked by picker, Copy, Copy link to line, Comment and the notice after a tick are absent |
| Imported checklist line (`sourceChecklist`) | placeholder | Shown as "Block" |
| Date chip (`@date`) | built as text | The chip's stored text, as the web's plain text reads it. Not drawn as a chip. In a line being typed into it is one position wide: it can be deleted, not typed into, and is written back as it was read |
| Page reference (`[[`) | built as text | The page's title, or "Untitled". Not drawn as a chip, not tappable. A line link is read the same way. In a line being typed into, one position wide, as a date chip |
| Link | built, not tappable | Underlined in the link colour; the address is kept, a tap does nothing. Words typed inside it stay in it; typed right after it, they do not |
| Text styles | built in part | Bold, italic, strike, underline and code are drawn, and words typed inside a styled run take its styles. Text and background colour are not read, and are written back as read. No style can be set from the app |
| Page card (`pageLink`) | placeholder | "Page" |
| Database block | placeholder | "Database" |
| Synced block | placeholder | "Synced block" |
| Button | placeholder | "Button" |
| Smart note | placeholder | "Smart note" |
| Image | placeholder | "Image" |
| File | placeholder | "File" |
| Table | placeholder | "Table" |
| Code | placeholder | "Code" |
| Any other type | placeholder | "Block" |
| Comments (on a block or on words) | absent | Nothing in the app reads or shows them |

Not checked: whether the web can write block types beyond those listed (BlockNote has audio and video blocks). The
app shows any type it does not know as "Block".

## Editing

A day page's lines, as on the web's page (`docs/design/native-phase-1.md` §10). Pages that are not days are only
shown.

| Web | App | What the app does today |
| --- | --- | --- |
| Typing in a line | built | A tap puts the caret there; a tap under the last line puts it at that line's end (or in a new paragraph after a block that holds no words). The system's autocorrection, dictation and input methods; Chinese with Pinyin is checked on the simulator |
| Return | built, the web's rules | Splits the line (a list item makes another, a to-do another to-do with its own `taskId`, a heading a paragraph); on an empty list item or to-do, the line becomes a paragraph; on an empty nested paragraph, it moves out a level; at the start of a line with words, an empty line goes in above. While an input method composes, Return only commits. **Differs:** at the start of a to-do with words the app puts an empty to-do above and leaves the row and its to-do alone (the web moves the words to a new to-do, so a done or dated one would lose them); a to-do split in two keeps its styles in both halves (the web drops them) |
| Backspace at a line's start | built, the web's rules | A list item, quote, heading or to-do becomes a paragraph (a to-do lets go of its to-do); a paragraph joins the line above; the divider above goes; an empty to-do's row goes. **Differs:** under a synced block or a database, nothing happens (the web joins the line into the synced block's last line, which writes it into every page showing that block) |
| Tab, Shift-Tab | built from a hardware keyboard and on the Mac | Nesting as on the web, never under a heading or a block the app does not draw the inside of. The phone has no buttons for it yet (they come with the formatting bar, 1f) |
| Typed shortcuts | built | `# `, `## `, `### `, `- `, `* `, `1. ` (any number), `[] `, `> ` at the start of a paragraph, and `---` on a line of its own. Backspace right after puts the characters back. Inside a to-do they are characters |
| Arrow keys between lines | built from a hardware keyboard and on the Mac | Up and down move to the next line at the top and bottom of a line |
| Paste | built, plain text only | Line breaks and tabs become spaces; the web pastes lines and blocks |
| Selecting across lines, dragging lines, `/`, `@` and `[[` menus, the formatting bar, styles from the keyboard | absent | |
| Undo | built in part | Typing inside one line is the text view's own undo; a split, a join and a removed row cannot be undone. A row action's Undo is the notice's button (see the to-do row's actions); the system's undo gestures and ⌘Z do not undo a row action |
| When it is saved | built | Kept on the device the moment it is typed, under his account, and drawn from there after a relaunch, offline too. Saved 450 ms after the last change, as on the web, and at once when he leaves the day, when the app leaves the foreground and when the network comes back. While an input method composes, the words already committed are saved on that same schedule; what is being composed is never in the document until it is committed |
| A page changed on the server while he typed | built, merged without asking | **Differs:** the app merges the page line by line against the page he started from (each line's kind, properties and words on their own), so his lines and the other device's are both kept, and says `Latest loaded · your changes are below their lines` only when a line was changed by both differently (the server's stays and his words go in a line below it). The web's "Load latest" merges only when he presses it, adds every line he touched as a copy below the server's page, and turns a changed to-do into a bullet |
| A to-do typed and then ticked | built, before its save | **Differs:** the app draws a new to-do as open from the words on the device, so it can be ticked at once, offline too; the tick waits behind the page's save. The web cannot tick it until the save lands |
| What he sees about saving | built | Nothing while a save is on its way or has landed. Under the title, only when it matters: `Offline · saves when you're back`, `Not saved yet · trying again`, `Couldn't save · draft kept` (the web's words). Words the server will not take are kept, with "Copy draft" and "Discard draft" in the "Not saved" menu |

## Commands the app sends

- `task-status` (`status` `done` or `open`, with `today`, the account's day): a tick. It goes through the outbox, is
  kept on the device until the server answers, and is sent without him doing anything when the server can be reached
  (after 2 s, 5 s, 15 s, then every 30 s, and at once when the network comes back). `readsBeyond` is false. When the
  server holds or refuses one, the app loads the workspace in the same pass, so the row shows what the server has and
  "Keep mine" is sent on it, as the web's resync does. A tick held for `conflict`, `changed-since` or `maybe-applied`
  is merged after that load without asking: dropped when the to-do already has its status, sent again once on the
  loaded revision when the to-do still has the status it was tapped from, held otherwise; it stays drawn meanwhile.
  One held for `maybe-applied` is only dropped (the server has its status) or held, never sent again.
- `ensure-day`: the engine asks for today's page when the copy has none and none is in Trash, through the outbox,
  once per load while that holds. "Add page", "Create page" and "Add a new page" send it for their day,
  waiting for the answer, not through the outbox.
- `restore-batch` (the page's `trashId`): "Restore" on a day whose page is in Trash, waiting for the answer.
- A command waited for ("Add page", "Create page", "Add a new page", "Restore") that the server holds
  because the copy is behind is sent once more after a load, so it works after another device wrote; any other hold
  or refusal is followed by a load before "Couldn't … · try again" shows, so trying again is built on what the
  server has, as the web resyncs before a retry.
- The network coming back after the app found itself offline loads the workspace, whether or not anything waits to
  be sent, so "Offline · showing what was last loaded" goes when the outage does.
- `save-editor`, the web's save, through `POST /api/v1/saves` with `{ operationId, expectedRevision, expectedOwner,
  action }`: the page's id, the content key of the page his words started from (`expectedContent`), the whole
  document, `singleDeleteIds` (the rows he removed one at a time, in the web's two cases: Backspace on an empty
  to-do, and Backspace turning the page's first line from a to-do into a paragraph), `today` and `at`. A block he did
  not touch is written exactly as it was read; a new block has the web's id form and props. One save per page is on
  its way at a time, sent again as it was (the same operation id) until answered, so a save that landed with its
  answer lost is recognised, not made twice; newer words go as the next save. Saves and ticks go in one queue in
  the order made, so a tick on a to-do typed offline follows its page's save. "Saved elsewhere" loads and sends the
  same save once more if the page is as it was; "Page changed elsewhere", or a load that brings a changed page, is
  merged (see Editing) and saved. A page gone or in Trash, or a document the server will not take, is not sent
  again: the words are kept on the device. A save refused for another account (`expectedOwner`) loads and stops.
- "Sign out" counts words not saved with the changes not sent.
- A row's actions (slice 1c), each sent and waited for, not through the outbox, with `readsBeyond: true`, on the
  copy's revision (a stale copy is loaded and the command sent once more), and only after his words on that page are
  saved in the same pass; never while the page still has a draft (then `Not done · your text is kept`):
  `plan-task` (`taskId`, `date`, `from` the page's day, `today`) for `Tomorrow`, an Another day option and a picked
  day; `plan-task` without `from` for `Bring to today` and `Plan for today`; `not-today` (`date` the page's day,
  `onlyThisDay: true`) for the off item; `task-status` `cancelled` or `open` (with `today`) for `Cancel task` and
  `Restore`; `undo` (`targetOperationId`) for the notice's `Undo`. `today` is the account's day, where the web sends
  the device's.

Nothing else is sent: no delete of a page, no repeat or blocker change, no date set.
