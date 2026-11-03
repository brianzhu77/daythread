# B21 synced blocks: sizing

- Author: Roadbuster, 2026-11-03. Status: **sizing for the Lead to read; not started.** Answers `docs/design/synced-blocks.md` §7 and §9, and the Lead's f9ff5fa9: size one shared record first, with writing to every page as the fallback.
- Replaces `b21-synced-block.md`'s storage (written before model v2, Postgres rows and B79).

## Conclusion

**Use one shared record, and ship it in two releases.** Writing to every page is simpler to read but its cost grows with every place, and a copy in his Day template adds a place each day. A shared record costs the same at any number of places, at the price of one new step everywhere a page's lines are read.

Estimate: **about 9 working days at the plan's usual rate, with 3 risks below.** Treat that as a rough figure, as nothing here has been prototyped.

## What I measured, and what I didn't

One edit to an 8-line block, in-process only, on his copy of the data with his largest day page cloned (`/tmp` script, not kept):

| Places | Written to every page | Shared record | CPU to rewrite them all |
| ---: | ---: | ---: | ---: |
| 1 | 9 KB | 0.9 KB | 0.1 ms |
| 10 | 90 KB | 0.9 KB | 0.4 ms |
| 100 | 901 KB | 0.9 KB | 3.7 ms |
| 365 | 3.3 MB | 0.9 KB | 14 ms |

- **CPU isn't the limit.** The bytes and the rows are: at 365 places, each pause in typing would send 3.3 MB and write 365 Postgres rows, then send those rows to the browser. My earlier concern about the domain was wrong.
- **Not measured:** real Postgres or Worker time, or a phone connection. Those are where the cost lands, so the table only shows how it scales. A real number would take a throwaway Worker run, which I can do if you want it before deciding.

## How the shared record works

- **Storage:** a hidden page holding the lines, the same row shape as a page, so `planWrites`, Undo and backups work unchanged. Each place is one block, `{ syncId, original: boolean }`, with its per-place facts: a task row's role, kept as an overlay by line id (§3 of the design).
- **Reading:** one step, `documentOf(ws, page)`, returns a page's nodes with its blocks expanded. Today 38 sites read `pageNodes`; 20 of them are in `workspace.ts`. Tasks, tags, search, the draft, export and refs must go through it, and search and tags count a block once (design §8).
- **Editing:** the editor loads the expanded lines as children of the block, under per-place ids, and a save splits them back into the record. This is the earlier plan's approach, needing its Backspace edge guards. No nested editor: it would break keys and the caret.
- **Two copies on one page, and other tabs:** an edit reaches the other copy on the same page live; other tabs pick it up as they do today. A conflict inside the block keeps the latest with his version below, per Jazz's states.

## Steps

| Step | Size | Notes |
| --- | ---: | --- |
| 1. The block spec alone, nothing to make one. **This release becomes the rollback floor.** | ½ d | Same two-step as the database block. |
| 2. `documentOf`, moving the read sites onto it, with no behaviour change while no block exists. | 2 d | Risk 1. |
| 3. Turn into, paste a copy, Unsync, Unsync all, delete, one operation and one Undo each. | 1½ d | Line ids kept on Turn into and on Undo, so links survive. |
| 4. The editor: expand, split on save, conflict, Backspace guards, live between two copies. | 2½ d | Risk 2. |
| 5. Tasks: role per place; `planOn`, `not-today` and carry leave a block's lines alone. | 1 d | Risk 3. Design §10's checks 2 and 3. |
| 6. Templates: an original makes its own block per day, a copy stays connected. | ½ d | |
| 7. Jazz's states on top, and a database inside, which can come last. | 1 d of mine | Plus Jazz's own time. |

## Risks

1. **A read site missed in step 2** would show a page without its block's lines, or lose a task's row. Mitigation: `pageNodes` stops being exported to the sites that need expansion, so the compiler finds them, and a test compares every read on a workspace with and without a block.
2. **The editor's save path** is the most repaired code in the app (B35, B40, B81). A split on save has to keep drafts, recovery and the leave save working. Those scripts must run on every step of 4.
3. **Rollback after step 3:** a build at the floor draws the block but can't expand it without step 2's code. So step 1's release must already read blocks, or the floor rises at step 2. I'll settle that when building step 1, and state it there.

## Questions for the Lead

- **Order:** R3's Files is last in R3. B21 isn't in R3. I'd take it after Files' sizing unless you say otherwise.
- **Do you want the Worker measurement** before deciding, or is the scaling enough? I think the scaling is enough, because a template copy makes the count grow without limit.
