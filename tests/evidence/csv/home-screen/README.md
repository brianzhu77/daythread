# CSV in the Home Screen app, on the iOS Simulator

Roadbuster, Nov 4, for R4-7's "works in the Home Screen app, or says why not" and R4-8's file picker. Own simulator (iPhone 17 Pro, iOS 26.5), Appium with native taps, a build of main 54cbddda on SQLite. `navigator.standalone` was true and the running app was `com.apple.webapp`.

**Export (R4-7):** `⋯` → Export → Whole database opens a sheet inside the app showing `Books.csv` with "Open in…" (`export-viewer.png`). Open in… → Save to Files saved it. The file starts with a byte order mark and Chinese reads. Close returns to the app, on the same page. One more tap than in Safari, and nothing's lost, so nothing needs saying in the app.

**Import (R4-8):** Pages `+` → Import CSV opens the system's file picker (`import-picker.png`). Picking that same file showed the preview, fitting the screen, and Import made a database with all 3 rows: Chinese, a newline and a comma in a cell, and `=HYPERLINK(...)` back without its `'`.

**Found:** a column of date ranges was suggested as Text, though our own export writes them. Fixed with this note.

**Not run:** the zip with page bodies, `/CSV` on a page, Merge with CSV, a real iPhone, iCloud Drive.
