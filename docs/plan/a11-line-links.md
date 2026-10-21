# A11 · link to a line — plan for review

- Author: Roadbuster · 2026-10-21 · status: **plan, not built**. No code until Ratchet's pre-review.
- Inputs: Brian `c5c9142e` #1 (Oct 18, "block-level reference like Notion"); Lead `4aa0a79b` (layout 6, moves,
  rollback, B15/Linked from); Bumblebee `961b5f0f` (follow the line; a removed line opens its last page and says so);
  Jazz `docs/design/line-links-states.md` @ 0cf83e7 (the design source).
- Base: main 0cf83e7.

## 0. Two findings that shape the plan

1. **It stays layout 6, with no migration: verified.** A link with an extra `lineId` prop was saved through
   `save-editor` on a copy of his data, then opened in the current build (main, which is also the rollback build):
   - it renders as an ordinary page link, with no errors;
   - the first save of that page in the current build **drops `lineId`** (BlockNote keeps only known props). So after
     a rollback, line links on any page he edits become page links to the line's page. Nothing he wrote is lost.
   Evidence: `scripts/exp-line-link-seed.ts` and `tests/evidence/a11-plan/old-build.{mjs,txt}`.
2. **Which moves keep a line's id today** (Jazz §5, Lead), read from the code:

   | Change | Line id | Plan |
   | --- | --- | --- |
   | edit, split by Enter (first half), indent/outdent, drag within the page | kept | followed |
   | **task moved to another day** (row menu, review, hand-off, carry-over) | **new row id**, same task | followed **by the task** (§2) |
   | **cut and paste** (same page or another page) | **new id** (the paste gives every block a fresh id) | followed **if** cut-and-paste keeps ids (§3) |
   | **Bring to today** | it's a **copy**; the source line is unchanged | the link stays on the source line (not a move) |
   | merged into the line above (Backspace at its start), deleted | gone | "Line removed · {last page}" |

   So "follow the line" needs two things beyond the id: the task's identity for task rows, and keeping ids on
   cut-and-paste moves. Jazz's §5 lists Bring to today as a move. It isn't one: it copies the line, so the link
   rightly stays on the original.

## 1. Where a line link lives

- **The same inline node as a `[[` link**, with optional props: `{ type: "pageRef", props: { pageId, refId,
  lineId, taskId? } }`. `pageId` is the page the line was on when the link was made, which is the fallback.
  `taskId` is set when the line is a task row.
- **The server's view:** `inlineRefs` and the `refs` projection gain optional `lineId`/`taskId`. B15 keeps one time
  per `refId`, so a line link is one reference with its own time (when it was made), as now.
- **Where it can go:** the same lines as a page link. **Not in a task title.** The server refuses a `pageRef` in a
  task row (A9a §1, `A task row cannot hold a page link`), so pasting a line link into a task title inserts the
  line's words as text, as a page link does there. **@Jazz, your §2 says "a link inside the title, as page links
  are", but page links aren't allowed there today.** I recommend text, to keep one rule.

## 2. Resolving a link (one pure function, every reader uses it)

`resolveLine(ws, ref) → { state, pageId, blockId, words }`, in `page-refs.ts`, tried in this order:

1. the block `lineId` on the page `pageId` → **live**;
2. the block `lineId` on any other page (a cut-and-paste move, §3) → **live, moved**;
3. `taskId` set: the task's current row, preferring its planned day's page, then any page showing it → **live,
   moved**. A done or cancelled task still resolves;
4. otherwise, if page `pageId` exists → **removed** ("Line removed · {page}"), and if that page is in the trash →
   **trashed**;
5. otherwise → **not found**.

The chip's words come from the resolved block's `NoteBlock` text (live, nothing stored), and its "where" from the
resolved page (day label or title).

## 3. Keeping ids on cut-and-paste moves

The paste handler already knows a paste is a **move** (`moving`: the clipboard's cut token matches). Today a move
still gives every block a new id. The plan keeps the ids on a move: `fresh()` keeps `node.id` when `moving`.
- **Same page:** the cut removed the originals from the same document, so no duplicates.
- **Another page, same tab:** the cut removes the originals in the source editor first. The two pages save
  separately, though, so for up to one save (450ms) both pages can hold the id. The resolver prefers the page
  `pageId` and then any other page, so during that window the link may point at the old copy; it settles at the next
  save.
- **@Ratchet: the risk to check** is today's by-id lookups that span pages (capture Undo's `appliedSnapshot`, edit in
  place) during that window. If it's judged too risky, drop this part: a cut-and-paste move then shows "Line removed
  · {old page}", and the rest of A11 is unchanged.

## 4. Copy and paste

- **Copy link to line** (Jazz §1):
  - in the row menu, which ⌘/ now opens on **any** line, not only task rows;
  - in the task ⋯;
  - in the selection bar when exactly one line is selected.
  It writes `application/x-daythread-line` = `{ pageId, lineId, taskId? }` and `text/plain` = the URL
  `/pages?page=<pageId>&block=<lineId>` (one form for days and pages, already routed). The notice reads "Link to line
  copied".
- **Paste:** `pasteHandler` checks the line type first, then a `text/plain` that's this app's URL with `block=`, and
  inserts a line link where the caret is, as `[[` does. Both checks run **before** A2's link paste, so an in-app URL
  never becomes a link card.
- **Opening from another app (the URL):** the existing `?block=` jump. When the block isn't on that page, the editor
  asks the resolver (§2) and goes to where it is now. A removed line opens the page at the top with "That line was
  removed".

## 5. Opening, Linked from, trash

- **Tap:** navigate to the resolved page with `block=`, reusing the tag jump (scroll, tint, nothing focused). Jazz's
  "a third from the top" and B20's bottom fade at 390 need one change in the jump's scroll position.
- **Linked from (Jazz §6):** a line link counts for the page its line is on **now** (the resolver), not the stored
  `pageId`. So `referencesTo` resolves line links and deduplicates per linking page as before. B15 times are unchanged
  (the time the link was made).
- **Trash:** a trashed target page gives the trashed chip. Restore needs nothing new.

## 6. Rollback

No layout bump and no script. Rolling back means deploying the previous build, as in finding 0.1: line links show as
page links to the page they were made on, and each page he edits in the old build drops their line part. **Rolling
forward again doesn't bring the line part back.** If that loss isn't acceptable, a small rollback script could hold
`lineId`/`taskId` per `refId`, as A9a did, at about +½ day. I don't recommend it for a link he can recreate in two
taps.

## 7. Checks before the candidate (copy of his data, 1280 and 390)

Jazz §7 checks 1–10, plus:
- a task moved to tomorrow with the row menu: the chip follows it (task identity);
- cut on Oct 18, paste on today: the chip follows it (§3), and the line is never on two pages after both saves;
- Bring to today of a linked line: the link stays on Oct 18's line;
- merge a linked line into the one above → "Line removed";
- pasting into a task title gives text (§1);
- an in-app URL pasted on an empty line becomes a line link, not a link card;
- the URL opened after the line moved lands on its new page;
- rollback: on a copy, the current build shows the links as page links with no errors;
- unit tests for `resolveLine` (each branch of §2) and for the Linked from move.

## 8. Size

**About one build round, smaller than A9a**: no format, migration or rollback script. Most of it is the resolver,
the chip, three entry points, the paste branch, the jump fallback and Linked from. The cut-and-paste ids (§3) is
the only part touching existing behaviour.

## 9. For review

- **Ratchet:** §3 (keeping ids on moves) and its by-id lookups; the resolver order (§2); Linked from following a
  move; the rollback trade-off (§6).
- **Jazz:** the task-title case (§1); Bring to today isn't a move (§0.2).
