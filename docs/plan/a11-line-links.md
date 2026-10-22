# A11 · link to a line — plan for review (revision 4, v1 scope)

- Author: Roadbuster · 2026-10-22 · status: **plan, not built**. No code until Ratchet's #141 passes (task #120).
- **Rev 4 = rev 3 (3ce487b) minus cross-page move identity** (Lead `a7554a7d`): a paste always gets fresh ids, as today.
  Rev 3's §3 (server rename rule) and §4 (cut windows) are gone; **move identity is v2, task #142 (B29)**, built when
  Bumblebee's usage trigger fires. Jazz's wording (`d610ace6`, accepted): **"Line not found · {page}"**, the notice
  **"Couldn't find that line"**, and **"Page not found"** for a page that no longer exists. Every §8 check is named as a
  script assertion. Metadata goes to the browser whole, as today, with a size guard instead of a trim (Lead `b8753f89`).
  The states are Jazz's **main da91988**.
- Inputs: Brian `c5c9142e` #1; Lead `4aa0a79b`, `5a74c8cd` (rollback degradation accepted), `a0c0a578`, `a7554a7d`;
  Bumblebee `565cad22`, `f9abca12` (task targets, trash); Jazz `docs/design/line-links-states.md` (states §5/§7 as
  updated today); Ratchet #98 (`fb4dae8`) and #141 (`a674bf4`).
- Base: main b0c80ef. Storage is Postgres; save-on-leave (B25) has shipped.

## 0. Which changes keep a line's id (unchanged by A11)

| Change | Line id | v1 |
| --- | --- | --- |
| edit, split by Enter (first half), indent/outdent, **drag** within the page | kept | followed |
| **task moved to another day** (row menu, review, hand-off) | new row id, **same task** | followed **by the task** (§2) |
| **cut and paste** (another page, or reordering on the same page) | new id, as today | **"Line not found · {page}"** |
| **Bring to today** | a copy; the source line is unchanged | stays on the source line |
| merged into the line above, deleted | gone | **"Line not found · {page}"** |

So in v1, **a line's id only ever lives on the page it was made on.** That's what makes the resolver small: a plain
line is either on its page or it's not found. Only tasks move between pages, and they're followed by `taskId`.

## 1. Where a line link lives

- **The same inline node as a `[[` link**, with optional props: `{ type: "pageRef", props: { pageId, refId, lineId,
  taskId? } }`. `pageId` is the line's page; `taskId` is set when the line is a task row.
- **Server:** `inlineRefs` and the `refs` projection gain optional `lineId`/`taskId`; B15 keeps one time per `refId`.
- **Not in a task title:** pasting a line link into a task title inserts its words as text, as a page link does.

## 2. Resolving a link: one pure function, every reader uses it (Ratchet 1, 4, 5)

`resolveLine(ws, { pageId, lineId, taskId? }) → { state, pageId, blockId, words }` in `page-refs.ts`. The chip, the
jump, the plain URL (through a server function, §4) and Linked from all use it.

**What it relies on** (no format change; all optional JSON in the workspace row):

- **`Task.doneOn: LocalDate | null`**, set by every path that marks a task done (the `task-status` command and the
  editor tick) and cleared when it's reopened or cancelled. For tasks done before A11 it's derived as the latest
  `included` placement date, else `plannedOn`, else `lastPlannedOn` (Bumblebee: few such tasks; he started fresh Oct 22).
- **`seen` on task-row metadata**, used only to order a task's rows on **document** pages by recency (§2 rule 2.3).
  `save-editor` already copies every block of the previous projection into `editorBlockMetadata` and never prunes it. A11
  also writes an entry for each **task row** of the *new* projection, stamped `seen: <this save's revision>`, so a row is
  stamped on its first save (Ratchet #141). Entries without `seen` (written by an older build, §6) rank below stamped
  ones, then by page id.
- **A removed task row's `taskId`**: its metadata entry on its own page (a `NoteBlock` keeps `taskId`). Since ids never
  leave their page in v1, that entry is always on the link's `pageId`.

**Order:**

1. **Which task, if any:** the link's `taskId`; else the URL's `task=`; else, if `lineId` is a task row on `pageId`, its
   task; else the `taskId` on `pageId`'s metadata entry for `lineId`. A task found this way is followed after every row
   the link was made on has gone (Ratchet 1).
2. **A task: the target is chosen first, and trash applies after** (Ratchet #141, Bumblebee `f9abca12`):
   1. **Open and planned:** the page of its `plannedOn` day, if it has a row for the task.
   2. **Done:** the page of its `doneOn` day, if it has a row.
   3. Otherwise (no plan day, i.e. Not today or paused, or no row there): **the newest live row**. That's daily pages by
      date, newest first, then document pages by the highest `seen` of the row, then page id. Never array order. If
      **only trashed rows** exist → **trashed**, naming the newest trashed page by the same order.
   4. Two rows for the task on one page: the first in document order.
   → **live**, or **moved** when that page isn't `pageId`. A cancelled task resolves like a done one, using its last
   included day.
   - **Day pages can't be trashed today** (A4 is documents only), so a plan or done target is never trashed now. **When
     B16 lands:** a trashed plan or done day shows **trashed** for that day, never a silent jump to an older row.
   - Examples: only trashed rows → trashed, naming the newest trashed page. Plan day trashed with a live history row
     (after B16) → trashed for the plan day.
3. **Not a task:** `lineId` on `pageId`, as a block **or a custom heading** (a `Section` of kind `custom`; template role
   headings are never targets, Ratchet 5) → **live**.
4. **The holder's trash state applies when the line is found** (Ratchet 4): resolved page trashed → **trashed**, for chip,
   jump and Linked from alike.
5. **Not on its page:** `pageId` exists but the line isn't on it → **"Line not found · {page}"**. Tapping opens that page at
   the top with **"Couldn't find that line"**. That's true whether he deleted it, moved it, or cut and pasted it on the
   same page (Jazz).
6. **Page not found:** `pageId` no longer exists, which only happens for pages deleted outright.

**Words:** from the resolved block's projected `NoteBlock` text, or the section title for a heading, always the current
projection, never stored editor JSON or metadata (Ratchet 5). A not-found line shows no words.

## 2a. Metadata: sent whole, with a size guard (Ratchet `d25bd962`, Lead `b8753f89`)

- `editorBlockMetadata` keeps a copy of every block a page has ever had and is never pruned. `wasBrought` needs it so a
  deleted Bring-to-today line isn't offered again, and B15/A9a reuse its times on Undo. A11 adds one `seen` number per
  task-row entry.
- **The browser gets it whole, as today.** The editor's flush runs `applyCommand` in the browser before the server
  confirms, and the domain's projection, `wasBrought` and ref times read this metadata. So any trim would make the two
  runs differ (Ratchet). His real row (revision 105, a full day of editing) has **29 entries, 4.7 KB** on today's page;
  the 2.27 MB row is receipts and undo, which B26 already keeps out of the browser (Lead). Nothing is pruned on the
  server either.
- **Guard instead of a trim:** a check fails when any page's metadata passes **100 KB** (run on the candidate's copy of
  his data, and reported in Bumblebee's usage read). We trim only if it ever grows.
- A plain URL is still resolved on the server (§4), which is cheap and keeps the URL path independent of the client.

## 3. Cut and paste in v1 (unchanged code)

Cut and paste keeps today's behaviour exactly: a paste gives every block a fresh id, and a moved task row keeps its
`taskId` (the paste handler's `moving` branch). So:

- a linked **plain line** cut from its page (to another page, or to another spot on the same page) reads **"Line not
  found · {page}"**;
- a linked **task row** cut and pasted elsewhere is still followed, by its task.

That's the cost Bumblebee priced (Lead `a7554a7d`). **v2 trigger (B29, #142):** in the usage read, any line link reading
"Line not found" while its words exist elsewhere.

## 4. Copy, paste and the URL

- **Copy link to line** (Jazz §1): in the row menu (⌘/ on any line), in the task ⋯, and in the selection bar when exactly
  one line is selected; not on template headings. It writes `application/x-daythread-line` = `{ pageId, lineId,
  taskId? }` and `text/plain` = **`/pages?page=<pageId>&block=<lineId>[&task=<taskId>]`**. The notice reads "Link to
  line copied". A failed clipboard write says **"Couldn't copy"**, never "copied" (Ratchet).
- **Paste:** `pasteHandler` checks the line type first, then a `text/plain` that is **this app's own origin** with `page=`
  and `block=`, and inserts a line link at the caret. Both checks run before A2's link paste, so an in-app URL never
  becomes a link card. Other hosts, unknown params and malformed URLs paste as today.
- **Opening the URL:** when the block isn't on the URL's page, the `?block=` jump calls a small server function that runs
  `resolveLine` on the full workspace, so the URL lands where the chip would.

## 5. Opening, Linked from, trash

- **Tap:** go to the resolved page with `block=`, reusing the tag jump (scroll, tint, nothing focused), at Jazz's "a
  third from the top", clearing B20's fade at 390. A second tap on the same page jumps again.
- **Linked from:** a line link counts for its **resolved** page, deduplicated per linking page; the B15 time is the
  link's own.
- **Trash:** §2 rule 4.

## 6. Format and rollback, on Postgres (verified on local Postgres 17 and on Supabase)

- **No schema or migration.** Everything new is optional JSON: the `pageRef` props, `refs[].lineId/taskId`,
  `editorBlockMetadata[].seen` and `Task.doneOn`. (Local SQLite dev storage gets a nullable `doneOn` column the existing
  way, layout 7. Production doesn't use SQLite.)
- **Rollback = deploy the previous build.** Checked with main b0c80ef standing in as the rollback build, on a throwaway
  `daythread_check_a11*` schema (`scripts/exp-a11-pg-seed.ts`, `tests/evidence/a11-plan-pg/old-build.mjs`). Lead reran
  it on Supabase with the same output (`a7554a7d`):
  - A11-shaped data opens with **no errors**; line links render as page links ("Target page", "Today").
  - The old build's first save of that page leaves both links' props as exactly `newTitle+pageId+refId`, so **line links
    degrade to page links** (accepted, `5a74c8cd`). Rolling forward doesn't bring the line part back. The rollback note
    to Brian says so, plus "reload".
  - The old build **keeps `doneOn`**. It keeps `seen` only on entries for removed lines (probe kept 7); entries for the
    page's live blocks are rewritten without it (3 of 3). Live task rows are restamped at the A11 build's next save of
    that page, so the only effect is that rows removed while rolled back rank by page id instead of recency.
  - Schemas dropped afterwards; `daythread` untouched.

## 7. Size

**About 3 days:** the resolver with `doneOn`, `seen` and targets before trash, 1 day; the server URL resolver, a few
hours; the chip, three copy entry points, paste, jump and Linked from, 1 day; the checks below, 1 day.

## 8. Checks, named (Lead: each a script assertion)

**Unit — `tests/a11-resolve.test.ts`** (pure `resolveLine` and `save-editor` on PGlite):

| Name | Asserts |
| --- | --- |
| `task: past → today` | link made on Oct 18's row → today's row (`moved`); Oct 18's history row stays |
| `task: today → tomorrow` | source row removed → tomorrow's row, by chip props **and** by a URL without `task=` (metadata `taskId`) |
| `task: rescheduled twice` | follows to the latest plan day |
| `task: done` / `task: done before A11` | lands on `doneOn` / on the derived day |
| `task: not today, paused` | newest live row: daily by date, then documents by `seen`, then page id |
| `task: only trashed rows` | `trashed`, naming the newest trashed page |
| `task: B16 note` | a plan day marked trashed (synthetic) → `trashed` for that day, not the history row |
| `line: live / not found / page not found` | live on its page; deleted → `Line not found · {page}`; page gone → `Page not found` |
| `line: cut and pasted elsewhere` | the line's new id doesn't count; `Line not found · {page}` (v1 cost) |
| `line: holder trashed` | found on a trashed page → `trashed` for chip, jump and Linked from |
| `heading: custom vs template` | a custom heading resolves with its current title; a template heading is never a target |
| `words: current projection` | rename the line → the new words; never the stored editor JSON |
| `seen: first save` | a task row saved once has `seen` = that revision; an unstamped entry ranks below stamped ones |
| `doneOn: every path` | set by `task-status` done and by the editor tick; cleared on reopen and on cancel |
| `browser = server metadata` | after the same saves and an Undo, `forBrowser(ws).pages[*].editorBlockMetadata` deep-equals the full workspace's (Ratchet) |
| `metadata size guard` | on the candidate's copy of his data, every page's `editorBlockMetadata` is under 100 KB (prints the largest) |

**Browser — `tests/evidence/a11/ui-check.mjs`** (built server, copy of his data, 1280 / 390 / 390 touch; every assertion
re-read after a **reload**: ids, refIds, Linked from times):

| Name | Asserts |
| --- | --- |
| `copy: three entry points` | row menu (⌘/), task ⋯, selection bar each write the line type and the URL; template headings offer none |
| `copy: clipboard fails` | a rejected write shows "Couldn't copy" and no "copied" notice |
| `paste: line type / own URL / foreign URL` | the line type and an own-origin URL make a chip; other hosts, unknown params, malformed URLs don't; never a link card |
| `paste: into a task title` | gives the words as text |
| `chip and jump` | chip words and page; tap lands a third from the top, tinted; second tap jumps again; keyboard activation and Back |
| `chip: Line not found` | delete the line → "Line not found · {page}"; tap → the page at the top with "Couldn't find that line" |
| `chip: cut and paste` | cut a linked plain line to another page → "Line not found · {page}"; a linked task row → followed |
| `URL: fresh view` | each original plain URL opened in a new context lands where the chip does (server resolver) |
| `Linked from` | counts on the resolved page, once per linking page, with the link's B15 time |
| `long excerpt at 390` | no overflow, one line, ellipsis |

**Rollback — `tests/evidence/a11-plan-pg/old-build.mjs`**, rerun on the candidate: link props `newTitle+pageId+refId`
after the old save, `doneOn` kept, `seen` as in §6, no errors.

**Unchanged:** `stable-check`, `actions-check`, and the caret check, all green.

## 9. For review

- **Ratchet:** the cut scope only (Lead `a7554a7d`): §0, §2 (simplified by ids never leaving their page), §3, §8 names.
- **Jazz:** the strings are yours from `d610ace6`.
- **Bumblebee:** the v2 trigger is B29 (#142).
