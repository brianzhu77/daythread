# The native app's system

- Author: Claude · 2026-11-25 · status: **started in phase 0; the strings of phases 1a, 1b and 1c added and seen on the simulator** (1c's
  screenshots in `tests/evidence/native-phase-1c/`). Brian's rule (2026-11-25): where a system component
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
| Undo | The notice's only button (a plain system button, footnote text), and the notice's accessibility action of the same name. The notice's other words are composed by the app from `native-phase-1.md` §11.5's table and are listed below |
| Moved to Fri, Nov 27 | The notice after a move (`Tomorrow`, an Another day option, a day picked); the day in the long form. 8 seconds, with `Undo` while it is offered |
| On today | The notice after `Bring to today` on a past day, and after `Plan for today` from a reference row's swipe or menu. 8 seconds, with `Undo` |
| Planned for today | The notice after the reference row's own `Plan for today` button. 8 seconds, with `Undo` |
| Not today — won’t carry over, Not on Fri 11/27 | The notice after the off item when the to-do was set aside: the first on today's page (an em dash and a typographic apostrophe, as the web writes it), the second on another day's. 8 seconds, with `Undo` |
| · due Fri still tracked | Added to those two when the to-do has a Due date: `Not today — won’t carry over · due Fri still tracked` |
| Removed from Fri · still planned for Mon | The notice after the off item when only a stale row left (the server's message begins `Removed from`): the row's day, then the day the to-do is planned for after the answer. 8 seconds, with `Undo` |
| Cancelled | The notice after `Cancel task`. 8 seconds, with `Undo` |
| · Next Mon, Dec 7 | Added to `Cancelled` when the server's receipt names exactly one next to-do of a repeat (`Cancelled · Next Mon, Dec 7`; the year only when it is not this one's) |
| Restored | The notice after `Restore`. 8 seconds, with `Undo` |
| Undone | The notice after `Undo` went through. 4 seconds, no button |
| Can't undo · changed since | The notice when the server refused the Undo because something changed since ("Cannot undo after later changes"). 6 seconds, no button; a straight apostrophe, as the web |
| Couldn't undo · your text is kept | The notice when the Undo failed for any other reason (no connection, his words not saved first). 6 seconds, no button |
| Not done · your text is kept | The notice when a row action was not sent (the page's words could not be saved first, or no connection), failed or was refused: nothing changed. 6 seconds, no button. The web's words |
| (the rest of the row's actions), Cancel | `More` in a row's swipe opens the system's action sheet (`UIAlertController`, `.actionSheet`, default look): the Another day options, `Pick date…` and `Cancel task` (destructive) in the web's order, then the system's `Cancel`. A popover from the row, on a wide screen and, on iOS 26, on the phone too, where the system shows no `Cancel` item: a tap outside the popover puts it away |
| (the system's calendar) | `Pick date…` opens the system's calendar (`UICalendarView`, as the day's title opens it): no day selected, today the first that can be picked, the days before it greyed by the system. A popover from the row on a wide screen, a sheet on the phone; picking a day closes it and moves the to-do there |
| Complete <the to-do's words> | A to-do circle's VoiceOver label, the web's; its value is "done", "cancelled" or "not done" |
| Cancelled | A to-do row's marks line, under its words (footnote, secondary colour), on a cancelled to-do's row; the only mark such a row draws besides `Reference` |
| Due today, Due tomorrow, Due Sun, Due Wed 12/2, Due that day, Start tomorrow, Start Mon · Due Sun 12/6, Unscheduled | The date tag, first on an open to-do's marks line; the web's words (`taskDateTag`), with the day worded against today, or against the row's own plan day for a plan row |
| Was due Mon | The same tag when the Due date has passed (before today and the row's day), in the system's red; the line's only red |
| Since Nov 3 (Since Nov 3, 2025) | The same line, on today's plan row of an open to-do carried for a week or more; the year only when it is not this year's |
| `repeat` symbol | The same line, on an open to-do that repeats: the symbol alone (a text attachment, footnote size, secondary colour); VoiceOver reads the repeat's name, `Repeats every week` (`Repeats every 2 weeks on Mon, Thu`, …) |
| Reference | The same line, on a reference row (any status, as the web), at regular width only (iPad, Mac); a phone does not draw it |
| Moved to Fri 11/27 | The same line, on a plan row whose to-do was planned on a later day since, at regular width only |
| Blocked by Buy paint, Blocked by 2 | A line of its own under the marks (or alone in their place), on an open to-do blocked by open to-dos: the blocker's title for one, the count for more |
| Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint | The marks line's VoiceOver label: one element after the words, the marks drawn at that width, in order, comma-joined |
| Tomorrow, Not today, Not on Fri, Remove from Fri, Plan for today, Bring to today, Restore, More | A to-do row's trailing swipe (the system's swipe actions, default look), the web's phone bar's first actions then `More`: today's plan row `Tomorrow` (unless planned tomorrow), the off item, `More`; a later day's plan row the off item (`Not on Fri`, or `Remove from Fri` when the to-do is planned on another day), `More`; a reference row `Plan for today` (unless planned today), `More`; a past day `Bring to today`; a cancelled row `Restore`. `More` is there when the menu holds more and is reported, the host shows what it holds. No action runs on a full swipe. None on a done row, a text row, the row being typed in, or anywhere while words are selected |
| Tomorrow · Fri, Nov 27, Another day, Tomorrow · Fri 11/27, This weekend · Sat 11/28, Next week · Mon 11/30, Pick date…, Cancel task | The row's menu: every action in the web's `⋯` order, as the system menu of the row's circle (a touch and hold, a click and hold or a secondary click; a tap still ticks). `Tomorrow · Fri, Nov 27` and the off item first on a plan row (`Plan for today` first on a reference row, `Restore` alone on a cancelled one, `Bring to today` alone on a past day), then `Another day` as a titled inline group of the web's options (`Tomorrow · Fri 11/27` only where Tomorrow is not already first) and `Pick date…`, then `Cancel task`, the one destructive item. The same menu opens with ⌘/ at the caret of the row being typed in (the system's edit menu), and its items, flattened, are the words' VoiceOver custom actions |
| Plan for today | The reference row's own button, on every open reference row (also one already planned today, as the web): a plain system button, caption text in the secondary colour, at the row's trailing end, level with the words' first line, the words and marks ending before it; from the accessibility text sizes it goes under the words and marks, where they start, and the words keep the row's width (as the web wraps it under a title that would get too narrow, and as the notice puts its button) |
| Lunch with Kathy · 10:30 AM Standup with Lu | The events line, the strip's first part, on today when today has an event: the `calendar` symbol and the first two events, each `10:30 AM Standup with Lu` (`3 PM` on the hour; the title alone when it has no time), joined by ` · `, on one line cut at its end; at the accessibility text sizes the words take the whole width after the symbol, on up to three lines, then cut (a word that fits on a line is never broken), with `+N more` and the chevron on a line of their own under them. A plain system `Label`, subheadline text, the words and the symbol in the secondary colour: quieter and a little smaller than the page's text, as on the web |
| Untitled event | An event in that line whose line has no words |
| · All day | Added to that line when today has exactly one event and it has no time: `Lunch with Kathy · All day` |
| +1 more (+N more) | After that line's words when there are more than two events, at the end of the line; at the accessibility text sizes on a line of its own under the words, at their leading edge, with the chevron. Never cut |
| `chevron.right` | After the events line only when it is a button (the page has a top-level heading `Events`, which a tap scrolls to); small, in the secondary colour, never cut. With no such heading the line is words, with no chevron |
| Lunch with Kathy · 10:30 AM Standup with Lu, +1 more | The events line's VoiceOver label: one element, its words then `, +N more`; the button trait only when it is a button |
| DUE SOON | The label of the strip's second part (a system `GroupBox`): `Due soon` drawn in capitals (`.textCase(.uppercase)`), footnote semibold in the secondary colour, as the web's small label, so it does not compete with the page's headings. On today and any past day, and on a later day only when it has a page: every open to-do due or started by that day that has no row on that day's page, its words then its tag. Each row of `Due soon` and of `Not today` is at least 44 points tall with its content centred, as the web's rows; a tag under its words stays with them, closer to them than to the next row |
| Due today, Was due Mon, Start today, Due that day, Unscheduled | A `Due soon` or `Not today` row's tag, the web's `taskDateTag` (footnote, secondary colour, one line, at the row's end, or under the words when the two do not fit; the words wrap. At the largest text sizes a tag wider than the strip itself, such as `Not today · Due today`, wraps under the words rather than be cut). None is red: the strip does not mark a passed date, as on the web (a page's row does). A row whose tag is empty shows its words alone |
| Not today · Due today, Not today | The tag of a `Due soon` row for a to-do he set aside: `Not today · ` then its tag, or `Not today` alone when its tag is empty |
| Not today · 3 (Not today · N) | The title of the strip's last part, on today when a to-do is set aside: a system `DisclosureGroup`, folded when the page opens, its title in the secondary colour (a quiet control, as the day's ghost buttons; the system draws its chevron in the label colour, which neither the tint nor the foreground changes); the fold is forgotten when he leaves today or the list empties. Each row: its words and tag, then under them `Bring back` (the system's bordered button, its title in the label colour, not the accent) and the `ellipsis` menu in the secondary colour. A disabled control keeps the system's disabled look |
| Another day, Tomorrow · Fri 11/27, This weekend · Sat 11/28, Next week · Mon 11/30, Pick date… | A `Not today` row's menu: one section titled `Another day`, the web's options for the weekday (`This weekend` Monday to Thursday only), then `Pick date…` |
| File the taxes, Due today | A strip row's VoiceOver label: its words, then its tag (the words alone with no tag); `Bring back` and the menu are elements of their own |
| More for Fix the bike | A `Not today` row's menu button's VoiceOver label: `More for <words>` |
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
  symbol replace transition), at least 44 points square, level with the middle of the words' first line at every size
  (as on the web, whether the words wrap or marks lie under them), and the text; a finished one in secondary colour, struck
  through. It keeps the system's pressed look; one that cannot be ticked keeps its status's colour, not the system's
  disabled grey, since a cancelled to-do's `xmark.circle` is its status, not a control turned off.
  - **The marks line** (slice 1c) is not a view of ours: it is the list content configuration's secondary text, so
    the system places it under the words, with its own spacing, margins and wrapping at every text size. Footnote in
    the secondary label colour, a passed date tag in the system's red, the repeat mark the `repeat` symbol as a text
    attachment, ` · ` between marks, `Blocked by …` after a line break. The cell picks the marks for its own horizontal
    size class, so a rotation or a resized window redraws them without new rows. The words keep the first line and
    their width; a tap on the marks puts the caret in the words. A row with no marks has no secondary text and is
    drawn as before. VoiceOver reads the row as the circle, the words, then the marks as one element.
  - **The row's actions** (slice 1c) are the system's: the list's trailing swipe, the circle's own menu, the edit
    menu for ⌘/, VoiceOver custom actions on the words. The one control added to a row is the reference row's
    `Plan for today` button, placed on the cell as the circle is, with the content's trailing margin (from the
    accessibility sizes its bottom margin) widened by its size so the system lays the words and marks out clear of
    it; it takes its own touches, and a touch on the
    marks line goes to the words (the caret at their end). While an action is out, its row's words and marks are
    drawn in the tertiary label colour, in place.
- **Separator:** one hairline in the system's separator colour.
- **Placeholder:** a `rectangle.dashed` symbol and the block's name in secondary colour.

The strip above a day's page (`DayFactsView`, in `native/Packages/DaythreadUI`, slice 1d.1), the one SwiftUI view on
the day screen, under the title's stack in the page's header, so it scrolls away with the title:

- **Parts:** SwiftUI's stock parts, configured, never restyled: a `Label` (the `calendar` symbol) in a plain `Button`
  for the events line, a `GroupBox` titled `Due soon`, a `DisclosureGroup` titled `Not today · N` with a bordered
  `Button` and a `Menu` under the `ellipsis` symbol on each row. Each part is absent when it has nothing; with
  nothing at all the strip is hidden and takes no room. Quiet, as the web's: nothing in it is drawn in the accent
  colour (the tint is set to the label or secondary label colour, a configuration of the system's parts). Spacing
  between the parts is SwiftUI's default; a row of `Due soon` or `Not today` is at least 44 points tall (8 points of
  air above and below its words); the header's own system spacing lies between the title's stack and the strip.
- **Width and height:** the header's full width inside its margins (the page's lines start where it starts), at
  every width; no padding of its own. Its height is its own, at every text size: a row's words wrap, a tag never
  does and goes under the words when the two do not fit. Every change of its height (the fold, a row coming or
  going, the text size) lays the page's header out again on the run loop's next turn, and while a line holds the
  keyboard that line stays where it is on the screen.
- **While an action is out** (slice 1d.1's next part): every button and menu of the strip is disabled, and the acting
  row's words are in the tertiary colour. The fold itself stays usable: opening or closing `Not today` sends nothing.

The notice (`NoticeView`, in `native/Packages/DaythreadUI`; `native-app.md` §9 rule 3), the one line of words that
says what a row action did:

- **Look:** a floating surface of the system's material (`UIBlurEffect(style: .systemMaterial)`; not the glass,
  which on the device's screen let the rows beneath read through the words) with the system's capsule corners, capped at 560 points and centred, with a 16-point gutter on a phone.
  The words are footnote text in the label colour, they wrap at any text size (the button goes under them from the
  accessibility sizes), and `Undo` is a plain system button at least 44 points high. No colour, font, shadow or
  radius of its own.
- **Place:** on a phone (compact width, or compact height on its side), directly under the status bar, as the web's
  phone notice sits: its top 8 points under the window's top safe-area inset (the status bar or the island), over the
  navigation bar's band, whose previous and next-day buttons it covers while it shows; the day's title and the
  first rows of a page at its top stay uncovered. The day screen holds it above its navigation bar for that. At
  regular width (iPad, Mac) one system spacing under the navigation bar, never over its items. Only its surface takes
  touches; the rest of the screen is the page's. It never becomes first
  responder, so the keyboard and the caret stay as they were.
- **Time:** one at a time, a new one replaces the one showing. It leaves after 8 seconds, `Undone` after 4, a failure
  after 6, or when swiped up (also VoiceOver's escape gesture). A tap on the words does nothing.
- **VoiceOver:** the words are announced when shown; while the notice has `Undo` it does not leave on a timer, and
  once `Undo` is spent or withdrawn its time runs from then. The words are an accessibility element that carries
  `Undo` as its custom action, and the button is an element of its own, so Voice Control and Full Keyboard Access
  reach it. A button that is withdrawn, or used once, never comes back. Because it does not time out while
  VoiceOver runs and `Undo` is offered, on a phone it stays over the previous and next-day buttons until `Undo` is
  used or withdrawn or the notice is dismissed (VoiceOver's escape gesture, or a swipe up).
- **When `Undo` is there** (slice 1c): only while nothing of his waits to be sent (no draft, no queued tick, no
  words on their way to the engine) and the copy says the server's one Undo slot is that action's at the copy's own
  revision. It is withdrawn the moment that stops (he types, he ticks, another device's change or the day's new page
  takes the slot, another row action starts), and the notice's words stay until their time. While an action or an
  Undo is out, its row is dimmed and no other row action runs.

## Not decided yet

Phase 1 must settle:

- Row spacing on a page.
- How date chips and page references are drawn (today they are plain text).
- Which of the web's five places has no tab on the phone. A phone's tab bar holds five items, the search tab
  included, and a sixth puts Tags and Search behind the system's More tab (seen on the simulator, 2026-11-26). Until
  Brian chooses, Tags has no tab (`docs/design/native-phase-1.md` section 6).
