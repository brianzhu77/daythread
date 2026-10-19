# A4 trash and restore: data plan

- Owner: Roadbuster. Status: **proposal for Ratchet's review**. No code yet.
- Rulings this follows:
  - Lead `5598fdab`: document pages only, including those under day pages; day pages can't be deleted (B16).
  - Lead `98df7dae` / `1a6d490b`: rollback direction A.
  - Lead `fd179341`: restore granularity, and one visibility filter.
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
  `parentId` if that page is live, otherwise to top level, **last among its new siblings** (Jazz d5789c6,
  Bumblebee 1bb9cfaa; there's no manual order until B14). Pages restored with their parent keep their order under it. A day parent is always live, so 韩国大酱汤 goes back
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
   2. **Live rows:** remove `trashedAt`/`trashId` from `present` (a page restored by the new build may still list
      them).
   3. Delete every `undo` row and the undo meta.
   4. Drop the two columns, set `user_version=3`, and check the exact layout-3 columns.
4. Print the held pages and the backup path.

**While the old build runs:** trashed pages are hidden, and nothing written is lost.

**Migration 4 on re-upgrade (code, in the initialization transaction):**
1. Add the columns.
2. If `held_trash_l4` exists: refuse, keeping the database as is, when any held id exists again as a page.
3. Otherwise put the held rows back after the existing positions, in their own order. Same parent and batch; the
   position doesn't matter, because a restore puts the page last among its siblings anyway (below).
4. Drop the table.
5. Running it a second time finds no held table and only adds nothing.

**Tried on a copy of Brian's database** (`tests/evidence/a4-plan/rollback-roundtrip.ts`, raw SQL for the script
and the migration):

| Step | Result |
| --- | --- |
| Candidate trashes 佛卡夏披萨 | trashed in `current` and `undo` |
| Down-script | today's build opens; 佛卡夏披萨 hidden; Undo empty |
| Today's build: rename 韩国大酱汤, rename again, Undo | "韩国大酱汤 v2" kept |
| Today's build, built app, 1280 and 390: Today, Oct 18 (its card to the held page), Pages, Tasks, Tags, Calendar | no error screen, no console errors |
| Migration 4 again | 佛卡夏披萨 back in the trash with batch `op1`; "韩国大酱汤 v2" kept |

Not covered yet: the real migration code and the script file; `present` on live rows the new build restored; a held
id appearing again (refusal); the backup.

## 5. Checks for Ratchet

1. Migration 4 on a copy of Brian's database: every page reads live, and read → write changes nothing else.
2. Domain tests:
   - N08–N12, N16, N22;
   - delete a child, then its parent: two batches;
   - **same-batch delete → restore only a child → move it → restore the batch: the child doesn't move**;
   - a restored page is last among its siblings; pages restored with their parent keep their order under it;
   - a day page refused;
   - tags, Linked from and every list in §3 hide and then show again.
3. Rollback round trip with the real script and migration:
   - the sequence: create, delete, restore a child alone, **edit a restored page** → downgrade → today's build edits
     and undoes → re-upgrade;
   - expected: held pages back in the trash with their batch and parent; content, tasks and the cost ledger
     unchanged;
   - a new Undo works after the cleared one;
   - running the migration and the script twice;
   - a held id appearing again → migration refused, database kept;
   - a failed backup → script stops with nothing changed.
4. On a copy of Brian's data: delete 韩国大酱汤, and #recipe no longer lists it; restore puts it back under Sun, Oct 18,
   with its card and tag.
