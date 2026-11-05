# Files on the iOS Simulator

Roadbuster, Nov 4, for R3-11's "photos from the phone". Own simulator (iPhone 17 Pro, iOS 26.5), Appium with native taps, Mobile Safari, a local build of `feat/files` at 3b3fc2f3 on SQLite with the folder store.

**Picking:** `+ Add files` offers Photo Library and Choose Files. Photo Library opens the system picker over the page (`photo-picker.png`). Three photos picked, and the sheet was still open under it, with all three in (`after-picking.png`). No Take Photo is offered, as a Simulator has no camera.

**What arrived:** all three as `image/jpeg`, named `.jpeg`, each with its small copy. The sample photo was 4,127,524 bytes with a 205,004-byte small copy.

**Going to the Home screen:** with the sheet open, the real Home button. While on the Home screen the store already held all three, so iOS fired the hide event and they saved without closing. Back in Safari the sheet was still open, and Done kept them.

**Opening:** tapping the name opened the photo in place in a new tab.

**Not shown**
- **That a HEIC source becomes JPEG.** I added one HEIC and one JPEG of the same picture and picked two of the four copies. Both came out at the same 31,533 bytes, which matches neither original, so the picker re-encoded them, but they may have been two copies of one source.
- **Take Photo,** and whether a camera hides the page. It needs a real iPhone.
- **An upload running while the app is in the background:** on localhost these finished before I left, so that case rests on the scripted run in `files.mjs`, with a fake `visibilitychange`.
- **The Home Screen app.** This was Safari. Choose Files, a real iPhone, R2 and the Worker.
