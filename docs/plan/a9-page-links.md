# A9a `[[` page links + B15 Linked from order — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review (task #83).
- Inputs:
  - Jazz `docs/design/page-links-states.md` @ d69d8fd: §1–§3, §5 and §6 checks 1–6 and 8–10 (the design source);
  - Lead `038e7cf1` (A9 + B15 next) and `a5a33307` (**this round is `[[` + B15 only; quote with source is A9b, next
    round**; Ratchet to look hard at `【【` and composition);
  - Ratchet `4764cb56`, `c293ef38` (stable order for old references, one identity per reference, no re-stamping on
    ordinary saves or renames; links must reach A2's Undo check and the Trash views too);
  - pages-delta N-5; checklist A9, B15.
- Base: main 377f955 (states §5 frozen order, Jazz). Brian's data: 9 pages, 2 page cards (Oct 18 Notes), no `[[` links yet.

## 0. One finding that shapes the plan

**The live build can't open a page that contains an inline node it doesn't know.** I put one unknown inline node
(`pageRef`) into a copy of his Oct 18 page and opened it on 32ef34b: the whole screen is "Something went wrong!"
(BlockNote: "Error creating document from blocks passed as `initialContent`").

So an inline `[[` link is a **document format change** even though no table changes. If we rolled back to
32ef34b without converting the links, any page holding one couldn't be opened. The plan therefore treats it like A2:
a layout bump (6), a rollback script that converts links to something 32ef34b reads, and a re-upgrade that converts
them back (§5). Bumping the layout also means 32ef34b **refuses** an unconverted layout-6 file at start-up
("Unsupported database layout") rather than crashing on one page later.

## 1. Where a link lives

**An inline content node in the editor document**: `{ type: "pageRef", props: { pageId, refId } }`. Jazz's states
need exactly this: inline, one unit, live title, the card's states. Nothing about the title is stored; the node
reads it from the workspace when it renders, so a rename shows everywhere at once (Jazz §1).

- **`refId`** (a uuid, chosen in the browser when the link is inserted) is the identity of **this** link (Ratchet):
  two links to the same page, even in one line, are two references with their own times. An in-app paste of copied
  blocks gives every `pageRef` a fresh `refId` (it's a new reference, made now), exactly as it gives blocks fresh
  ids today; a cut-and-paste move keeps them (`moving`), so moving a line doesn't re-stamp it.
- **The server's view** comes from `projectDocument`, as for cards: a block that holds links gets
  `NoteBlock.refs: { refId, pageId, at }[]`. That's what Linked from, A2's Undo check, the Trash views and the model
  read; none of them parse editor JSON.
- **`NoteBlock.text`** of a line with a link reads `做法参考 韩国大酱汤 里的配料` (the title at save time), so tags,
  Bring to today and the A6b draft see words, not a hole. It can be stale after a rename until the line is saved
  again; only the rendered link is live. Stated, not fixed.
- **Not a card:** `[[` never makes a `pageLink` block. Cards (`/page`, pasted URLs) are unchanged.
- **Where it's allowed:** paragraphs, bullets, numbered lines, headings and quotes. Never in a task row (the editor
  doesn't open the list there, and the schema refuses a `pageRef` inside `task` content) or a page title (not part of
  the editor).

## 2. B15: the time of a reference

- **`at` is the workspace revision** of the save that first saw that reference (cards: per block; links: per
  `refId`). A revision is the right unit: B15 needs order, not clock time, and the domain stays free of `Date.now()`.
- **Kept, never re-stamped (Ratchet):** `projectDocument` looks the reference up by identity in the block's previous
  state (sections and `editorBlockMetadata`, which keeps deleted blocks) and keeps its `at`. An ordinary save, a
  rename of either page, a move, editing other text in the line: none of them change `at`. A card or link that Undo
  brings back gets its old `at` back from the metadata.
- **Linked from order:** one entry per source page, ranked by the **newest `at` among that page's live references**
  to this page. Delete the newest and the entry falls back to the next one still there; the last one gone, the entry
  goes (Jazz §5). Moving either page changes nothing.
- **References from before B15 (Ratchet c293ef38).** Today's order comes from the pages array, which a move
  re-orders, so "untimed, in today's order" computed on every read would still reshuffle. Instead, **migration 6
  stamps every existing card once**, in the order Linked from shows today, with `at` values below every real
  revision (`at = -n … -1` per target, oldest last). From then on they never move. This isn't a guessed time; it
  freezes the order he sees now. Brian has 2 cards, so the effect on his data is two stamps.
- **Old-build saves:** a page saved by 32ef34b after a rollback loses `at` and `refs` (its `projectDocument` rebuilds
  blocks). The re-upgrade runs the same one-time stamp for anything untimed, so those references go below every
  timed one, in the order at that moment. Stated.

## 3. Typing `[[` / `【【`, and the list

- **Trigger, in the editor's input handling, not BlockNote's single-character suggestion trigger:**
  - after a text input or a **finished** composition (`compositionend`), if the two characters before the cursor
    are `[[` or `【【` and the block allows links (§1), they're removed in one transaction and the list opens with an
    empty query;
  - while `composing.current` is true, nothing happens (the same guard `/` uses today). A cancelled composition
    inserts nothing, so nothing opens;
  - pasting `[[` or `【【` doesn't open it (only typing does);
  - `[` then `【` (or the reverse) is not a trigger.
- **Phone:** the **+** menu gets "Link to page" (aliases `link`, `[[`, `链接`, `引用`), which opens the same list.
- **The list** (the `/` menu's popover, its own item source):
  - candidates = `visiblePages(ws)` minus the current page, so trashed pages never appear (A4: nothing new may point
    at a trashed page; the server refuses it too, §4);
  - match on title (case-insensitive substring; day pages also on "Mon, Oct 19", "Oct 19" and the ISO date);
    start-of-title matches first, then recency, max 8;
  - second line = where it lives (parent's label, "in Pages", or the domain for a link page);
  - **empty query = recent pages.** Pages store no edit or open time today; I don't add one in this round. Recency is
    **this device's recently opened pages** (localStorage, last 20, written by the page screen), falling back to day
    pages newest first. Jazz, that's a narrowing of "opened or edited", say if it isn't enough;
  - last row "New page "{text}"" once something is typed;
  - Esc, or typing `]]` with nothing chosen, leaves `[[text` as plain text.

## 4. Choosing a row, making a page, Undo

- **An existing page:** one editor transaction replaces `[[text` with `pageRef{pageId, refId}`, then the usual
  save. No new server command: the link is document content, validated by `save-editor`.
- **Server checks in `save-editor`** (in `projectDocument`): every `pageRef.pageId` must be an existing page; a link
  **newly** pointing at a trashed page is refused ("Page is in trash; restore it first", A4's rule), while one that
  already pointed there before the trash is kept (it shows the trashed state); a `pageRef` inside a task row is
  refused; duplicate `refId`s within a page are refused.
- **"New page "{text}"":** exactly `/page`'s path with a title. The browser chooses the page id, inserts the link
  in its "creating" state (the existing `pendingPages` map), and runs `create-document { pageId, parentId: this
  page, title: text }` with the 3-try confirm loop. Failure: "Not created · Retry", where Retry re-runs that same
  create. After a reload, a link whose page doesn't exist and has a `newTitle` prop retries with that title, the way a
  link card retries its paste. No notice (Jazz §3).
- **Undo:** ⌘Z is ordinary editor history: it removes the link (and the typed `[[text`), and the page stays in
  Subpages, like `/page`. Backspace deletes the link as one unit (an atom inline node).

## 5. Layout 6, rollback, re-upgrade

- **Migration 6:** no table changes. It (a) converts back any links the rollback held (below), then (b) stamps every
  untimed reference once (§2). `verifySqliteLayout(db, 6)` = layout 5's columns.
- **`scripts/sqlite-rollback-page-links.ts`, 6 → 5** (A2's pattern: backup, one transaction):
  - every `pageRef` node in every `editorJSON` becomes a plain link `{ type: "link", href: "/pages?page=<id>",
    content: <the title now> }`, which 32ef34b renders and opens (a normal in-app link);
  - each conversion is recorded in `held_page_links_l6(pageId, blockId, refId, targetPageId, href, text)`;
  - `refs`/`at` are left in `sections` (32ef34b ignores them); undo snapshot cleared; `user_version=5`.
- **Re-upgrade:** a recorded link still present in that block with the same `href` and text becomes the `pageRef`
  again with its `refId` (and its `at`, if the block still has it). One he edited stays a plain link. Then the
  one-time stamp for anything untimed. The held table is dropped.
- **The chain** stays newest-first: 6 → 5 (links), then 5 → 4 (A2) etc. Older scripts accept the newer held table, as
  A2 did for A4.

## 6. Everything that reads references (Ratchet c293ef38)

| Reader | Change |
| --- | --- |
| `linkedFrom` (page-tree) | cards + `refs`; B15 order (§2) |
| A2 `referencesTo` (Undo of a paste) | cards + `refs`, keyed `pageId/blockId/refId`, so a new `[[` link blocks deleting or re-trashing, like a new card |
| Trash: read-only body (`trash.tsx` `Inline`) | renders `pageRef` with the same states (live, in trash, not found) |
| Trash: Linked from / "(removed)" | unchanged code, now fed by `refs` too |
| A4 trash rollback (`remapIds`) | already remaps any `pageId` prop, so a link inside a held page follows its page |
| A6b draft, tags, Bring to today | read `NoteBlock.text` (§1); a brought line copies its `pageRef` nodes with fresh `refId`s |
| Old `day-page.tsx` | not mounted; untouched |

## 7. Checks before the candidate

- **Unit:**
  - `projectDocument` refs + `at`: a new link gets the save's revision; an ordinary save, a rename and a move keep
    it; two links to one page are two refs; Undo of a delete restores the old `at`;
  - the B15 order: newest first, fallback after deleting the newest, unchanged by a move, stamped old references
    below all timed ones and stable across moves;
  - `save-editor` refusals (new link to trashed, link in a task, duplicate `refId`, unknown page);
  - A2's Undo blocked by a new `[[` link (made and restored cases);
  - migration 6's stamp on a copy of his data (his 2 cards), and on a store with untimed refs after an old-build save.
- **Browser, on a copy of his data, 1280 and 390:**
  - Jazz §6 checks 1–6, 8–10;
  - IME: `【【` typed via `compositionstart/update/end` events, a cancelled composition (nothing opens), `[` then `【`
    (nothing);
  - a link in a heading and a quote;
  - the in-app copy and paste of a line with a link (a new `refId`, a new entry time);
  - no page or console errors.
- **Rollback round trip with 32ef34b:**
  - links of each state → rollback → 32ef34b opens every page and the converted links open their pages, edits one
    converted link's text, saves another page;
  - re-upgrade → links back with the same `refId`, the edited one stays a plain link, and Linked from's order is as
    before for untouched pages.

## 8. For review

- **Ratchet (task #83):**
  - the trigger rules for `【【` and composition (§3);
  - identity and `at` (§1, §2) and the one-time stamp;
  - the layout-6 format bump instead of no bump (§0, §5);
  - §6's reader list.
- **Jazz:**
  - recency = this device's recently opened pages (§3);
  - the link text in `NoteBlock.text` may be stale until the line is saved (§1, internal only).
- **For A9b (Jazz §7, next round):** can the app's own copy carry the source page id? **Yes for block copies**: our
  `copyBlocks` already writes `application/x-daythread-blocks`, and the page id can go in that payload. **Not today
  for a selection inside one line**: `copyBlocks` returns early there and the browser copies plain text. A9b would
  need to write the payload in that case too. Both are small, but they're A9b's.
