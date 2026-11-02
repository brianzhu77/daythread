# B16: delete a day page

Scope note: task #139's thread (Jazz 3b5fddf6, Bumblebee's additions on the B16 row, main 80a4e834).

- `seed-day.ts <store> <today> <blank day>`: a throwaway store with a written day, a subpage, a to-do and a long date.
- `day-delete.mjs <base-url> <store> <today> <blank day> <1280|390|375> [chromium|webkit] [shots-dir]`: the ⋯, the notice and Undo, "in Trash" on the date with no new page made, Trash, read-only, Restore, joining with its Undo, deleted twice, and the sidebar's ⋯.

Run against the built app on a throwaway store: all pass at 1280, 390 and 375, in Chromium and WebKit. In the Home Screen app on a Simulator (iOS 26.4): the ⋯, no keyboard from the menu, Delete, Undo or a new page, Trash, and Restore replacing a blank new page. No real iPhone.

## Limits

- Typing in another tab still open on the deleted page saves into the trashed page, with no refusal. Restore brings it back, so it isn't lost, but until then it's only reachable through Trash.
- Links or page cards to a new page that's joined or replaced read as not found.
- A kept draft of that new page, left unsaved on this device, isn't carried over when it's joined.
- Rollback: a second page for a date has the id `day:<date>:2`, and the old build takes the first page it finds for a date, which could be the trashed one. Restore or join those pages before rolling back.
