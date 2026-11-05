# Independent R4 audit items 2–4 and sampled phone sheets

Tree: main 01989b50. Invented workspaces only. Build passed. No blocking finding in the scenarios below.

## 2. Day-template views

Own seed creates a Day template containing Table, Board, List, Gallery, Calendar and Timeline linked to the same database. The source includes a Relation to Ada, numeric Rollup 7, and Formula 8. Each new day takes one revision, creates no database, and receives six view blocks. Both engines render the six layouts and show the derived values together. Opening both days leaves all existing stored pages unchanged; the first opening legitimately adds today's draft page. Local ensure-day timing was about 1 ms on this tiny fixture, not a browser/phone/Worker budget measurement.

## 3. Linked Timeline

Both engines draw a linked Timeline with the same derived columns. Own drag changes only its source row, and one Undo restores exact pages. The host's view and source database settings stay intact.

## 4. Keys and clipboard

Both engines: ArrowDown moves between bars; Left/Right, Backspace, Delete and Meta+A while a bar is focused leave stored pages unchanged. Synthetic ClipboardEvents exercise the real handlers: copy supplies the title, cut/paste are contained and leave pages unchanged. This does not exercise an operating-system clipboard.

After explicit Escape selection of the whole Timeline block, copying includes its database/view metadata. Backspace removes only the linked view, keeps the source database, and Undo restores the view settings and body in both engines. The first strict byte comparison failed because BlockNote fills default paragraph colour/alignment props on the first write; the comparison now permits those defaults while keeping database metadata exact. This was not lost content.

## Simulator Mobile Safari

Own Ratchet-B4 iOS 26.4, 390 CSS px, Appium/XCUITest nativeWebTap. Date sheet fits (x16..374, bottom683 of699), tapping Tomorrow persists. Relation sheet fits and moves above the real iOS keyboard (visual viewport389, sheet bottom373). Typing Ada, removing it and Done persists; selecting Ada again and Done persists, and Rollup/Formula update to 7/8. Screenshots were visually inspected for the date and keyboard sheet. `navigator.standalone` is false.

Native exploratory attempts to find a div-only dialog or a text Undo failed because the dialog is another tag and editor Undo is icon-only/hidden without focus. No native Undo pass is claimed; the final native roundtrip re-adds Ada normally. Those harness attempts are retained separately and are not product findings.

Not run: Worker/real Postgres, physical phone, Home Screen app, native CSV/repeat/Formula configuration sheets, Take Photo, broad performance, or OS clipboard. This samples phone date/relation sheets and does not close every native-phone gap. No Brian data was accessed.
