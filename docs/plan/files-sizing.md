# Files (R3-11): sizing

- Author: Roadbuster, 2026-11-03, updated 2026-11-04. Status: **building, on `feat/files`. The store is R2 (Lead c7e3ed7c). The sizes and the deleting below are proposals for the Lead and Bumblebee.**
- **Run on 2026-11-04, on a local Worker (workerd with its local R2), Chromium not involved:** a 25 MB upload at 3 MB/s reached the handler as 6,404 chunks of 4 KB spread over 8.3 s, so TanStack Start's handler doesn't buffer it, which was risk 3. `R2.put` takes `request.body` directly. It came back byte for byte. 26 MB is refused with 413 and an upload with no length with 411. **Not measured:** memory on a deployed Worker, as local memory doesn't tell (450 to 500 MB, mostly the local R2 itself). The prices and limits are from Cloudflare's pages, not tried.

## Recommendation

**Cloudflare R2, reached only through our Worker, with a 25 MB limit per file. About 4½ working days at the plan's usual rate.** No public bucket and no signed links in the first version: every read goes through the same sign-in as the app, which is the simplest way to meet "another account can never read it".

## Why R2

| | R2 through the Worker | Supabase Storage | Postgres column |
| --- | --- | --- | --- |
| Fit | A binding in the Worker we already run | A second client and its own access rules | Bloats the database and its backups, and our whole-workspace reads |
| Reading by owner | Our check, in one place | Its policies, a second place to get right | Our check |
| Cost at his size | Free tier | Not priced here | Counts against the database plan |

R2's price, from its page: **10 GB of storage, 1 million writes and 10 million reads a month are free, and egress is free.** Past that, $0.015 per GB-month, $4.50 per million writes and $0.36 per million reads. As an illustration, 2,000 photos at 4 MB is 8 GB, so still free.

## Sizes (proposed)

| Limit | Value | Why |
| --- | ---: | --- |
| One file | 25 MB | Phone photos and documents, and it can rise later. A phone video won't fit, and it says so before uploading. |
| One account in all | 5 GB | Half the free 10 GB, which is shared with Brian's other buckets. At 4 MB a photo, about 1,250 photos. Past it costs about 7¢ per GB-month, so this guards against surprise rather than cost. |
| One cell | 50 files | A row stays light, as its value travels with the whole workspace: about 120 bytes per file. |

The 5 GB is read from the store on each upload, one list per 1,000 files, so two uploads at once can pass it by one file. That's fine for a guard.

## The shape

- **A value:** a `files` property holds `[{ id, name, size, type }]`, stored in the row as usual, so Undo, Trash and old tabs treat it like any value. As with #80's types, I expect an old tab to keep it.
- **The object:** stored at `<userId>/<fileId>`. `PUT` and `GET /api/files/:id` take the account from the signed-in session, never from the request, so another account's id finds nothing.
- **A `FileStore` interface:** R2 on the Worker, a folder on local SQLite, so scripts and rigs run without Cloudflare.
- **Limits that set the design:**
  - A Worker takes a request up to 100 MB on our plans, and an isolate has 128 MB of memory, so uploads and downloads must stream, never buffer. That's why 25 MB is the limit rather than 100: it covers phone photos and documents, and it can rise later. A phone video won't fit, and the notice says so.
  - **The export can't zip files as it does today:** `/api/export` builds its zip in memory. So the first version's export **names what's left out**, with each file's name and size in the row's Markdown, which R3-11 allows. A streaming zip can follow.
- **Failure:** an upload that fails or runs offline says so in the cell and leaves the row usable, with Retry while the page is open. It isn't queued across a reload, as a file can't be kept in the draft store.
- **Deleting (replaces the earlier "nothing deletes", for Bumblebee's addition to R3-11):**
  - **A file is in use while any row holds it, in Trash or not, and while the Undo slot can bring it back.** So Undo and Restore always work, and a duplicated row sharing a file doesn't lose it when the other goes. The app has no "delete forever" today, so a row in Trash keeps its file.
  - **A sweep removes the rest,** when the app opens, at most once a day: a call lists the account's objects, and deletes those no row holds and that are over 7 days old. The 7 days cover an upload not yet attached, an open tab that hasn't caught up, and restoring a recent backup. No cron, as with repeating rows (`automations.md` §6).
  - **So "removed for good" takes up to 7 days plus the next open,** and until then the object is still readable by its owner only. If that's too long, the wait can shrink, at the cost of what it covers.
  - **A deleted account's files go with it,** in the same request, after its data. If that fails, the reply says so as it already does for the login (`login: 'kept'`), since no later sweep will run for that account.
- **What opens in place:** PNG, JPEG, GIF, WebP, AVIF and PDF. Everything else downloads, including HTML and SVG, because a page opened on our origin could read his workspace. Video downloads too: iPhone Safari needs range requests to play it, and we don't serve those in this version.
- **Gallery:** a Files property can be a card image. Full photos on a phone's gallery would be slow, so the browser makes a small copy on upload, stored beside the file. Images only.

## Steps

| Step | Size |
| --- | ---: |
| 1. `FileStore`, R2 binding, local folder, the two routes with the owner check, a size limit and streaming. | 1 d |
| 2. The property type: value, read, every view (R3-16), filter is empty and name contains, sort by name. | ½ d |
| 3. The editor at both widths: Add, Remove, Open, photos from the phone, progress, failure and Retry. | 1½ d |
| 4. Gallery card image with the small copy. | ½ d |
| 5. Export naming files; Trash and Restore checks; a second-account test on the Worker with real Postgres. | 1 d |

## Risks

1. **The account check is the one thing that can't be wrong.** It gets its own test on the Worker, as a second signed-in account, and never only on SQLite.
2. **Upload on a real iPhone** can't be fully proven on the Simulator, as with every native check so far, and photo pickers differ. It needs Brian's phone at release, or a stated limit.
3. **Streaming on a deployed Worker:** through the handler it streams locally (above). Memory on a deployed Worker is still to read, on the preview once it has a bucket.
