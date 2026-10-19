# A4 trash and restore: data plan

- Owner: Roadbuster. Status: **proposal for review** (Lead, Ratchet). No code yet.
- Scope (Lead `5598fdab`): pages-delta N-7, **document pages only**, including documents under day pages. Day pages
  can't be deleted: no menu item, and the command refuses. Day-page deletion is B16.
- Base: main `1260914`, storage layout 3 (`sqliteMigrations.length === 3`).

## 1. Stored fields: two page columns, migration 4

| Column | Type | Meaning |
| --- | --- | --- |
| `pages.trashedAt` | TEXT, ISO time | Null = live. Set = in the trash since then. |
| `pages.trashId` | TEXT | The delete that trashed it (its operation id). One delete = one id for the page and its whole subtree. |

- Migration 4: `ALTER TABLE pages ADD COLUMN "trashedAt" TEXT` and the same for `"trashId"`. Existing rows read as live.
- `parentId` is kept on trashed pages, which is what "restore to its old place" needs. No other field changes.
- Both columns go on the `current` and the `undo` snapshot rows, like every page field, so Undo of a delete or restore
  is the existing whole-workspace Undo.

Not chosen: a separate trash table, or state inside an existing JSON column. Either one avoids the migration only
until the next one (A2 needs URL columns). It also splits a page's state across two places, which makes the undo
snapshot harder to keep consistent.

## 2. Commands (domain)

- `delete-page { pageId }`: refused for day pages, pages already in the trash, and missing pages. Sets
  `trashedAt` and `trashId = operationId` on the page and every **live** descendant. Pages trashed earlier keep
  their own `trashId`. The notice gives the count: "Moved to trash · 3 subpages · Undo".
- `restore-pages { trashId }`: brings back the pages that still carry that `trashId`. A page restored on its own
  earlier no longer carries it, so it isn't moved or duplicated (N22). Each restored root goes back under its
  `parentId` if that parent is live; otherwise it goes to top level and says so (N12). Children keep their parent,
  which comes back with them.
- `restore-page { pageId }`: one page from the Trash screen, with its own trashed subtree from the same delete.
- Tasks, placements, events, materials and references are never touched by either command (N-7, 04 P07).

## 3. Read rules (one helper, `isLive(page)`)

Trashed pages stay in `workspace.pages`, so every id still resolves. Each place below filters through
`isLive`, and each one gets a test:

- tree, sidebar and Pages: `childPages`, `pagesInDays`, `sidebarDays`, `moveTargets`.
- Linked from:
  - a trashed source shows "(removed)" and can't be opened (N-5);
  - a trashed target's page isn't shown.
- Refused on a trashed page: move into it, `create-document` under it, `insert-reference` to it, and moving it.
- Tags: occurrences on trashed pages are left out of `tagIndex`.
- Cards in other pages that point to a trashed page show "In trash · Restore" (Jazz's layout). Removing the card
  still never touches the page.
- Opening a trashed page by URL shows it read-only with a Restore bar (Jazz).

## 4. Rollback (needs a script)

Today's build refuses any newer layout (`version > sqliteMigrations.length` → "Unsupported database layout"), and
its column check is exact. **Tried on a copy of Brian's database** (`tests/evidence/a4-plan/rollback-experiment.ts`):

| Step | Result |
| --- | --- |
| Layout 3 | opens: 8 pages, revision 156 |
| Add both columns + `user_version=4`, trash 佛卡夏披萨 | today's build refuses: "Unsupported database layout" |
| Down-script: `DROP COLUMN trashId`, `DROP COLUMN trashedAt`, `user_version=3` | opens; 佛卡夏披萨 is live again |

`scripts/rollback-layout-4.mjs`:
1. Refuses unless `user_version` is 4.
2. Backs up the file next to it.
3. Prints the trashed pages (title, `trashId`).
4. Runs the down-script in one transaction.
5. Checks the layout-3 columns, then commits.

**Effect:** trashed pages come back as live pages in the old build; nothing is lost. Upgrading again reruns
migration 4 with every page live. Pages trashed before the rollback stay restored, and the script prints them so
this is known.

The alternative is restoring the pre-release backup, which loses everything written since. Keep it as a last resort only.

## 5. Checks for Ratchet

1. Migration 4 on a copy of Brian's database:
   - every existing page reads live;
   - the round trip `readWorkspace` → `writeWorkspace` doesn't change anything else;
   - the undo snapshot keeps working.
2. N08–N12, N16, N22 as domain tests, including:
   - delete A > B > C;
   - restore C alone;
   - restore the A delete, after which C isn't moved;
   - a parent gone → top level;
   - a day page refused.
3. Rollback: the candidate trashes a subtree, then the script, then today's build opens it and makes an edit, then
   the candidate reopens it (migration reruns). Expected:
   - pages are live;
   - references and tasks are unchanged;
   - the undo snapshot is consistent.
4. Brian's two pages under Sun, Oct 18: delete then restore puts them back under the day, and the day's card to each
   comes back to life.
