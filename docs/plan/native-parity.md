# Native app: what it holds against the web app

- Author: Claude · 2026-11-25 · status: **phase 1a built and seen on the simulator**, its check on his own data to
  come (`docs/plan/native-phase-1a.md`, task 11); phase 0 before it (`docs/plan/native-phase-0.md`).
- The app ticks a to-do and starts or restores a day's page; nothing else is changed from it. This list is checked
  against the Swift code, not the plan; where it says "draws", the code draws it today. Update it in the same change
  as any screen or block kind it names.
- Marks: **built** (the app has it, and the note says how much), **placeholder** (the app shows a named stand-in and
  no content), **absent** (the app has nothing for it).

## Screens

| Web | App | What the app does today |
| --- | --- | --- |
| Today (`/`) | built | The account's day page from the copy on the device, offline too. Large title is the day ("Thursday, Oct 22"). Moves at the account's midnight, not the device's. Pull to refresh; refreshes when the app becomes active and when the day changes. Asks the server for today's page when the copy has none and none is in Trash. A to-do can be ticked (see the to-do row) |
| A past or future day (`/day/$date`) | built | The same screen, in place (no Back). The system's toolbar at the bottom holds Previous day, Calendar and Next day (Next stops at today, as on the web), and "Today" beside Next while another day is open; the navigation bar keeps the title and the account. Any day, future ones too, from the system's calendar with a dot on each day with something written. A day without a page says so instead of making one: "No page for …" with "Add page", "… hasn't happened yet" with "Create page", and a page in Trash with "Restore" and "Add a new page" (the web says "No page for … yet", "Start this page" and "Start a new page"). The web's lists of what is planned or due on a future day are absent |
| Tasks (`/tasks`) | absent | |
| Upcoming | absent | Part of Tasks on the web |
| Calendar (`/calendar`) | absent | |
| Pages and the tree (`/pages`) | absent | |
| A document page | absent | The row drawing exists (see below) but only the day screen uses it |
| Tags (`/tags`, `/tags/$tag`) | absent | |
| Search | absent | |
| Trash (`/pages?view=trash`) | absent | |
| Account menu | built, minimal | One button. Rows: the account's address as the server last gave it, "Sign out" while a session is stored, and in Debug builds "Round trip · N of M pages fail" when any page fails. "Sign out" tries once to send what is waiting and, when changes are still not sent, asks before discarding them ("2 changes not sent", "Sign out and discard", "Cancel") |
| Changes not saved (the web's banner) | built, merges first | The app settles a held tick itself before asking: dropped when the server already has the status, sent again on the loaded revision (once) when only something else about the to-do changed, held only when the to-do now has another status or is gone. The web asks (Keep mine) in every case, never automatically. What is held shows as a red `exclamationmark.triangle` button in the navigation bar, beside the account, on every day. Its menu has one section per held change titled with the web's sentence, with "Keep mine" (when the server held it) and "Discard", and a last line "1 later change waiting" when ticks wait behind a held one. The web's link from the name to its row is absent |
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
| Paragraph | built | Body text |
| Headings 1 to 3 | built | Title 1, 2, 3 text styles, bold; a level outside 1 to 3 is drawn as 2 |
| Bullet list item | built | A bullet marker and the text; children are indented |
| Numbered list item | built | "1." and on, counted per run of siblings |
| Quote | built | Body text with a bar at the leading edge |
| Divider | built | One hairline |
| To-do row (`task`) | built, tick only | The status of its to-do, as the copy has it with the ticks not yet answered played over it: open, done, cancelled. Done and cancelled are dimmed and struck through. A tap on the circle (a button, VoiceOver "Complete …") ticks an open to-do and reopens a done one in the frame it is tapped, with a light haptic; a second tap within 500 ms is dropped. A cancelled to-do, one the copy does not hold and one of a status the app does not know cannot be ticked. A repeating to-do's next one appears when the server answers. Paused is read but not drawn. No cancel, no dates, no menu, no Undo |
| Imported checklist line (`sourceChecklist`) | placeholder | Shown as "Block" |
| Date chip (`@date`) | built as text | The chip's stored text, as the web's plain text reads it. Not drawn as a chip |
| Page reference (`[[`) | built as text | The page's title, or "Untitled". Not drawn as a chip, not tappable. A line link is read the same way |
| Link | built, not tappable | Underlined in the link colour; the address is kept, a tap does nothing |
| Text styles | built in part | Bold, italic, strike, underline and code are drawn. Text and background colour are not read |
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
| Editing of any kind | absent | The cells only show text |

Not checked: whether the web can write block types beyond those listed (BlockNote has audio and video blocks). The
app shows any type it does not know as "Block".

## Commands the app sends

- `task-status` (`status` `done` or `open`, with `today`, the account's day): a tick. It goes through the outbox, is
  kept on the device until the server answers, and is sent without him doing anything when the server can be reached
  (after 2 s, 5 s, 15 s, then every 30 s, and at once when the network comes back). `readsBeyond` is false. When the
  server holds or refuses one, the app loads the workspace in the same pass, so the row shows what the server has and
  "Keep mine" is sent on it, as the web's resync does. A tick held for `conflict`, `changed-since` or `maybe-applied`
  is merged after that load without asking: dropped when the to-do already has its status, sent again once on the
  loaded revision when the to-do still has the status it was tapped from, held otherwise; it stays drawn meanwhile.
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

Nothing else is sent: no edit, cancel, delete or Undo.
