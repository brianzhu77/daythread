# Trash and restore layout (A4, N-7)

Owner: Jazz (Design). Status: proposal for A4. Scope (Lead `5598fdab`): **document pages only**, including pages
under a day; daily pages can't be deleted (B16). Spec: `docs/specs-v0.4/pages-delta.md` N-7, with N-5 and N-9.
Builds on `docs/design/pages-tree-layout.md`.

Mock: `prototypes/pages-trash/index.html` (`?only=t1|t2|t3|t4|p1|p2|p3`). Static; tokens from `src/styles.css`.

## 1. Delete (T1)

- Entry: **⋯ → Delete**, on the page header ⋯ and on a sidebar tree row's ⋯, under Move to… after a divider.
  Text in the app's danger red. Not shown on daily pages (no ⋯ there in this round anyway).
- **No confirm dialog** (N-7, Lead `a016ab7a`): everything is recoverable and the notice has Undo.
- Not offered in this round: Delete from the Pages list rows, from a page card, or by keyboard.

## 2. Right after Delete (T2)

- **Where you land:** the deleted page's parent, at the page's card if there is one (same rule as the breadcrumb's
  parent crumb). A top-level page lands on the Pages list. If you were on a descendant of the deleted page, the
  same applies to the deleted page's parent.
- **Notice:** "Moved to trash · Undo"; with subpages "Moved to trash · {n} subpages · Undo" (1 → "1 subpage").
  Undo = restore of exactly that delete.
- **Sidebar and lists:** the page and its subtree leave the tree, Subpages, Pages, "In your days", and Move to…
  search right away. The parent's chevron goes if it has no other children.
- **Cards that point at a trashed page** stay in the text (deleting a page never edits other pages). They render
  muted (`--ink-3` title and icon) with a small outlined **"In trash"** tag before the ›; tapping opens the trashed
  page (§4).
- **Tags** (Bumblebee): lines in a trashed page leave every tag page and the Tags list counts, like every other list.
  A tag used only there drops off the Tags list until restore. Restoring brings the lines and counts back.
- **Linked from** on other pages: an entry whose source page is in trash reads "{title} (removed)" in `--ink-3`,
  not tappable (N-5, already specced).
- **Tasks** inside a trashed page keep their state and stay on Tasks, Calendar and Upcoming (N-7, 04 P07). Where a
  task shows its source page, it reads "{title} (removed)".

## 3. Trash screen (T3, P1, P2)

- **Entry:**
  - Desktop: a quiet "Trash {n}" row with a bin icon under "＋ New page" in the sidebar, 14px `--ink-2`, count in
    `--ink-3`. Shown only when the trash isn't empty.
  - Phone: a quiet row "Trash · {n} ›" at the end of the Pages screen, below "In your days". Same rule.
  - Route: `/pages?view=trash`. On the phone the screen gets a "‹ Pages" back row.
- **Layout:** grouped grey background like Pages. Title "Trash". One line under it in `--ink-2`:
  "Deleted pages stay here until you restore them. Tasks inside them keep working."
- **One row per delete** (the unit that restores together, N-7), newest first:
  - doc icon, title (one line, ellipsis);
  - second line `--ink-3`: "From {old parent} · with {n} subpages · {when}" (parent = page title, day label, or
    "Pages" for top level; "with … subpages" only when n > 0; when = time today, otherwise the day label);
  - **Restore** button on the right: pill, `--fill`, blue text, 44px tall on the phone.
  - Tapping the row (not the button) opens the trashed page (§4).
  - Subpages deleted *with* a page are not listed as their own rows. A page deleted separately earlier is its own
    row (N-7).
- **Empty:** there's no entry point, so the screen is only reachable by URL; it shows "Trash is empty".
- No permanent delete, no "Empty trash" (N-7).

## 4. A trashed page (T4)

- Opens **read-only**: no editor, title and body in `--ink-2`, no ⋯ menu.
- Breadcrumb row: "Trash" (opens the Trash screen).
- A banner above the title: bin icon, "In trash · was in {old parent}", **Restore** on the right.
- Its Subpages list still shows and opens the trashed subpages, which show the same banner with
  "In trash · deleted with {top page}".
- **Restore granularity (N-7, Ratchet):** Restore on a subpage's banner restores **that subpage and its own subtree**
  (only members still in that delete). Its parent is still in trash, so it goes to top level with
  "Restored {title} to Pages · {parent} is in trash". Restore on the top page's banner or its Trash row restores
  **what's left** of that delete; members restored earlier stay where they are now (not moved, not duplicated).
  The Trash row keeps its place and its "with {n} subpages" count drops accordingly.

## 5. Restore (T3, P3)

- **Back where it was:** same parent, same subtree. Notice: "Restored to {parent} · Open". Stay on the Trash
  screen (the row leaves); Open goes to the page. From the banner (§4) the page just becomes editable in place,
  with the same notice minus Open.
- **Old parent gone or in trash:** restored to top level. Notice: "Restored {title} to Pages · {parent} is in
  trash" (or "· {parent} was deleted" if it no longer exists). For a parent that is a day this can't happen
  (days can't be deleted this round).
- **Cards and Linked from** come back to normal at once (N-5: references whose cards still exist).
- **Failure:** the existing save-failed banner; the row stays.

## 6. States checklist (for Ratchet)

1. Delete a page with 2 subpages → notice says "2 subpages", you land on the parent at its card, the card reads
   "In trash", the tree and Subpages drop all three.
2. Undo from the notice → everything back, card normal, tree re-expanded to the page.
3. Trash screen: one row for that delete; a page deleted separately earlier is its own row.
4. Open the trashed page from its card → read-only, banner, Subpages open the trashed children with their banner.
5. Restore from the Trash row → back under the old parent; notice + Open.
6. Delete child, then parent separately; restore the child alone → top level, notice names the parent.
6b. Delete parent with child in one go; restore only the child from its banner (top level), move it somewhere,
    then restore the parent's row → parent comes back under its old parent, the child stays where it was moved.
7. A task inside a trashed page still shows on Tasks; its source reads "(removed)".
8. Brian's real data copy: delete 韩国大酱汤 (under Sun, Oct 18), see "In your days" drop it and #recipe no longer list its lines (the tag disappears if it has no other uses), restore → back under
   Sun, Oct 18. 390 and 1280.
9. Daily pages: no Delete anywhere.
