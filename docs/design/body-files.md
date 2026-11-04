# Images and files in a page's body (B87): the states

- Author: Jazz (Design) · 2026-11-04 · status: **reviewed by Bumblebee and Roadbuster, not built.** Build waits for Files (R3-11), as B87 says.
- Nothing here has been prototyped or tried on a real screen. "Recommend" means my judgement; the only evidence used is the code and `docs/plan/files-sizing.md`.

## 1. Where it starts

- BlockNote's `image` and `file` blocks are already in the schema, through `defaultBlockSpecs`. The `/` menu only lists what's in `slashIcons`, so neither is offered, and an image arrives only with pasted web content.
- Uploads use R3-11's store: `PUT` and `GET /api/files/:id`, 25 MB a file, 5 GB an account, and its list of what opens in place.

## 2. Two blocks

| Block | At rest | Why |
| --- | --- | --- |
| **Image** | The picture, at its own size up to the column's width, then its caption if it has one | |
| **File** | One row on the text column: icon, name, size, and ↗ or ↓ at the end | Built like a page card, so a page reads as one thing and the alignment gate has a known column |

- **`/image` given something that isn't an image** makes a file block. `/file` given an image makes a file block too: that's what was asked for.
- **Formats:** what R3-11 opens in place shows as an image. SVG never does, as it could run on our origin, so it's a file block. HEIC shows where the browser can, and otherwise reads "Can't show this image here · Download".

## 3. Adding one

| Way | 1280 | 390 |
| --- | --- | --- |
| `/image`, `/file` | A small panel at the line: **Upload** and **Paste a link**. Upload opens the file chooser | The same, as a sheet. `/image` opens the phone's photo picker, `/file` its file picker |
| Drag onto the page | The editor's drop line shows where. One block per file, in the order dropped | Not applicable |
| Paste | A screenshot lands at the caret, and the caret goes to the line below, so typing carries on | The same |
| Paste holding text and an image | **Text wins,** as it does today. Numbers, Excel and Word can put both on the clipboard, and a pasted table mustn't turn into a picture (Bumblebee). An image lands only when the clipboard holds nothing else. Not yet tried in those apps | The same |
| Paste a link to an image | As today: B44's paste menu. Not fetched or copied into our store | The same |

- **Several files** upload three at a time, each with its own block, so one failure doesn't touch the others.
- **A drop on a table's cell** belongs to R3-11's Files property, not this. A drop on a database block that has no Files column goes above or below it, by the drop line.
- **A drop or paste on a title or a cell being edited:** ignored, with no notice. It's easy to retry, and adding a block there would be a surprise.

## 4. Uploading: the block is there from the start

**Recommend: the block goes in at once, with an id we choose, and saves with the page like any block.** It holds `{ fileId, name, size, type }` and no address. The tab draws its preview from memory, keyed by `fileId`, so a temporary browser address can never reach the document (B87 6).

The other way, adding the block only when the upload ends, would move the words under the caret, and a failed upload would have nowhere to say so.

| State | What shows | What can be done |
| --- | --- | --- |
| Uploading, image | The picture at its final size, with a thin progress line along its bottom edge | Type anywhere, move it, delete it, which cancels the upload |
| Uploading, file | Its row, with the size replaced by "12 of 25 MB" | The same |
| Offline | "Offline · Retry when you're back" on the block | Retries by itself on coming back; Remove |
| Failed | "Not uploaded · Retry" | Retry, Remove |
| Too large | "Too large · 25 MB at most". Said at once, no attempt | Remove |
| Account full | "Storage full · 5 GB at most" | Remove |
| Leaving the page mid-upload | Carries on while the tab is open. Coming back shows where it's got to | |
| Closing the tab mid-upload | The browser's usual "leave site?", as for unsaved words | |
| **Anything else with no file to find:** a reload mid-upload, a tab closed mid-upload, another device while it uploads, or a backup older than 7 days | "{name} isn't here · Choose again" | Choose again, Remove. It looks again when the page regains focus, so an upload that has finished shows up |

- **The page's "Saved"** is about words, and doesn't wait for an upload. Each block speaks for itself.
- **One state, not three (Bumblebee):** nothing in the document changes when an upload ends, so a tab without the bytes can't tell "still uploading" from "never finished" from "gone". A stored "finished" flag would, but it adds a save at the end of every upload, and the distinction doesn't earn that. It also means a closed tab can't leave another device saying "uploading" for ever.
- **Undo** while uploading removes the block and cancels the upload.
- **Undo after deleting a block mid-upload** brings the block back. If the tab still has the bytes it reads "Not uploaded · Retry". If not, it's the state above (B87 7).

## 5. An image, selected

At 1280 a hover shows a small bar at its top right: **Align, Caption, Replace, Download, ↗, ⋯**. The edges show handles.

- **Resize** by either side edge, with the picture staying centred on its alignment. Saved on the block when released, as one Undo. Smallest 120 px, largest the column.
- **Align** left, centre or right. It only shows on an image narrower than the column.
- **Caption:** an empty line under the picture on Caption, in meta size and `--ink-2`. Enter leaves it for a new line below. Empty, it takes no space.
- **Replace** keeps the block, its width and its caption. Undo brings the old file back, as the old one stays until the sweep.
- **↗** opens the original in a new tab. **Download** saves it. Neither shows until the upload's done.

At 390 a tap selects it, and the same actions are in the block's `⋯`. **No resize at 390:** a saved width applies, capped by the column, so a phone and a side peek never scroll sideways.

**Keys:** with an image selected, Backspace deletes it with one Undo, Enter adds a line below, and arrows move on. Esc lets go, as a picked line does.

## 6. Reading it back

| State | What shows |
| --- | --- |
| Loading | A box at its saved size, or a 16:9 one if it has none, in `--fill`, so the page doesn't jump |
| A file not found | "{name} isn't here · Choose again" (§4). No broken-image mark |
| A link to an image that fails | "Can't load this image", with the address. As Gallery says, the card just goes without |
| Offline | As failing, with "Offline" |
| An old tab or an old build | Keeps the block untouched (B87 12). An old build draws an image with no address as an empty block, so `url` should hold `/api/files/:id`, which also helps export and Gallery |

## 7. Where else it appears

- **Copying a block:** the copy holds the same `fileId`. Deleting one leaves the other, and the sweep counts both (B87 8).
- **Synced blocks, templates:** the same. A template's image is shared by the rows made from it, not copied.
- **Peek:** the same block. An image is capped by the panel.
- **Gallery:** `firstImageUrl` accepts `/api/files/` too (B87 9).
- **Search and the day draft** see the name and caption only, and no file contents (B87 10).

## 8. Questions

None open.

**Settled (Bumblebee, 2026-11-04):** the main decision in §4, the words "Too large · 25 MB at most" and "Storage full · 5 GB at most", and accepting an old build's broken image, as an old build only exists during a rollback (Roadbuster agrees).

**Settled (Roadbuster, 2026-11-04, for `feat/files`):** `PUT /api/files/:id` takes an id the client makes and never overwrites. If the key is taken, a retry of the same size returns 200 and different bytes return 409, with what's there untouched. Files' cell saves its value only after the bytes are in, so it doesn't use §4's pending shape, only its words.

**Left out, for §14 Later:** crop and mask, alt text, comments on an image, columns, Unsplash (B87's own list). Also a lightbox: ↗ covers looking closely for now.
