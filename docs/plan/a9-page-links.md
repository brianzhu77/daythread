# A9a `[[` page links + B15 Linked from order — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review (task #83).
- Revised after Ratchet `858f33ed` (held `at` and per-occurrence matching; workspace-wide identity; pending new-page
  links; IME re-fire and Esc).
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

- **Why not a plain link with the page id in its `href` (Lead 23:47).** A BlockNote `link` to `/pages?page=<id>` would
  open in 32ef34b as is, with no layout 6 and no rollback conversion. But it's text with a link mark, not a unit:
  - its words are typed text, so a rename doesn't show (the title isn't live) unless every page holding it is rewritten;
  - Backspace deletes it one character at a time, and the cursor can land inside it;
  - it looks and behaves like a web link, which Jazz §1 rules out;
  - its trashed, missing and creating states can't be drawn.
  Getting a live, whole-unit link costs one reversible format bump. We've done that twice (A4, A2) with the same
  rollback pattern, and the rollback *does* turn each link into exactly that plain link (§5), so the cheap form is
  what the old build sees.
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
- **Kept, never re-stamped (Ratchet):** `projectDocument` looks the reference up by identity and keeps its `at`:
  - **a link** is identified by `refId` **and** its target. The lookup is the whole workspace, not just this block: every page's
    `sections` and `editorBlockMetadata` (which keeps deleted blocks). So a **cut-and-paste move** to another line or page
    keeps its time, whichever of the two pages saves first (Ratchet 858f33ed 2);
  - the same `refId` now pointing at **another** page is a new reference with a new `at`. A copy always gets a new
    `refId` from the browser (§1), so it's new too;
  - **a card** is identified by its block id and target: a card whose `pageId` changed is a new reference;
  - the same `refId` twice on one page is refused (§4); across pages it's allowed only transiently, during a move,
    and both copies resolve to the same `at`. An ordinary save, a
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
  - **one opening per trigger:** the two characters are removed in the same transaction that opens the list, so the
    `input` event a browser sends again after `compositionend` finds nothing to trigger on, and `【【` never opens
    twice (Ratchet 858f33ed);
  - **Esc, or closing the list without choosing, puts back exactly what was typed** (`[[` or `【【`, plus the query), at
    the same place, as one undo step;
  - pasting `[[` or `【【` doesn't open it (only typing does);
  - `[` then `【` (or the reverse) is not a trigger.
- **Phone:** the **+** menu gets "Link to page" (aliases `link`, `[[`, `链接`, `引用`), which opens the same list.
- **The list** (the `/` menu's popover, its own item source):
  - candidates = `visiblePages(ws)` minus the current page, so trashed pages never appear (A4: nothing new may point
    at a trashed page; the server refuses it too, §4);
  - match on title (case-insensitive substring; day pages also on "Mon, Oct 19", "Oct 19" and the ISO date);
    start-of-title matches first, then recency, max 8;
  - second line = where it lives (parent's label, "in Pages", or the domain for a link page);
  - **Empty query = recent pages, the same on every device (Bumblebee 982b0765):**
    - pages ranked by the newest `at` of any live reference to them (§2), so the pages he linked to or made from `[[`
      most recently come first;
    - then pages with no timed reference: day pages newest first, then the rest in stored order.
    - It's computed from the workspace in memory, with no new field. Pages store no open or edit time, and none is added
      in this round.
  - last row "New page "{text}"" once something is typed;
  - Esc, or typing `]]` with nothing chosen, leaves `[[text` as plain text.

## 4. Choosing a row, making a page, Undo

- **An existing page:** one editor transaction replaces `[[text` with `pageRef{pageId, refId}`, then the usual
  save. No new server command: the link is document content, validated by `save-editor`.
- **Server checks in `save-editor`** (in `projectDocument`), for each **new** reference (one the §2 lookup doesn't find):
  - its page must exist and be live. A trashed target is refused ("Page is in trash; restore it first", A4's rule);
  - **except a pending new page (Ratchet 858f33ed 3):** a `pageRef` carrying a `newTitle` prop, whose `pageId` is unused by
    any page. It's stored as `refs[i].pending = true`. Linked from and every other reader skip it until the page exists.
    The `newTitle` is what "Not created · Retry" uses after a reload, as a link card carries its URL;
  - a plain missing target with no `newTitle` is refused, so a made-up id is never a valid reference;
  - `pending` ends when `create-document` with that id lands: the next save of the page sees the target and drops
    `pending` (and the browser drops `newTitle` from the node). The reference's `at` is the save that first held it, so
    it isn't re-stamped.
- **References that already existed** stay whatever happens to the target: in the trash (shown as trashed) or gone
  (shown as "Page not found").
- A `pageRef` inside a task row is refused, and so is the same `refId` twice on one page.
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
  - each conversion is recorded in `held_page_links_l6(pageId, blockId, ordinal, refId, targetPageId, href, text, at,
    pending, newTitle)`. `ordinal` is the link's position among this block's converted links, and **`at` is held here**,
    because a save in 32ef34b drops `refs` from `sections` (Ratchet 858f33ed 1);
  - the undo snapshot is cleared, and `user_version=5`.
- **Re-upgrade, occurrence by occurrence:**
  - in each block, the held rows are taken in `ordinal` order and matched to that block's links in document order. A
    link qualifies only if its `href` is that row's in-app `/pages?page=<id>` and its text is unchanged. Each
    qualifying link is used once, so two identical links come back as their two `refId`s, in order;
  - a match becomes the `pageRef` again, with its `refId` and its **held `at`** (and `pending` and `newTitle`);
  - a link he edited, and **any ordinary web link**, never matches a held row, so it stays a plain link;
  - then the one-time stamp for anything still untimed, and the held table is dropped.
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
| Tag pages, the morning card's "lines from {day}" (Jazz) | draw the line from its editor node through one shared `LineText` component, which renders `pageRef` with the live title (as Trash does), so a rename shows there at once |
| A6b draft, tag index, Bring to today | read `NoteBlock.text` (§1), the title as of the line's last save; a brought line copies its `pageRef` nodes with fresh `refId`s |
| Old `day-page.tsx` | not mounted; untouched |

## 7. Checks before the candidate

- **Unit:**
  - `projectDocument` refs + `at`: a new link gets the save's revision; an ordinary save, a rename and a move keep
    it; two links to one page are two refs; Undo of a delete restores the old `at`;
  - identity: a cut-and-paste move to another line and to another page (either save first) keeps `at`; a copy gets a new
    one; the same `refId` pointing at a new target and a card re-targeted are new;
  - a pending new-page link: saved, reloaded, Retry creates the page, `pending` clears, `at` unchanged; a missing target
    with no `newTitle` is refused;
  - the B15 order: newest first, fallback after deleting the newest, unchanged by a move, stamped old references
    below all timed ones and stable across moves;
  - `save-editor` refusals (new link to trashed, link in a task, duplicate `refId`, unknown page);
  - A2's Undo blocked by a new `[[` link (made and restored cases);
  - migration 6's stamp on a copy of his data (his 2 cards), and on a store with untimed refs after an old-build save.
- **Browser, on a copy of his data, 1280 and 390:**
  - Jazz §6 checks 1–6, 8–10;
  - IME: `【【` typed via `compositionstart/update/end` events **followed by the extra `input` event** (the list opens
    once), a cancelled composition (nothing opens), `[` then `【` (nothing), and Esc after `【【韩` (exactly `【【韩` is
    back);
  - a link in a heading and a quote;
  - the in-app copy and paste of a line with a link (a new `refId`, a new entry time);
  - no page or console errors.
- **Rollback round trip with 32ef34b:**
  - links of each state → rollback → 32ef34b opens every page and the converted links open their pages, edits one
    converted link's text, saves another page;
  - re-upgrade → links back with the same `refId` **and `at`** after 32ef34b saved that page, two identical links in one
    line back as two refs, an ordinary web link untouched, the edited one a plain link, and Linked from's order exactly
    as before.

## 8. For review

- **Ratchet (task #83):**
  - the trigger rules for `【【` and composition (§3);
  - identity and `at` (§1, §2) and the one-time stamp;
  - the layout-6 format bump instead of no bump (§0, §5);
  - §6's reader list.
- **Jazz:**
  - recency = pages linked most recently, server-side (§3, Bumblebee);
  - the stored line text may hold an old title until that line is saved again. It's internal only: every view that shows a line draws the live title (§6).
- **For A9b (Jazz §7, next round):** can the app's own copy carry the source page id? **Yes for block copies**: our
  `copyBlocks` already writes `application/x-daythread-blocks`, and the page id can go in that payload. **Not today
  for a selection inside one line**: `copyBlocks` returns early there and the browser copies plain text. A9b would
  need to write the payload in that case too. Both are small, but they're A9b's.
