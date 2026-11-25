# Native app: what it holds against the web app

- Author: Claude · 2026-11-25 · status: **phase 0 built except the install on his phone** (`docs/plan/native-phase-0.md`).
- The app is read only. This list is checked against the Swift code, not the plan; where it says "draws", the code
  draws it today. Update it in the same change as any screen or block kind it names.
- Marks: **built** (the app has it, and the note says how much), **placeholder** (the app shows a named stand-in and
  no content), **absent** (the app has nothing for it).

## Screens

| Web | App | What the app does today |
| --- | --- | --- |
| Today (`/`) | built, read only | The account's day page from the copy on the device, offline too. Large title is the day ("Thursday, Oct 22"). Pull to refresh; refreshes when the app becomes active and when the day changes. Asks the server for today's page if the copy has none |
| A past or future day (`/day/$date`) | absent | Only today's page is reachable |
| Tasks (`/tasks`) | absent | |
| Upcoming | absent | Part of Tasks on the web |
| Calendar (`/calendar`) | absent | |
| Pages and the tree (`/pages`) | absent | |
| A document page | absent | The row drawing exists (see below) but only Today uses it |
| Tags (`/tags`, `/tags/$tag`) | absent | |
| Search | absent | |
| Trash (`/pages?view=trash`) | absent | |
| Account menu | built, minimal | One button. Rows: the address signed in on this launch, "Sign out" while a session is stored, and in Debug builds "Round trip · N of M pages fail" when any page fails |
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
| To-do row (`task`) | built, read only | The status of its to-do from the copy: open, done, cancelled. Done and cancelled are dimmed and struck through. A to-do the copy does not hold yet is drawn open. Paused is read but not drawn. No tick, no dates |
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

- `ensure-day`: asks the server for today's page when the copy has none. It goes through the outbox, once per day.

Nothing else is sent. No edit, tick or delete is possible in this version.
