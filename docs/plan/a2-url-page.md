# A2 · paste a URL → a page — plan for review

- Author: Roadbuster · 2026-10-20 · status: **plan, not built**. No code until Ratchet's pre-review (task #81).
- Revised after Lead/Ratchet `eeaf7490` (no `materials.pageId`; three Undo cases), Ratchet `c2cc3896` (rollback identity, Undo as one server command), Bumblebee `56de3d1e`, Jazz a167c39.
- Inputs:
  - Brian `3596b765` (an empty page with the link as a property, linked back to today), `e83b0640` (O1 = B: no fetch);
  - pages-delta v0.4 N-3, N-4, N-5;
  - Lead `8ea3ff23` (no fetch), `ca10deaf` (child of the page pasted into), `043d101e` (the four cuts), `5043b9c5` (Good Stuffs gets a page, and the follow-up carries on; an empty bullet counts);
  - Jazz `docs/design/link-pages-states.md` @ 055edb6 (the design source for what he sees);
  - Ratchet `8ef58d40` and `a68af09f` (restore boundary, Undo after edits, one dedup constraint, N-4 boundary tests, no `new URL().href` as the key);
  - Bumblebee `98a94e04`.
- Base: main 055edb6. **His data** (copy of 2026-10-20): 0 Materials, no URLs, 9 pages. Nothing to migrate, but every old read path stays.

## 1. Scope

**In:** paste onto an **empty** paragraph, bullet or numbered line, on any day or document page, in any section (Good Stuffs included):

- **What counts:** everything pasted is http(s) URLs, one per line, blank lines allowed (Jazz §1).
- **What it makes:**
  - one **link page** per URL, as a **child of the page pasted into** (Lead `ca10deaf`, the same as `/page`);
  - a **link card** where each URL was;
  - one notice with Undo.
- **No network call of any kind.** "Offline" means only that the local server is unreachable, which is the card's existing "Not created · Retry".

**Out:**
- Make page for a URL inside a sentence;
- capture-bar URLs (B18);
- editing or removing a page's URL;
- the per-save notes list.

Out by design, unchanged: a URL pasted into a sentence, a task row, a heading, the title, or as typed text.

## 2. Data: the page owns the URL; Good Stuffs adds a follow-up record

- **`Page.url?: string`** holds the URL **exactly as first pasted**.
  - A page is a link page iff `url` is set.
  - The key is computed, never stored: `urlKey(page.url)`.
- **The page is the only owner of a key**, live or in the trash. Two pages never hold the same key (N-4).
- **Follow-up for Good Stuffs (Lead `5043b9c5`):**
  - **When it's made:** pasting a link page **under a Good Stuffs section** creates or reuses its follow-up record, the existing `Material`.
  - **The link is derived, not stored** (Lead `eeaf7490`, Ratchet agreed): a Material belongs to the page with the same key, `urlKey(material.url) === urlKey(page.url)`. Each side is unique by key, and a URL can't be edited in A2, so the relation can't drift. If URL editing comes later, this is revisited.
  - **What it holds:** `Material.url` is set to the page's URL, so the old readers keep working. `sources` gets one entry per Good Stuffs paste, for the sort card's "Saved Mon in Good Stuffs".
  - **The selection is unchanged.** The evening review's Good Stuffs step and Related keep reading `materialReview` (pending ≥ 2 days, watching due, skip, Don't resurface), so A5's rules carry on unchanged.
  - **Display:** the sort card's title comes from the page, and tapping it opens **the page**. ↗ opens the URL.
- **Pasted in Notes or anywhere else:** a link page with **no** Material, so it isn't in the follow-up. Pasting the same URL later under Good Stuffs creates the Material, which matches the **same** page by key.
- **Done with it:** a Good Stuffs repeat paste of a "Done with it" page puts it back to To sort (G05, the existing branch).
- **Old saved items (Lead: say the read path):**
  - **A URL typed into Good Stuffs** still becomes a `Material` line through `linkMaterialLines`, exactly as A5 built it, and its Open opens the URL.
  - **Never two records:** a typed line whose key a link page holds is that page's Material by key. A URL pasted later finds the existing Material by the same key, so it's one page plus its one follow-up record.
  - So **a URL never becomes a page plus a separate saved item** (Bumblebee 1). His data has none of the old kind.
- **The one dedup function:** `urlOwner(ws, raw) → { key, page?, material? }`, used by every path: paste, its retry, several URLs in one paste, two devices, and the typed Good Stuffs line.
  - It reads `page.url` and `material.url` through `urlKey`.
  - Domain invariants are checked after every command: one page per key; one Material per key.

### `urlKey`, exactly N-4 (`src/domain/url-key.ts`)

- **Built from the raw string by hand, not `new URL().href`** (Ratchet). That would percent-encode and normalise the path, and it rewrites more besides.
- **Rules:**
  - trim;
  - match `^(https?)://([^/?#]*)(.*)$`, otherwise not a URL;
  - lower-case the scheme;
  - lower-case the host, keeping userinfo as typed;
  - drop `:80` for http and `:443` for https;
  - an empty rest, or one starting with `?` or `#`, gets `/` in front;
  - everything else is kept byte for byte.
- `new URL()` is used only to **validate** (it must parse, the scheme must be http(s), and the host must be non-empty).
- **Tests:**
  - N-4's seven rows;
  - `https://x.com?a=1` → `https://x.com/?a=1`;
  - `https://x.com#f` → `https://x.com/#f`;
  - `https://X.com:8080/A` → `https://x.com:8080/A`;
  - `http://x.com:443/` kept;
  - an IDN host kept as typed;
  - `%E5%A4%A7` vs `大` in the path → **different** keys (kept as typed; noted, not normalised).

### Default title (Jazz §3)

- `defaultLinkTitle(raw)`: drop `http(s)://` and a leading `www.`, decode percent-escapes (on a decode error, keep the raw text), drop a trailing `/`, and keep the query and fragment.
- It's pure, computed on the server, and stored as `title`, an ordinary title from then on.

## 3. The paste

**Browser** (`page-editor.tsx` `pasteHandler`, before the HTML branch, because a link copied from a page carries `text/html` too):

1. **Trigger check:** `text/plain` → lines → each trimmed line is empty or one `httpUrl`, with at least one URL. The cursor block is an empty `paragraph`, `bulletListItem` or `numberedListItem`, and the selection is collapsed. Otherwise the default paste runs.
2. **The cards go in, one editor transaction:**
   - each URL gets a `pageLink` card with a page id chosen here, in order;
   - the empty line after them is kept;
   - **a card replacing a bullet sits at that bullet's nesting level.**
3. **Each card's target:** if the browser's own workspace already has a page for that key, the card points at **that** page from the start. That's the common repeat, and it means the card is never saved pointing at a page that won't exist.
4. **Then one command for all the cards:** `paste-links { pageId: parent, sectionId, items: [{ url, pageId, cardBlockId }] }`, through `/page`'s confirm loop: 3 tries, then "Not created · Retry" on each card still pending.
5. **If the server answers with a different page** for an item (a race with another device), that card's `pageId` prop is updated before the next save.

**Server** (`case "paste-links"`, inside the one `BEGIN IMMEDIATE` transaction), for each item in order:

- **No owner:**
  - create the page (`id: pageId`, `document`, `parentId`, `url: raw`, title from `defaultLinkTitle`, the `/page` body shape) → **made**.
  - A second item in the same paste with the same key finds the page just made → **reused**.
- **The owner is live:** nothing is created and the parent is unchanged → **reused** ("Saved before · {day the page was made}").
- **The owner is in the trash:** restore **exactly what that page's own Restore restores**: `restore-page`'s set, the page plus the descendants trashed in **the same delete** (Jazz 055edb6, Ratchet). Subpages deleted earlier stay in the trash. The old parent being in the trash → top level, with A4's notice → **restored**.
- **Good Stuffs section:** `urlOwner`'s Material, or a new one with the page's URL. Its `sources` gets `{ pageId: parent, blockId: cardBlockId, note: "" }` unless that `blockId` is already there.
- **Replay and retry:**
  - The same operation id → the first receipt (existing).
  - A retry under a new id: an item whose `pageId` already exists with the same key → the outcome from the stored record (§4), no second page.
  - Two devices: the second command fails on `expectedRevision`, its confirm loop retries on the fresh workspace, and it lands in "reused" → one page, two cards (N19).

## 4. Undo (Jazz §4 @ 055edb6)

**The record.** Each card's outcome is stored in the parent page's `editorBlockMetadata["paste:" + cardBlockId]`, the way A6b keys `accepted:<taskId>`. It has its own key because `save-editor` copies every saved block into `editorBlockMetadata[block.id]` (`workspace.ts:777`), which would overwrite a record under the card's own id. Metadata is never pruned, so the record outlives the card being deleted:

```ts
linkPaste: {
  operationId: string            // the paste-links operation
  outcome: "made" | "reused" | "restored"
  url: string                    // raw, for turning the card back into text
  restored?: { pageId: string; trashId: string; trashedAt: string }[]  // the exact set and its original delete identity
  materialCreated?: boolean      // this paste made the Good Stuffs follow-up record
}
```

**`undo-paste-links { pageId: parent, operationId, expectedContent }`** is **one server command that commits everything at once** (Ratchet `c2cc3896` 2). It does no snapshot restore: generic Undo can't be used, because `save-editor` runs right after the paste.

**What it does, in one transaction**, for each card of that operation still on the parent page:

1. **It rewrites the parent page's document on the server.** The card block becomes a paragraph with the **same block id**, holding the raw URL as a plain link, in the same place and at the same nesting level. Both `editorJSON` and `sections` are rewritten, the way `bring-line` and `add-proposal` already edit a page's document on the server.
2. **It applies the outcome's rule below.**
3. **It removes only this card's Good Stuffs save** from `sources` (Ratchet `eeaf7490`). The Material itself is removed only if this paste made it (`materialCreated`) **and** it now has no other source, its state is still To sort, and it has no decision, open or skip. Otherwise it stays with its other saves.

**All checks run inside the same transaction, before any write.** Cards from **this same operation** never count as outside references, so pasting A and A on two lines is undone in one go and the page is deleted. A "made" page is physically deleted only after its edits, children, references from other operations and follow-up use have all been checked in that transaction; anything that turned up later keeps it.

| Outcome | Undo does | Unless: the card still turns back into the URL text, and the page stays |
| --- | --- | --- |
| made | **deletes** the page record (not trash; Bumblebee `56de3d1e`, Jazz a167c39: the paste didn't happen, and a Trash row would turn a later paste into "Restored") | it has a title or body edit or a child → "Kept {title} · it has your edits"; any reference other than this card, from a live or trashed page, a card or `[[` → "Kept {title} · linked from {page}" |
| restored | puts the `restored` set back in the trash **with its original `trashId`/`trashedAt`**, so it's the same Trash row. Edits made in between are kept | a new reference, added since the paste by another operation, to **any** page of the set, including its subpages → "Kept {title} · linked from {page}" |
| reused | nothing on the page | — |

**Edge cases:**
- **A card he already deleted** is skipped, and its page rule still applies. The command reports "nothing to undo" only if no card and no page changed.
- **Replay:** the same operation id returns the first receipt.
- **Lost response or closed browser:** a lost response leaves the state either fully applied or untouched. There's no window where a card points at a deleted page.
- **The browser only applies the result:**
  - It **saves what he typed first** (flushes the pending editor save), then sends `expectedContent` = the content key from that save. So "paste → type a note on the next line → Undo on the notice" works: the note is kept and the cards turn back into text (Jazz `f8dc5ab7`). Editor input is held while the Undo request is in flight, so nothing typed can race it.
  - The server's new document reaches the editor through the existing **external refresh** (`page-editor.tsx:361`).
  - Only if the page changed elsewhere (another tab or device) between that save and the Undo does the key no longer match. The command is then refused with "Page changed · nothing was undone", and nothing changes. The whole-page key is kept rather than per-card checks, because the server rewrites the document and a stale open editor would conflict anyway.

**⌘Z:**
- **While the paste's notice is showing,** and the editor's last history step is that paste, ⌘Z sends this same command. It's a keydown handler in front of BlockNote's.
- **After that, ⌘Z is ordinary editor undo:** it removes the card only, and the page stays (Jazz's fallback, and the same as deleting any card later).

## 5. Storage, rollback, old build

- **Migration 5:** one column, `pages.url TEXT`, null by default. No Material column. `verifySqliteLayout` gets layout 5, and `sqlite-mapping` gets the fields.
- **`scripts/sqlite-rollback-link-pages.ts`, layout 5 → 4,** following A4's `held_trash_l4` pattern (Ratchet `c2cc3896` 1). It refuses without a fresh backup, and it works in one transaction:
  1. It records identity in **`held_links_l5(pageId, url, lineBlockId, lineText)`**, keyed by `pageId` with the raw URL (never guessed from the body), one row per link page, before anything is dropped. The table sits outside the entity tables, and the old build ignores extra tables, as it did A4's.
  2. **For the old build to see the URL,** it inserts the URL as the first line of each link page's body, and stores that line's block id and text in the row. That line is only visible content; it never carries identity.
  3. It drops the column and clears the undo snapshot (as A4's `clearUndo`).
- **Re-upgrade (migration 5 finding `held_links_l5`)**, row by row, inside the migration's transaction:
  - **`Page.url`:**
    - restored if the page still exists, live or trashed;
    - **if another page already owns the key, it's left unset and listed in the migration's report.** That can't come from the old build, which can't make link pages, but it's checked.
    - A page deleted for good by then has nothing to restore.
  - **Materials need nothing:** they keep `url`, and they match their page by key again. That includes a URL typed into Good Stuffs on the old build.
  - **The inserted URL line:** removed only if a block with `lineBlockId` still holds exactly `lineText`. If he edited or moved its text, it stays.
  - The held table is then dropped. **After this, a repeat paste of the same URL finds the same page.**
- **Round trip** against the live build 21eb45b (layout 4), on a copy of his DB with:
  - a page made in Notes;
  - one made in Good Stuffs with a decision;
  - a repeat paste;
  - a trashed one restored by a paste;
  - an undone paste.
  Then:
  1. rollback → 21eb45b opens it, edits the URL line on one page, trashes another link page, types a Good Stuffs URL equal to a link page's, and Undoes;
  2. migrate → the new build reads everything back with the same identities. **Pasting each URL again → "Saved before" on the same page, no second page.** The edited URL line stays, and the untouched ones are gone.

## 6. Surfaces

| Surface | Change |
| --- | --- |
| Page card | A globe icon for link pages, ↗ opens the URL, and the domain is shown when `title !== defaultLinkTitle(page.url)` at render time, with no stored flag (Jazz §2 @ a167c39). The states are reused. |
| Link page | The URL row under the title (raw, one line, Open ↗), then "Linked from". Read-only in A2. |
| Sidebar / Pages / Subpages / Trash | Globe icon for link pages. They sit under their parent ("In your days"). |
| Evening review Good Stuffs / Related | Same selection. The title comes from the page, and tapping it opens the page. |
| Morning "Bring to today" | A pasted link is a card, so it's no longer offered (cards aren't bringable). A typed Good Stuffs line still is. Agreed: Bumblebee `56de3d1e`, Jazz. |
| A6b draft | Material candidates as before. Cards aren't proposal lines. |

## 7. Checks before the candidate

- **Unit:**
  - `urlKey` (§2 list);
  - `defaultLinkTitle` (Chinese path, query, `www.`, a bad escape);
  - `paste-links`: made, reused (another day, same paste twice, different host case), restored (same-delete subtree only, an older separate delete stays, parent in trash → top level), Good Stuffs Material created/reused, Done → To sort, a typed Material linked, replay, a retry with a new op id, a stale revision then retry, a refused non-http URL;
  - `undo-paste-links`: each row of §4 plus each "unless" as its own case (and both "Kept" wordings), restored-then-edited-then-Undo (edits kept, same `trashId`), a card deleted before Undo, a card nested in a bullet comes back as a link at the same level, a stale `expectedContent` refused with nothing changed, a replay; **A and A pasted on two lines → one Undo restores both lines and deletes the page** (its own second card isn't an outside reference); **Good Stuffs pasted on day 1 (Material made), the same URL saved again on day 2 → Undo of day 1 removes only day 1's source, and the Material stays**; the same with a decision instead of a second save; **a restored set where a subpage gained a reference → not re-trashed**;
  - the invariant check over a random sequence of paste, undo, trash, restore and typed lines.
- **Browser, on a copy of his DB, 1280 and 390:**
  - Jazz §6 checks 1–8, using **his real Notes bullet structure** (Lead 2);
  - ⌘Z during the notice and after it;
  - paste → type a note on the next line → Undo: the note is kept, the cards are back as text, and the page is deleted;
  - no request leaves 127.0.0.1.
- **A5 rerun:** Ratchet reruns A5 acceptance on the A2 build. I run the review's Good Stuffs step with a pasted link page first.
- **Rollback round trip** as in §5.

## 8. For review

- **Settled since aaf1862:**
  - Undo of a page the paste made deletes it (Bumblebee, Jazz);
  - "Bring to today" no longer offers pasted links (Bumblebee, Jazz);
  - the two "Kept" wordings and the render-time domain rule (Jazz a167c39).
- **Ratchet (task #81):**
  1. the rollback's held table (now `pages.url` only) and the re-upgrade rules (§5);
  2. Undo as one server command (§4);
  3. still open from your first read: the restore set and Good Stuffs Undo under concurrency.
