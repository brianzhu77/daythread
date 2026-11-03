# R3-15 native check

Run on the iOS Simulator (402 points wide), in the app installed to the Home Screen, through Appium. Not a real iPhone.

- A real long-press on a row's Name picks that row, opens nothing, and shows no iOS callout or edit menu, and no text selected.
- A swipe over the Names scrolls and starts nothing.
- A tap ticks the next row. The bar sits above the toolbar.
- Delete takes both rows, and one Undo brings back both.
- `⋯` → Select rows starts it too. After Done a tap opens a row.
- On a board, a long-press on a card starts no picking and opens nothing.

The scripts are local to the machine they ran on (`/tmp/jazz-55/r315.py`, `r315b.py`), since they need its Simulator and Appium session.
