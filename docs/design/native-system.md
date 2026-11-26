# The native app's system

- Author: Claude · 2026-11-25 · status: **started in phase 0; phase 1a's strings added and seen on the simulator.** Brian's rule (2026-11-25): where a system component
  and the web's look conflict, native wins. The rule and its table are in `docs/design/native-app.md` section 9.
  `DESIGN.md` stays the web app's system.

## The rule

1. Use the system component with its default appearance.
2. If it needs to be ours, configure it (the tint, a symbol, a title), never restyle it.
3. Build a view only where the system has none, from system materials, text styles, spacing and colours.

## What is ours

- **The tint:** Thread Blue `#0090ff`, the same in light and dark, as the app's accent colour
  (`native/App/Assets.xcassets/AccentColor.colorset`). The system decides where it shows.
- **The mark:** the app icon (`native/App/Assets.xcassets/AppIcon.appiconset`). Nothing else in the app draws it yet.
- **The voice:** quiet copy. On-screen text states data or state; menus show titles only. The web's terms are kept
  (page, to-do, Today).

## Strings on screen today

| Text | Where |
| --- | --- |
| Offline · showing what was last loaded | The prompt over the day screen, when the device is offline and a copy is shown |
| Offline · showing what was last loaded · 1 change will be sent (· N changes will be sent) | The same prompt, with changes waiting to be sent; the web's words |
| Changes aren't kept on this device | The prompt over the day screen when the store on the device could not be opened; it comes before offline and a failed update |
| Couldn't update · showing what was last loaded | The same prompt, when a pass failed for any other reason |
| Couldn't load, Retry | The whole screen, when a pass failed and there is no copy to show |
| Tuesday, Nov 3 | The day screen's title: weekday, month and day in the reader's language, no year; `<day>` below is this text |
| Previous day, Next day | The accessibility labels of the toolbar's first and last buttons (`chevron.left`, `chevron.right`, no text), at its two ends; Next is disabled from today on |
| Calendar | The accessibility label of the toolbar's middle button (`calendar`, no text); it opens the system's calendar, a dot on each day with something written, in a popover anchored to that button (a sheet on the phone) |
| Today | A toolbar button beside Next, shown only while another day is open |
| No page for <day>, Add page | A past day with no page, in place of the page |
| <day> hasn't happened yet, Create page | A future day with no page, in place of the page |
| Today's page is in Trash. (The page for <day> is in Trash.), Restore, Add a new page | A day whose page is in Trash; "Restore" only when the page names its trash entry |
| Couldn't add a page · try again | The second line of those states when "Add page" or "Add a new page" did not go through |
| Couldn't create a page · try again | The same, when "Create page" did not go through |
| Couldn't restore · try again | The same, when "Restore" did not go through; the web's words |
| Daythread | The sign-in screen's title |
| Email, Password, Sign in | The sign-in form |
| That didn't work · Check the email and password | Under "Sign in", wrong email or password |
| Confirm your email first | Under "Sign in", address not confirmed |
| This address isn't on the invite list yet | Under "Sign in", not invited |
| Too many tries · Try again in 30 s (or in 4 min) | Under "Sign in", when asked to wait |
| Couldn't sign in · Try again | Under "Sign in", offline or any other failure |
| Account | The account button's accessibility label (an icon, no text), the navigation bar's trailing button |
| Sign out | The account menu, while a session is stored |
| 1 change not sent (N changes not sent), Sign out and discard, Cancel | The alert after "Sign out" when changes are still not sent after one try |
| Not saved | The held button's accessibility label (`exclamationmark.triangle` in the system's red, no text), in the navigation bar beside the account button, shown while a change is held. The app merges a held tick itself (dropped when the server has it, sent again when only something else about the to-do changed) and shows this only when both sides changed the to-do's status differently, or the to-do is gone. A tick the server says may already be in is asked about unless the server already has it |
| Not saved — ticked "…" was changed elsewhere | The held menu's section title, held because the row changed elsewhere; the web's sentence, with the change's label |
| Not saved — "…" was deleted elsewhere | The same, for a to-do that is gone ("it" when the label names nothing) |
| Not saved — ticked "…" · changed since | The same, held because something changed since |
| Not saved? — ticked "…" may already be in | The same, held because it may already be applied |
| Not saved — can't do this now: ticked "…" | The same, refused for any other reason; the web's sentence with a straight apostrophe (the web's source writes a typographic one; the app keeps straight apostrophes, as its other strings do) |
| Keep mine, Discard | Each held change's actions; "Keep mine" only when it was held, not refused; "Discard" destructive |
| 1 later change waiting (N later changes waiting) | The held menu's last line, disabled, while changes wait behind a held one; the web's words |
| Round trip · N of M pages fail | The account menu, Debug builds only, when any page's document does not write back |
| Untitled | A page reference whose page has no title |
| Complete <the to-do's words> | A to-do circle's VoiceOver label, the web's; its value is "done", "cancelled" or "not done" |
| Database, Page, Image, File, Button, Smart note, Synced block, Table, Code, Block | The names of placeholder rows |

The sign-in lines are the web's (`src/routes/sign-in.tsx`).

## Views built because the system has none

The page's cells, in `native/Packages/DaythreadEditor`, all list cells:

- **Text** (paragraph, heading, bullet, numbered, quote): the system's text styles in the user's Dynamic Type size;
  a bullet or number is a drawn image in a column set by the widest number; a quote adds a separator-coloured bar.
- **To-do:** a system button holding an SF Symbol (`circle`, `checkmark.circle.fill`, `xmark.circle`, changed with the
  symbol replace transition), at least 44 points square, and the text; a finished one in secondary colour, struck
  through. It keeps the system's pressed look; one that cannot be ticked keeps its status's colour, not the system's
  disabled grey, since a cancelled to-do's `xmark.circle` is its status, not a control turned off.
- **Separator:** one hairline in the system's separator colour.
- **Placeholder:** a `rectangle.dashed` symbol and the block's name in secondary colour.

## Not decided yet

Phase 1 must settle:

- Row spacing on a page.
- How date chips and page references are drawn (today they are plain text).
- The tab bar: whether the five places and Search fit the system's bar (`docs/design/native-app.md` section 9).
