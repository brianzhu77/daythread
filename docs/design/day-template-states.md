# Editable day template: states (B70)

- Author: Jazz (Design) · 2026-10-31 · status: **design states for the B70 build**, base main 0c5b0cf.
- Inputs: Brian `9df6febf` (let him edit the day template), Lead scope `ceb4ec80`, Roadbuster `4aeb63bd` `74b38f2a`
  `0f2f4460` `5109fe65`, Bumblebee `580345dc` `45c7dfc3` `852c1770` `981cfd3f`, Ratchet `c2ec12b5` `a97c07e4`, Lead decisions `0e9db2a4` and the 04:59Z reply (allowlist, no §5), Jazz
  `78595a54` `acb0381e`. Checklist row B70.
- **Evidence:** read from main's code only (`editor-document.ts`, `page-tree.ts`, `event-rows.tsx`, `account-row.tsx`,
  `pages-screen.tsx`). Nothing here has been run. Items marked **(decide)** need Lead's call; everything else follows
  the agreed scope.

## 1. Entry

| Where | What |
| --- | --- |
| **Account row** (sidebar foot at 1280, foot of Pages at 390) | A plain text link **Day template**, after the time zone and before Export: `{email} · {zone} · Day template · Export · …`. Same `link` style as Export. |
| **Opening it** | Opens like a document page (`/pages?page={templateId}`), so back and the Pages tab behave as for any page. At 1280 no sidebar row is highlighted. |
| **Never listed** | Not in Pages, "In your days", recent pages, the `[[` picker, the sidebar tree, search, Move to…, Tags, Calendar, Linked from, or the day picker. |
| **Export** | Included, as its own file labelled as the day template, not as a document (Bumblebee `981cfd3f`). |
| **Trash** | Can't be trashed, moved or renamed. "Reset to the original" is the only way back. |

## 2. The template page

```
Day template                                  ← large title, fixed (not editable), no ⋯ menu
New days start from this page, from Sun, Nov 2. Lines are copied empty.
Days that already exist stay as they are. · Reset to the original
                                              ← one grey meta line (--ink-2), under the title
## TODO
[ ]
## Events
•
…                                             ← the normal editor, his content
```

- **The grey line** is the agreed wording (Bumblebee `580345dc`, "Lines are copied empty" per Lead's B70 decision;
  in B70b it becomes "To-dos are copied empty", §6), plus the date it starts from: **the first day from
  today on that has no page yet.** It matters when tomorrow's page already exists (§5); then the line names the day after. Format as elsewhere: "tomorrow" when it's tomorrow
  ("New days start from this page, from tomorrow."), else "from Sun, Nov 2".
- **"Reset to the original"** is a text link after a middle dot on the same line. Shown only when his template differs
  from the built-in one; a workspace with no saved template (every invitee) doesn't show it.
- **No** Linked from, Subpages, page ⋯ menu, link URL row, or "first day" line.
- **Editor:** everything that works on a document page works here (headings, bullets, to-dos, nesting, `[[` links,
  `#tags`, `@date`), **except creating a page inside it** (`+ page`, "Turn into page"): a subpage would be copied into
  every day. Hide those two entries on this page; no message needed.
- **Page cards and link cards** can sit on the template (pasted), but **aren't copied** (Lead, allowlist): only
  headings, to-dos, bullets, numbered lines, quotes and plain text reach a new day. No paste is refused and no extra
  words are shown. In B70b the same allowlist applies.
- **To-do rows here are only rows.** Ticking, a title, a date chip: none of it creates or changes a task (scope point 2).
  The checkbox can still be ticked visually; it's copied unticked. **A real to-do pasted in** becomes a plain to-do row:
  the real task never changes (no task reconciliation on the template save, Ratchet `c2ec12b5`).

## 3. Reset

| Step | What shows |
| --- | --- |
| Tap **Reset to the original** | No confirm. The page becomes the built-in template (TODO, Events, Good Stuffs, Notes, one empty row each). Notice: **"Template reset · Undo"** (HeroUI toast, same as other edit notices). The Reset link disappears, since it now matches the original. |
| **Undo** | His previous template comes back as it was; the Reset link returns. |
| Notice closed | Ordinary page history applies, like any other edit. |

## 4. What a new day gets

`ensure-day` copies the template with fresh ids (B70, Lead's decision: **headings are copied, every other line is copied
empty and keeps its type**):

| Template content | On the new day (B70) | B70b (§6) |
| --- | --- | --- |
| Heading | Same heading. | Same. |
| Bullet, paragraph, nested lines | **Empty** line of the same type, at the same nesting. | Same words. |
| To-do row (with or without a title, ticked or not) | **Empty, unticked** to-do row; no task. Nesting kept. | Same as B70. |
| A line holding only a `[[` link or `@date` | Empty line of the same type. | Same link / words. |
| Page card, link card, anything off the allowlist | **Not copied.** | Not copied. |
| An empty template (he deleted everything) | An empty page with one empty line, like a document page. Carry goes to the end, as with no heading today. | Same. |

Since every copied line is empty in B70, main already treats it as unwritten: no change to dots, previews, search or B19.

**Where carried and Tomorrow to-dos go:** under the first heading that has a to-do row under it **in the template**;
if none has one, under the first heading (today's rule); if there's no heading, at the end of the page. Two sections
with to-do rows: the first one. Nothing explains this on screen.

**Fallbacks** (agreed): with no "Events" heading, events show at the page end under the app's own "Events" label
(main's behaviour, `event-rows.tsx:136`). "Bring to today" goes under the same-name heading, else Notes, else the page
end. Nothing ever recreates a heading he deleted.

## 5. Timing: days that already exist

- **Today and past days** never change.
- **Tomorrow may already exist** if he typed in the Tomorrow block before editing the template. In his data so far
  that hasn't happened (Bumblebee `daythread:b842c6d3` 04:59Z: every day page was made at his midnight; the block saved
  on 0 of 4 evenings), so an edit made during the day shows the next morning. The date in the grey line (§2) covers
  the rare case.
- **No "Use it for tomorrow too"** (Bumblebee, product): rebuilding a page he already wrote on is the riskiest part and
  the case hasn't occurred. Revisit if a usage read shows him editing after tomorrow's page exists.

## 6. B70b: copy the words; copied lines don't count as written

Ships after B70 with its own review (Lead). Until then the template's words stay on the template page only.

**Rule** (Roadbuster `5109fe65`; node props don't survive the editor's save, so no mark): **a line whose words exactly
match a line of the current template counts as empty.** Headings already don't count.

| Place | Rule |
| --- | --- |
| Day picker dot, sidebar Days, `writtenDays` | Doesn't count. A day with only template lines has no dot. |
| Calendar card / page preview line | Left out of the preview. |
| Search, Tags, backlinks (Linked from) | Not matched or listed. A `[[Weekly goals]]` line in the template adds no backlink per day. |
| Past days (B19 hides rows that were empty when the page opened) | Hidden the same way. |
| First-day line (`isBlankWorkspace`) | Doesn't count; and the template page itself is not "another page", so an invitee who edits the template first still sees the first-day line. |

When he rewords the line on a day ("Gym?" to "Gym ✓"), it's a normal line. **Known cost:** if he later rewords the
template, older days still holding the old words count as written. Acceptable: those days were his.
Grey line in B70b: "New days start from this page, from {date}. To-dos are copied empty. Days that already exist stay as
they are." Copying text that counts as written is never acceptable (Bumblebee `852c1770`).

## 7. Other states

| State | Behaviour |
| --- | --- |
| Template never saved | The page shows the built-in template. Saving the first edit creates the row. No Reset link. |
| Saving, failed save, offline | Same as any document page (existing save states and notices). No template-specific words. |
| Day created while the template edit is still unsaved | Uses the last saved template. No warning. |
| Template has only to-dos, no headings | New days are those empty to-do rows; carry goes after the last one. |
| Narrow screen (390) | The grey line wraps; "Reset to the original" may wrap to its own line, same style. Tap area 44 px tall, as other text links. |
| Dark mode | Grey line `--ink-2`, link as other text links. No new tokens. |

## 8. Out of scope

To-dos that repeat every day (clash with carry: yesterday's unticked copy + today's copy = two); a template per
weekday; sharing a template with an invitee; a "what changed" view of the template.

## 9. Checks for review (adds to Ratchet's list in B70)

1. The grey line names tomorrow's date when tomorrow has no page, and the day after when the Tomorrow block already
   made tomorrow's page.
2. B70: a template with "Gym?" under Notes gives the next new day an empty bullet under Notes, with no dot.
   B70b: the day shows "Gym?", has no dot, no Calendar preview, no search hit or backlink; editing it to "Gym ✓" gives
   the dot.
3. The template page never appears in Pages, recent pages, the `[[` picker, search, Move to…, Tags or the sidebar tree;
   it has no `+ page`, can't be trashed, and is in the export as the template.
4. An invitee (no saved template) opening Day template sees the built-in one with no Reset link, and their first-day
   line still shows after they edit it.
5. Reset then Undo restores the exact previous template.
6. 390 and 1280, light and dark: the grey line sits under the title on the text column, as the first-day line does.
