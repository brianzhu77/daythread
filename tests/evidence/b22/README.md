# B22: a pasted task stays the same task (checklist D3)

- `seed.ts <store> <today>`: a throwaway store with a day with two to-dos, and two pages.
- `paste.mjs <base-url> <store> <today> <1280|390> [chromium|webkit] [shots-dir]`: same task, the notice, Make a copy, Undo, several rows, its own page, old words, a task that's gone, nesting, into a to-do, a cut, and plain words alone. The clipboard is real copy and paste events carrying a DataTransfer.

In the Home Screen app on a Simulator (iOS 26.4), a real clipboard: tap the row's grip, More actions, Copy, then on another page tap the empty line twice and choose iOS's Paste. Our clipboard type arrived with the paste, it became a reference row, and no task was added.

## Limits

- Not run on a real iPhone, or on a copy of his real data. If a real iPhone drops our clipboard type, the words alone are matched to the last row copied with Copy.
- Copy is on the `⋯` of open to-dos on day pages, the rows that have a `⋯`. On a phone, a to-do elsewhere or a ticked one has no way to copy as a whole row, and a text selection copies words, as today.
