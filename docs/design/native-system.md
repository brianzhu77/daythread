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
| Offline · showing what was last loaded | The status line, in the day's header under the title (footnote, secondary colour), when the device is offline and a copy is shown |
| Offline · showing what was last loaded · 1 change will be sent (· N changes will be sent) | The same line, with changes waiting to be sent; the web's words |
| Changes aren't kept on this device | The status line when the store on the device could not be opened; it comes before offline and a failed update |
| Couldn't update · showing what was last loaded | The same line, when a pass failed for any other reason |
| Couldn't save · draft kept | The status line while the page's draft is kept and not sent (its page is gone or in Trash, or the server would not take it); the web's words. It comes right after "Changes aren't kept on this device", before every other line |
| Offline · saves when you're back (· 1 change will be sent, · N changes will be sent) | The status line when the device is offline and the page on screen has words not saved; it takes the place of "Offline · showing what was last loaded", with the changes waiting to be sent said after it. The web's words |
| Not saved yet · trying again | The status line when the page's save failed for a reason other than the network and goes again on the schedule; before "Couldn't update · …". The web's words |
| Latest loaded · your changes are below their lines | The status line after the page on screen was merged with the server's and a line both changed went in twice (the server's, then his below it); until he types again. After the lines about his unsaved words, before "Offline · showing what was last loaded". The web's words |
| Couldn't load, Retry | The whole screen, when a pass failed and there is no copy to show |
| Today, Yesterday, Tomorrow | The small word above the day's title when the day is one of these (subheadline, semibold; `Today` in the app's tint, the others in the secondary colour). The day's header is the page's first row and scrolls with it; the navigation bar has no title |
| Tue, Nov 3 | The day's title, the web's `longLabel`: short weekday, month and day in the reader's language, no year (large title, bold; it grows with the text size up to accessibility extra large and no further, as the system caps its own large titles, so every date of a year stays one line on an iPhone 17), with a small `chevron.down` in the secondary colour after it. It is one plain button; it opens the system's calendar, a dot on each day with something written, in a popover anchored to it (a sheet on the phone) |
| Today, Tue, Nov 3. Choose a date | The title button's accessibility label, the web's; the relative word only when there is one |
| Tuesday, Nov 3 | The long form, used only inside sentences; `<day>` below is this text |
| Previous day, Next day | The accessibility labels of the navigation bar's trailing chevrons (`chevron.left`, `chevron.right`, no text): bar buttons with no glass capsule (`hidesSharedBackground`), tinted the secondary label colour. Next is disabled from today on |
| Today | On a regular-width screen only (iPad, Mac): a plain text item before the chevrons, the same quiet look, while another day is open. On the phone the Today tab does it |
| More | The accessibility label of the navigation bar's last item (`ellipsis`, no text, the same quiet look); its menu holds the address and "Sign out". Not shown when its menu would be empty |
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
| Sign out | The More menu, while a session is stored; the address the server last gave is above it, disabled |
| 1 change not sent (N changes not sent), Sign out and discard, Cancel | The alert after "Sign out" when changes are still not sent after one try |
| Not saved | The held button's accessibility label (`exclamationmark.triangle` in the system's red, no text, no capsule), in the navigation bar between Next day and More, shown while a change is held or a draft is kept and not sent. The app merges a held tick itself (dropped when the server has it, sent again when only something else about the to-do changed) and shows this only when both sides changed the to-do's status differently, or the to-do is gone. A tick the server says may already be in is asked about unless the server already has it |
| Not saved — ticked "…" was changed elsewhere | The held menu's section title, held because the row changed elsewhere; the web's sentence, with the change's label |
| Not saved — "…" was deleted elsewhere | The same, for a to-do that is gone ("it" when the label names nothing) |
| Not saved — ticked "…" · changed since | The same, held because something changed since |
| Not saved? — ticked "…" may already be in | The same, held because it may already be applied |
| Not saved — can't do this now: ticked "…" | The same, refused for any other reason; the web's sentence with a straight apostrophe (the web's source writes a typographic one; the app keeps straight apostrophes, as its other strings do) |
| Keep mine, Discard | Each held change's actions; "Keep mine" only when it was held, not refused; "Discard" destructive |
| `<day> · <reason>`: Tue, Nov 3 · This page is in Trash (· This page is gone, · the server's reason) | The "Not saved" menu's section title for a draft the engine keeps and does not send, before the held changes: the page's day in its short form ("Tue, Nov 3", not the long `<day>` above) and why. The button shows for such a draft as for a held change. The day is left out when the copy no longer has the page. A day whose page is in Trash shows its empty state, not the draft's status line |
| Copy draft, Discard draft | That section's actions: "Copy draft" puts the draft's words on the pasteboard as plain text, one line per row; "Discard draft" (destructive) drops the draft, and the page is drawn as the server has it |
| 1 later change waiting (N later changes waiting) | The held menu's last line, disabled, while changes wait behind a held one; the web's words |
| Round trip · N of M pages fail | The More menu, Debug builds only, when any page's document does not write back |
| Untitled | A page reference whose page has no title |
| Complete <the to-do's words> | A to-do circle's VoiceOver label, the web's; its value is "done", "cancelled" or "not done" |
| Database, Page, Image, File, Button, Smart note, Synced block, Table, Code, Block | The names of placeholder rows |
| Today, Tasks, Calendar, Pages | The tab bar's tabs, the web's places in its order: the system's tab bar with its default appearance (the floating glass capsule on iOS 26). Symbols: `<day of month>.calendar` for Today (the account's today, `26.calendar` on the 26th; it changes at the account's midnight), `checkmark.square`, `calendar`, `doc.text` |
| Search | The system's search tab (`UISearchTab`), its own title and symbol, after the four; the system draws it apart, as the round button at the end of the bar |
| <place>, Not in the app yet | A tab whose place is not built yet: its symbol, its name and this line, centred, nothing to press |

The sign-in lines are the web's (`src/routes/sign-in.tsx`).

## Views built because the system has none

The page's cells, in `native/Packages/DaythreadEditor`, all list cells:

- **Text** (paragraph, heading, bullet, numbered, quote): the system's text styles in the user's Dynamic Type size;
  a bullet or number is a drawn image in a column set by the widest number; a quote adds a separator-coloured bar.
  On a day page the words are a system text view (TextKit 2, not scrolling, no inset of its own) lying over the
  row's label, with the system's caret, selection, autocorrection, dictation and input methods; the keyboard is the
  system's default. The line being typed stays above the keyboard, also when the text size changes while it is up.
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
- Which of the web's five places has no tab on the phone. A phone's tab bar holds five items, the search tab
  included, and a sixth puts Tags and Search behind the system's More tab (seen on the simulator, 2026-11-26). Until
  Brian chooses, Tags has no tab (`docs/design/native-phase-1.md` section 6).
