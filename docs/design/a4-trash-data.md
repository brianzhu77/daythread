# A4 trash and restore: data plan

- Owner: Roadbuster. Status: **proposal for Ratchet's review**. No code yet.
- Rulings this follows:
  - Lead `5598fdab`: document pages only, including those under day pages; day pages can't be deleted (B16).
  - Lead `98df7dae` / `1a6d490b`: rollback direction A.
  - Lead `fd179341`: restore granularity, and one visibility filter.
  - Lead `8e4be383`: id clash split; Lead `cdbbd148`: references by time of writing.
  - Layout: Jazz `docs/design/pages-trash-layout.md` (0aa65f1, Tags rule 0f79066).
- Base: main `1260914`, storage layout 3 (`sqliteMigrations.length === 3`).

## 1. Stored fields: two page columns, migration 4

| Column | Type | Meaning |
| --- | --- | --- |
| `pages.trashedAt` | TEXT, ISO time | Null = live. Set = in the trash since then. |
| `pages.trashId` | TEXT | The batch: the delete's operation id, the same for the page and every page trashed with it. |

- Migration 4: `ALTER TABLE pages ADD COLUMN "trashedAt" TEXT` and the same for `"trashId"`. Existing rows read as live.
- `parentId` is kept on trashed pages, which is how a restore finds the old place.
- Both columns live on the `current` and the `undo` rows like every page field, so Undo of a delete or a restore is
  the existing whole-workspace Undo.

## 2. Commands (domain)

- `delete-page { pageId }`:
  - Refused for a day page, a page already in the trash, and a missing page.
  - Puts the page and every **live** descendant in the trash with `trashId = operationId`. Pages trashed earlier
    keep their own batch.
  - The receipt gives the count for "Moved to trash · 2 subpages · Undo".
- `restore-page { pageId }`: the page plus those of its descendants that are **still in the same batch**.
  - From a subpage's banner: its parent is still in the trash, so it goes to top level ("Restored Kyoto to Pages ·
    Trip ideas is in trash").
- `restore-batch { trashId }`: the batch's **remaining** members, from the Trash row or the top page's banner.
  Pages restored earlier stay where they are now and aren't duplicated.
- **Where a restored page goes:** every restored page whose parent isn't coming back with it goes under its old
  `parentId` if that page is live, otherwise to top level. Its place among siblings isn't promised until B14 (Jazz
  2956eea): a normal restore leaves the row where it is in the stored order; after a rollback re-upgrade it's last. A day parent is always live, so 韩国大酱汤 goes back
  under Sun, Oct 18.
- **What never changes:** tasks, placements, events, materials, references and the cost ledger.

## 3. One visibility rule (Lead `fd179341`)

`visiblePages(ws)` in `page-tree.ts` is the only way lists read pages.

- **Out of every list and count while in the trash:** Pages and "In your days", the sidebar tree, Days, Move to…
  (as a target and as a page to move), Subpages, Tags (occurrences and counts), and Linked from (a trashed source
  shows "(removed)").
- **The two exceptions:** a card pointing at a trashed page (muted, "In trash", opens it), and the Trash screen,
  which lists one row per batch with the remaining count.
- **Refused on a trashed page:** moving it or into it, `create-document` under it, and `insert-reference` to it.
  It opens read-only with Restore.

Every list above gets a test that a trashed page is absent and that restore brings it back.

## 4. Rollback (direction A): a script, lossless content, Undo history cleared

Today's build (5193991) refuses any newer layout (`version > sqliteMigrations.length` → "Unsupported database
layout") and checks page columns exactly. It doesn't refuse extra tables (`verifySqliteLayout` checks known tables
only).

**`scripts/rollback-layout-4.mjs`**:
1. Run only with the app stopped. It refuses unless the file has the Daythread `application_id`,
   `user_version` 4, and exactly the layout-4 tables and columns.
2. **Backup:** a consistent copy with SQLite's `VACUUM INTO` (or the backup API) next to the file, never a plain
   file copy under WAL. If the backup fails or doesn't read back, it stops before touching anything.
3. **One transaction** for the rest; any error or check failure rolls back everything.
   1. Move the **current** trashed rows out of `pages` into `held_trash_l4`, with their full `present`. Rows that
      exist only in the undo snapshot are dropped along with Undo.
   2. **Record the source edges** that point at a held page, in `held_refs_l4 (kind, ownerId, pageId, blockId)`:
      - `task`: every task whose `sourcePageId` is a held id (`ownerId` = task id);
      - `material`: every entry of a material's `sources` whose `pageId` is a held id, **per edge**
        (`ownerId` = material id, plus that entry's `pageId` and `blockId`), never the material as a whole;
      - `capture`: every capture whose `pageId` is a held id.
   3. **Live rows:** remove `trashedAt`/`trashId` from `present` (a page restored by the new build may still list
      them).
   4. Delete every `undo` row and the undo meta.
   5. Drop the two columns, set `user_version=3`, and check the exact layout-3 columns.
4. Print the held pages and the backup path.

**While the old build runs:** trashed pages are hidden, and nothing written is lost.

**Migration 4 on re-upgrade (code, in the initialization transaction):**
1. Add the columns.
2. If `held_trash_l4` exists and a held id exists again as a page, see "Id clash" below.
3. Put the held rows back after the existing positions, in their own order, with the same parent and batch. Their
   place among siblings isn't promised until B14 (§2).
4. **Clear Undo** (the `undo` rows and the undo meta) whenever held rows were put back. Undo restores a whole
   earlier workspace, and the one today's build left behind has no held pages. An Undo after the re-upgrade would
   otherwise drop them from the trash, and after a clash it would also put back the old source ids. The cost is the last
   Undo from the rollback period.
5. Drop both held tables.
6. Running it a second time finds no held table and only adds the columns, which already exist, so it does nothing.

**Today's build with held pages (Lead `e7ab12dc` points 3–5)**, built app on a downgraded copy of Brian's database
(`tests/evidence/a4-plan/old-build-setup.ts`, `old-build-screens.mjs`, `reupgrade.ts`):

| Lead point | Seen | Verdict |
| --- | --- | --- |
| 3. A card on Oct 18 pointing at the held 佛卡夏披萨 | No crash, but it reads **"Untitled · Not created · Retry"**: today's build takes any card to a missing page for a `/page` whose create failed. **Retry would create a new empty page with the held id**, under Oct 18. | **Fails "doesn't create a page".** Can't be prevented without changing today's build or the card, both ruled out. Handled at re-upgrade (below). |
| 4. A task written in the held page | Listed under Open; ticking it marks it done; no error | Passes |
| 5. A subpage restored alone, parent held | Shows at top level in Pages; after re-upgrade the parent is back in the trash (batch `op1`) and the subpage stays live at top level | Passes |

**Id clash (from point 3), ruled by Lead `8e4be383`** (Jazz's split, never refuse). At re-upgrade, a live page may
carry a held id because Retry recreated it.
- **The live page is still empty:**
  - Empty means a document page with an empty title and no child pages. It has no block with text, and no task,
    event, link or card block. No task has it as its source.
  - Then the migration drops it and puts the held row back in the trash under its **original id**. The card reads
    "In trash" again, and Restore reconnects it.
- **Otherwise, or when in doubt:** keep both. The held row goes back to the trash under a **new id** with its
  batch, parent and content. Which references move to the new id follows Lead `cdbbd148` (by time of writing): anything written
  before the downgrade belongs to the held page, and anything written during the rollback belongs to the live page.
  - **Held rows, all of them, any batch:** one id map applies to every `parentId`, and to every page reference
    inside held content: the `pageLink` `props.pageId` in `editorJSON`, `targetPageId` in `sections` blocks and in
    `editorBlockMetadata`. A child deleted in an earlier batch than its parent therefore follows the parent's new id.
  - **Recorded source edges** (`held_refs_l4`, written by the down-script): each one still present and still
    pointing at the old id moves to the new id. For a material that means only that `sources` entry, matched on
    `pageId` and `blockId`; other entries of the same material, including ones added on the live page during the
    rollback, stay.
  - **Everything else stays on the live page:** live pages' `parentId`, cards and links in live pages (including the
    one whose Retry made the page), and tasks, material sources and captures not in the record.
    No live page can have a held parent when the down-script runs: a delete takes every live descendant, and a
    child restored on its own goes to top level. So live children of the old id were all made during the rollback.
- The **empty** case keeps the original id, so nothing is remapped there.
- **Either way** the migration logs what it did, including the id mapping.

The note to Brian for a rollback includes: "During the rollback a card may show 'Not created · Retry'. Your page is
safe in the trash; you don't need to tap it." It also says (Bumblebee `b12ff5de`): "Undo history resets at both steps,
when we roll back and when we upgrade back; your pages and the trash are kept."

**Tried on a copy of Brian's database** (`tests/evidence/a4-plan/rollback-roundtrip.ts`, raw SQL for the script
and the migration):

| Step | Result |
| --- | --- |
| Candidate trashes 佛卡夏披萨 | trashed in `current` and `undo` |
| Down-script | today's build opens; 佛卡夏披萨 hidden; Undo empty |
| Today's build: rename 韩国大酱汤, rename again, Undo | "韩国大酱汤 v2" kept |
| Today's build, built app, 1280 and 390: Today, Oct 18 (its card to the held page), Pages, Tasks, Tags, Calendar | no error screen, no console errors |
| Migration 4 again | 佛卡夏披萨 back in the trash with batch `op1`; "韩国大酱汤 v2" kept |

Not covered by this experiment: the real migration code and the script file; `present` on live rows the new build
restored; the id clash (both cases) and the source-edge record; Undo cleared at re-upgrade; the backup. All are in
§5.

## 5. Checks for Ratchet

1. Migration 4 on a copy of Brian's database: every page reads live, and read → write changes nothing else.
2. Domain tests:
   - N08–N12, N16, N22;
   - delete a child, then its parent: two batches;
   - **same-batch delete → restore only a child → move it → restore the batch: the child doesn't move**;
   - a restored page is under the right parent (its place among siblings isn't checked until B14);
   - a day page refused;
   - tags, Linked from and every list in §3 hide and then show again.
3. Rollback round trip with the real script and migration:
   - the sequence: create, delete, restore a child alone, **edit a restored page** → downgrade → today's build edits
     and undoes → re-upgrade;
   - expected: held pages back in the trash with their batch and parent; content, tasks and the cost ledger
     unchanged;
   - a new Undo works after the cleared one;
   - running the migration and the script twice;
   - Retry on a card to a held page in today's build, leave the page empty, then re-upgrade → the empty page is
     gone, the held page is in the trash under its original id, and the card reads "In trash";
   - Retry, write one line in the page, then re-upgrade → both kept: the live page has the original id and the
     line; the held page is in the trash under a new id with its content; the log lists the mapping;
   - **two batches + Retry with writing + existing sources** (Ratchet `33d75688` / `96e4efd5`, Lead `cdbbd148`): the held parent P has a task and a
     material source from its own blocks, and a capture; delete the child C, then P (two batches) → downgrade →
     in today's build Retry P's card, write one line, create a task from that line, and save a link that reuses
     P's material from the live page → re-upgrade. Expected: both pages kept; the held P is in the trash under a
     new id; C's `parentId` is P's new id; P's old task, material edge and capture point at the new id; the new task
     and the new material edge stay on the live page; the card opens the live page; the log lists the mapping;
   - after a re-upgrade with held rows, Undo is empty, and Undo after a new edit doesn't remove a held page;
   - a task written in a held page still shows and can be ticked in today's build;
   - a subpage restored alone, parent held → top level in today's build; after re-upgrade the parent is back in the
     trash and the subpage stays;
   - a failed backup → script stops with nothing changed.
4. On a copy of Brian's data: delete 韩国大酱汤, and #recipe no longer lists it; restore puts it back under Sun, Oct 18,
   with its card and tag.
