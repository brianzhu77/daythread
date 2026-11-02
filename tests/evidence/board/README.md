# Board and Group (task #265, R2-12, R2-13, R2-14)

- `seed-board.ts <store> [board]`: a throwaway store with a page "Books" holding a database with one property of each type a view can group by, and 34 rows.
- `board.mjs <base-url> <store> <1280|390> [chromium|webkit] [shots-dir]`: the grouped table and the board in the built app. Reseeds each run.
- `tests/evidence/databases/block-keys.mjs`: keys on a cell, from #68.

Long-press and swipe need a real finger, so they ran in the Home Screen app on a Simulator (iOS 26.4), not in `board.mjs`. The native script is local to the runner.

## Limits

- Not run on a real iPhone, or on a copy of his real data.
- Dropping into a date's week or month group sets today if it's in that group, else the group's first day.
- A view can't be grouped by Name or Text. Sub-groups are R3.
