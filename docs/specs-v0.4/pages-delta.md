# Pages delta · free nested pages and link pages — v0.4 draft

- Owner: Bumblebee · Reviewer: Ratchet · Page-model cross-check: Wheeljack (task #23) · 2026-10-16
- Status: **approved by Ratchet (task #25) at `abad1798`; status line updated only. Spec completeness only.** Nothing here is built or tested. It amends v0.3
  (commit `41146f0`) and `docs/specs-v0.3/ADDENDUM-good-stuffs.md` (`34350822`). Where this
  file and those disagree on pages or saved material, this file wins once approved; task
  identity, placements, carry-over, the hand-off and "Not today" (00 D05–D07) are unchanged.
- Field names and storage are authoritative in 02 (Wheeljack). This file states product rules.
- Tags: **[Brian]** said by Brian · **[Design]** our proposal · **[Hypothesis]** to be checked in use.

## 1. What Brian asked for

> "先做第一种，但第二种也基本上是符合的。我们需要支持任意页面嵌套。……比如我贴一个URL过来，
> 应该新建一个页面（后面可以做自动抓取，现在就先建一个空页面，把链接作为属性带进来，我可以手动
> 抓取），然后链接回 today's thread。这个应该就需要类似 notion 的自由页面支持"
> — Brian, #daythread:8d0ab5da msg `3596b765`

Read as requirements:

1. **[Brian]** Pages nest to any depth.
2. **[Brian]** Pasting a URL creates a new, empty page with the URL as a property. No fetching
   yet; Brian fills it in by hand.
3. **[Brian]** That page links back to the day it came from, and the day links to it.
4. **[Brian]** Order: the Craft-style day page first (option 1), then this.

Not asked for, and out of scope here: databases or table views, arbitrary property types,
sharing, templates, Notion import.

## 2. Gap in v0.3

- Pages are flat: a daily page or a document page, with no parent (02 Page).
- A saved link is a **Material** record with an optional body, separate from Page (02 §131,
  `src/domain/types.ts` `Material`). It is listed in Pages but is not a page you nest, move or
  write in like any other page.
- There is a "reference relations" query (04 P13), but no "Linked from" view (00 REF deferred it).

## 3. Rules

### N-1 One kind of thing: pages [Design]

- **A saved link is a page with a URL property** ("link page"). The separate Material entity
  goes away as a product concept; everything 02 keeps on Material (URL, sources, follow-up
  state, Don't resurface, decision log) becomes page properties of a link page.
- Page kinds stay **daily** and **document**. A link page is a document page that has a URL.
  Removing the URL turns it into a plain document page (with Undo); it then leaves the
  follow-up step and "Related" (N-6).
- Tasks and events keep their own identity (00 D02). A page never owns a task: deleting or
  moving a page never changes a task's state (04 P07 extended to subtrees, N-4).

### N-2 Nesting [Brian, details Design]

- Every page except a daily page has **one parent or none** (top level). Depth is unlimited.
- **Daily pages** sit in a fixed "Days" group, ordered by date. They can't be moved, can't be
  nested under another page, and the one-per-date rule is unchanged (04 P12). They **can** have
  child pages that Brian creates in them.
- The tree is owned by the page itself (its parent), not by blocks in the parent's body:
  - "New subpage" (`/page`, or + in the sidebar) creates a child and, if done inside the body,
    inserts a **page card** at the cursor.
  - A page card is a reference. Deleting, cutting or bulk-deleting a page card removes only the
    card. The child page stays where it is in the tree (same principle as 00 D05: ordinary
    text edits change presentation, not state).
  - Each page ends with a **Subpages** list showing all children, so a child without a card is
    never invisible.
- **Move:** drag in the sidebar tree, or ⋯ → Move to… (search). A page can't move into itself or
  its own descendants. Moving keeps the page ID, so every reference and "Linked from" entry stays
  valid. Moving applies on tap with Undo.
- Sibling order is manual (drag); new children go to the end.

### N-3 Pasting a URL [Brian, details Design]

Keeps the spirit of 00 D12 ("where something is entered decides what it is"), with "saved
material" now meaning "link page". One change: a URL pasted on its own line now creates a page in
any section, not only in Good Stuffs (Lead default, msg `310152ce`, matching Brian's request).
Typing a URL inside a sentence never does:

| Where the URL is entered | Result |
| --- | --- |
| Good Stuffs section (material role) | Link page created at once; the line becomes a link card. |
| Capture bar, URL only or "save this: <url>" | Link page created at once; the card goes where the capture lands. |
| A URL pasted as a block of its own (nothing else on the line), in any page or section other than a task row | Link page created at once, as for Good Stuffs. This is Brian's "我贴一个URL过来" case. |
| A URL inside a line of text | Stays a link, with an inline **Make page** action (replaces v0.3 "Save on a Notes link"). |
| A task row | Stays the task's link. Never becomes a page (D12 unchanged). |
| Pages → New link page | Link page at top level. |

- **The new page:** title defaults to the URL text and is editable; we do not fetch the page title
  in v0.4. URL is a property shown at the top with an Open button. The body is empty. Content
  state is "not collected" until Brian writes or pastes something (03 X25 unchanged).
- **Where it lives:** top level by default, **not** under today's page. Daily pages are made every
  day; saved links outlive the day, and nesting them under dates makes them hard to find. The
  link to the day is kept by the card and by "Linked from" (N-5). **[Hypothesis]** Watch whether
  Brian moves many new link pages by hand; if he does, add a default parent setting.
- **Where Brian pasted:** a **link card** (title, domain, Open). Brian's own words on that line
  stay his note for that save (04 P14).
- Every create shows a notice with **Undo**. Undo removes the page only if nothing else references
  it yet and Brian hasn't written in it.

### N-4 Same URL, one page [Design, from 04 P14]

- Pasting a URL that an existing link page already has **does not create a page**. It inserts a
  card to the existing page and shows "Saved before · Tue · Open". Each paste keeps its own line
  and note; nothing is merged or overwritten.
- If that page is in the trash, the paste **restores it** in its old place (or top level if the
  old parent is gone too) and says so. No second page with the same URL.
- If the page is **Done with it**, it moves back to **To sort** (Addendum G-1, unchanged).
- **Same URL** is decided by a dedup key. The raw URL as entered is stored separately and is
  what the page shows. Key rules: trim surrounding spaces; lower-case the scheme and host; drop
  the default port (`:80` for http, `:443` for https); an empty path becomes `/`. Path, query
  (including parameter order) and fragment are kept exactly as typed. No removal of tracking
  parameters, no redirect following (02 §133).

  | Entered | Key | Same page as row 1? |
  | --- | --- | --- |
  | `https://CalmTech.com` | `https://calmtech.com/` | — |
  | ` https://calmtech.com:443/ ` | `https://calmtech.com/` | Yes |
  | `http://calmtech.com/` | `http://calmtech.com/` | No (scheme differs) |
  | `https://calmtech.com/Book` | `https://calmtech.com/Book` | No (path case kept) |
  | `https://x.com/a?b=1&c=2` vs `https://x.com/a?c=2&b=1` | kept as typed | No (query order kept) |
  | `https://x.com/a#intro` vs `https://x.com/a` | kept as typed | No (fragment kept) |
  | `https://x.com/a?utm_source=n` vs `https://x.com/a` | kept as typed | No (no tracking cleanup) |

- **A key belongs to the one page that currently has it**, whether that page is live or in the
  trash. Two pages never share a key, including when two saves of the same URL arrive at once.
- Editing a link page's URL to a key another page holds is blocked with "Already saved as
  <title> · Open". Pages are never merged automatically.
- **Undo of a URL change or removal** is checked against the current owner. If another page has
  taken the old key in the meantime, Undo is refused with "Now saved as <title> · Open"; both
  pages and their bodies stay as they are.
- **Adding a URL back to a plain page** (by Undo or by typing it) restores that page's own earlier
  follow-up state and decision history if it had any. History is never silently reset.

### N-5 "Linked from" [Brian: "链接回 today's thread"]

- Every page shows **Linked from** under its title: the pages that actually reference it (cards,
  `[[` references, subpage cards), newest first, daily pages shown as their date ("Fri Oct 16").
  Same relation as 04 P13: real references only, never text matching.
- Each entry opens that page at the top. We still don't promise to land on the exact line (00 REF).
- A link page also lists its **saves**: date and Brian's note from each pasted line (the old
  Material `sources`), so the "why I saved this" text is visible on the page.
- **Live references and saves are separate records.** "Linked from" lists live references only;
  one entry per referencing page, however many cards it has. Saves are history.
  - Deleting a card removes that live reference. If it was the page's last card on that day,
    the day leaves "Linked from". The save it came from stays in the saves list, marked
    "line removed".
  - Trashing the referencing page shows its entry as "(removed)". Restoring it brings back only
    references whose cards still exist on it.
  - Moving either page changes neither record.
- The parent is shown as a breadcrumb, not as a "Linked from" entry.

### N-6 Good Stuffs follow-up and "Related" become per page [Design]

- Follow-up states (Addendum G-1: To sort, Keep watching, Lower priority, Done with it, Made into
  a task) and **Don't resurface** are properties of **link pages only**. Plain document pages are
  never put in the sort step or "Related" in v0.4.
- The sort step (G-2) and "Related" (00 D15) select link pages instead of Material records.
  Rules, caps and measures don't change.
- The sort card shows title, domain, the first save's date and note, and the first lines of the
  body if Brian has written any. "Open" opens the page.
- **Make it a task**: the new task's source link is the link page (G-1 unchanged in meaning).
- Moving a link page anywhere in the tree doesn't change its follow-up state or eligibility.
  Deleting it removes it from the step and "Related"; restoring brings back its prior state.

### N-7 Delete and restore [Design]

- Deleting a page (⋯ → Delete) moves it **and its whole subtree** to the trash in one step. The
  notice gives the count: "Moved to trash · 3 subpages · Undo". Everything is recoverable, so
  there's no confirm dialog (Lead ruling, msg `a016ab7a`, replacing the spike's "refuse to delete
  a non-empty parent").
- Restore brings back exactly the set removed by that delete, as one atomic command, in its old
  shape. If the old parent no longer exists or is in the trash, the restored page goes to top
  level and says so. Pages deleted separately earlier are not pulled back with it.
- Tasks referenced inside deleted pages keep their state and stay findable (04 P07). Plan rows
  live only on daily pages; deleting a daily page follows 04 P12, now with its child pages.
- **Deleting a daily page doesn't change what the day's plan feeds into.** Its placements still
  count: yesterday's open planned tasks still appear, all of them, in this morning's hand-off,
  not as capped "Continue?" items. Each task opens on its own, and its source shows "(removed)".
  The deleted page's prose (Notes, Good Stuffs lines) isn't offered for "Bring to today" or
  shown as live content. Restoring the page doesn't duplicate tasks or placements.
- A page restored on its own stays where it was restored. If the delete that originally
  included it is restored later, that page isn't moved or duplicated.
- No permanent delete in v0.4 UI.

### N-8 AI context [Design, for 03 owner]

- Today's linked context (00 U02, 03 X22) also includes the **direct child pages of today's
  daily page** as extra starting points. From every starting point (today's page and its
  direct children), the existing 03 E1 / X22 expansion applies unchanged: explicit outgoing
  references are followed transitively, each page sent once, cycles cut, trashed pages reported
  as removed, no backlink crawl, same budget checks.
- A link page with no body is sent as title + URL + Brian's save notes, marked "content not
  collected" (X25 unchanged).
- A grandchild, ancestor or sibling is sent only if something sent links to it explicitly.
  Being in the tree alone never adds a page (agrees with the spike).

### N-9 Layout [for Jazz]

- **Desktop:** sidebar tree — Today, Days (collapsed by month), then top-level pages with
  expandable children. Breadcrumb on every non-daily page.
- **iPhone:** Pages screen shows top level; tapping a row opens the page, whose Subpages list is
  the way down; breadcrumb is the way up. No drag tree on iPhone in v0.4; Move to… covers it.
- Page cards and link cards follow the Craft-style card in Jazz's direction (task #22).

## 4. First version vs later

**v0.4 first version:** N-1 to N-9.

**Later, not promised:** automatic fetching of title/content; a default parent for link pages;
landing on the exact referencing line; block-level references; other property types, tables or
databases; templates; Notion import; permanent delete.

## 5. Acceptance cases (to be folded into 04)

| ID | Setup / action | Expected |
| --- | --- | --- |
| N01 | Paste a URL into today's Good Stuffs | One link page at top level with the URL property and an empty body; the line becomes a card; the page's Linked from shows today. Undo removes it. |
| N02 | Capture "save this: <url>" on iPhone | Same as N01; the card goes where the capture lands. |
| N03 | In Notes: (a) paste a URL on an empty line; (b) type a sentence containing a URL, then tap Make page | (a) Link page created at once, as N01. (b) No page until Make page; then as N01. |
| N04 | Paste a URL into a task row | No page. The link stays the task's. |
| N05 | Paste the same URL on two days with different notes | One page. Two cards, two saves each with its own note; Linked from lists both days. |
| N06 | Paste the URL of a link page that is in the trash | The page is restored (old place, or top level if the parent is gone), with a notice. No new page. |
| N07 | Paste the URL of a Done with it page | Same page; state becomes To sort (Addendum G05). |
| N08 | Create A > B > C; try to move A into C | Blocked. |
| N09 | Move C to top level, then open the day page that referenced C | The reference still opens C; C's Linked from is unchanged. |
| N10 | Delete B's page card from A's body (single, cut, and bulk) | B stays A's child and is listed in A's Subpages. No page deleted. |
| N11 | Delete A (has B and C); a task row referenced in C | Trash notice "2 subpages"; the task's state, placement and carry-over are unchanged. Restore A brings back A > B > C. |
| N12 | Restore C while A is still in the trash | C goes to top level, with a notice. |
| N13 | Link page in Keep watching moved under another page | Still returns in the sort step on its date. |
| N14 | Remove the URL from a link page | It becomes a plain page; leaves the sort step and Related; Undo restores the URL and state. |
| N15 | Today has child A; A links B; B links C; A has an unlinked child D; E links to A (backlink only) | Sent: Today, A, B, C, each once. Not sent: D, E. |
| N16 | Move or delete any page | No change to hand-off, Still open N, Not today, or Top 3 (00 D05–D07). |
| N17 | Yesterday's page has 5 open planned tasks and a child page; delete yesterday's page; open today | All 5 are in the hand-off (uncapped), each opens on its own with source "(removed)"; yesterday's prose isn't offered for Bring to today. Restore yesterday: no duplicate task, placement or hand-off row. |
| N18 | Page A clears URL U; page B is then created for U; Undo on A. Repeat with A changing U→V | Undo refused with "Now saved as B · Open" in both cases; A and B unchanged. |
| N19 | Two saves of the same new URL arrive at once (two devices) | One page, two saves. |
| N20 | Plain page P once had URL U with Keep watching; U is added back to P | P is a link page again with Keep watching and its earlier decision log. |
| N21 | One day has two cards to link page L, each from its own save; delete one card; trash the day, then restore it | Linked from shows that day once throughout (as "(removed)" while trashed). Both saves remain in L's saves, one marked "line removed". After restore, only the remaining card's reference is live. |
| N22 | Delete A > B > C; restore C alone; then restore the A delete | A and B return; C stays where it was restored and isn't duplicated or moved. |
| N23 | Save a URL; the same request is replayed; then Undo | One page, one card, one save. Undo removes the card and save; it removes the page only if it's unedited and unreferenced, and never removes a page that was reused. |
| N24 | Migrate a store with a Done material, a Lower priority material with a skip date, a task-converted material, a Don't resurface material, and two sources with different notes | Each becomes one link page keeping state, dates, task link, opt-out and both notes; old material IDs resolve. A malformed or cyclic store is rejected and left as it was. |

## 6. Measures for the trial

- Link pages created per day, and the share made from Good Stuffs vs Make page vs capture.
- Duplicate link pages for the same URL: **must be 0**.
- Task state changes caused by page move/delete: **must be 0**.
- Share of new link pages Brian moves by hand within 7 days (N-3 hypothesis; above 50% means we
  add a default parent).
- Share of link pages Brian writes in (signals whether the "fill in by hand" step is used or needs
  fetching).

## 7. Follow-ups by owner

- **Wheeljack (task #23, 02):** Page `parent_id`, sibling order, cycle check on move; Material
  folded into Page properties (URL unique per workspace among non-deleted *and* trashed pages,
  sources, follow-up fields); subtree soft-delete/restore; Linked from query; migration of
  existing Material records 1:1 to link pages, keeping IDs or a mapping so cards and decision
  logs still resolve. Please flag any rule here that the editor choice makes expensive.
- **Jazz (task #22):** page card, link card, sidebar tree, breadcrumb, Subpages list, iPhone
  drill-down (static drafts this round).
- **Ratchet:** review this file; focus per Lead on URL identity, move/delete effects on day page
  references, and the task/hand-off/Not today boundary (N16, N17). Round 1 findings
  (`docs/reviews/v0.4/ratchet-pages.md`) are folded into N-4, N-5, N-7, N-8 and N15–N24.
- **03 owner:** N-8.
- **Bumblebee:** fold into 00/01/04 after approval; update the Addendum's wording from
  "material item" to "link page".
