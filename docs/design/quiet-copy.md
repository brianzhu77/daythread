# Quiet copy (Brian 1ac6784b, 2026-10-31)

Brian: "the app is minimalist; don't put in useless descriptions." Bumblebee's test (6d7fa8b0): **keep text that states
his data or warns before something is lost; drop text that explains how the app works.** This note supersedes the
quoted lines in older states docs and specs.

## Removed

| Where | Was | Now |
| --- | --- | --- |
| Template page | "New pages start from this template. To-dos are copied empty." | gone (PR #41) |
| Templates list | "Day pages start with TODO, Events, Good Stuffs and Notes. · Edit" | a plain **Day** row, "Default for day pages" (PR #41) |
| Today, first day | "A page for each day. Write anything; unfinished to-dos come along to tomorrow." | gone |
| Tomorrow block | "N unfinished to-dos come along in the morning." | gone; the morning card shows them |
| Pages, empty | "No pages yet. Use + to start one." | "No pages yet" |
| Search, nothing typed | "Type to search everything you've written · ↑↓ to move · Enter to open · Esc to close" | gone |
| Search placeholder | "Search pages, days, lines and tags" | "Search" |
| Search, no match | "Search looks at page titles, days, every line and every #tag…" | gone; "Nothing matches “…”" stays |
| Search, many lines | "N more lines match · keep typing to narrow it down" | "N more lines match" |
| Tags, empty | "Type # and a word anywhere in a note, like #work. A tag ends at…" | "No tags yet" |
| Trash | "Deleted pages stay here until you restore them. Tasks inside them keep working." | gone |
| Past day task rows | "Shown at current status" tag | gone |
| Future day (opened by URL) | "There's no page for this day. You can start one now if you want to plan ahead." | gone; heading + Create page |
| Future day prompt (Calendar) | "Create its page now to plan ahead? It starts from your day template." | gone; heading + buttons |
| Slash menu | second lines ("Checkbox that becomes a task", "Section", "The body of your document"…) | titles only |
| Preview, phone | "Preview · notes written here stay here" | "Preview", as on a laptop |

## Kept, and why

- Errors, Retry, "Not saved", conflict and offline lines; Undo notices: state of his data.
- Delete-account confirmation; "This page isn't listed." in Move to (explains a missing choice).
- Add to Home Screen hint (dismissable; he asked for the app); reminders states.
- `[[` list second lines (where a page is) and "Keep typing a date · Nov 20 · Fri · 3pm" (the only cue for date
  typing, shown only while typing a date).
- "Future days open from the Calendar": the tooltip on a disabled button, only on hover.
- Sign-in and sign-up lines (seen before there is any data), and the sign-in tagline.

## Account row "·" (Lead ebd5ee52)

A "·" now only sits between two items on the same line; none ends or starts a line. Each item is a small box with its
"·" in its left padding, and the row clips the one that lands at a line's start. The "·" inside an item ("Reminders on ·
Turn off", "… · Got it", "Couldn't export · Try again") is glued to the words on both sides. A long item (an address,
the Home Screen hint) wraps inside its own box. Check: `tests/evidence/account-dots/montage.mjs`.
