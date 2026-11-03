# Files (R3-11): sizing

- Author: Roadbuster, 2026-11-03. Status: **sizing for the Lead, who picks the store; not started.** Order (Lead ad684f9c): B21 is built first, and Files stays last in R3.
- From reading the code and Cloudflare's own pages (R2 pricing, Workers limits, read 2026-11-03). Nothing here has been tried.

## Recommendation

**Cloudflare R2, reached only through our Worker, with a 25 MB limit per file. About 4½ working days at the plan's usual rate.** No public bucket and no signed links in the first version: every read goes through the same sign-in as the app, which is the simplest way to meet "another account can never read it".

## Why R2

| | R2 through the Worker | Supabase Storage | Postgres column |
| --- | --- | --- | --- |
| Fit | A binding in the Worker we already run | A second client and its own access rules | Bloats the database and its backups, and our whole-workspace reads |
| Reading by owner | Our check, in one place | Its policies, a second place to get right | Our check |
| Cost at his size | Free tier | Not priced here | Counts against the database plan |

R2's price, from its page: **10 GB of storage, 1 million writes and 10 million reads a month are free, and egress is free.** Past that, $0.015 per GB-month, $4.50 per million writes and $0.36 per million reads. As an illustration, 2,000 photos at 4 MB is 8 GB, so still free.

**For you to check before this starts:** I recall R2 asking for a payment method on the account to enable it, even inside the free tier, but I didn't confirm that. If it does, that's a question for Brian. Creating the bucket and the binding is yours, as deploys are.

## The shape

- **A value:** a `files` property holds `[{ id, name, size, type }]`, stored in the row as usual, so Undo, Trash and old tabs treat it like any value. As with #80's types, I expect an old tab to keep it.
- **The object:** stored at `<workspaceId>/<fileId>`. `PUT` and `GET /api/files/:id` take the workspace from the signed-in session, never from the request, so another account's id finds nothing.
- **A `FileStore` interface:** R2 on the Worker, a folder on local SQLite, so scripts and rigs run without Cloudflare.
- **Limits that set the design:**
  - A Worker takes a request up to 100 MB on our plans, and an isolate has 128 MB of memory, so uploads and downloads must stream, never buffer. That's why 25 MB is the limit rather than 100: it covers phone photos and documents, and it can rise later. A phone video won't fit, and the notice says so.
  - **The export can't zip files as it does today:** `/api/export` builds its zip in memory. So the first version's export **names what's left out**, with each file's name and size in the row's Markdown, which R3-11 allows. A streaming zip can follow.
- **Failure:** an upload that fails or runs offline says so in the cell and leaves the row usable, with Retry while the page is open. It isn't queued across a reload, as a file can't be kept in the draft store.
- **Deleting:** removing a file from a cell or trashing its row leaves the object, so Undo and Restore always work. Nothing deletes objects yet. That matches how the app keeps Trash, and clearing them is a later job, sized when the storage count says it's needed.
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
3. **Streaming through TanStack Start's server handler** is unverified. If its request body doesn't stream on the Worker, the route has to sit in front of it. I'd check this first, in step 1.
