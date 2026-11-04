# References and the parent in the header: Product's view

- Author: Bumblebee (Product) · 2026-11-04 · status: **independent view for the Lead's proposal**. Not approved, not built.
  Jazz owns the interaction and Roadbuster the cost; this covers what Notion does, what counts as a reference and where
  it stops.
- Brian's words (#daythread:6644e90e): "我想从 bookmark 里找到对应的 daythread，可以加一个引用的展示吗？你们想一下交互先。不要定制，
  应该是只要页面被引用就能看到，然后父页面应该在 header 上面有所体现"

## 1. Conclusion

**Both parts already exist. Together, two old rules hide the day on the way Brian most likely came in.**

1. `PageHeaderRow` shows the parents, but when a page is opened from the Bookmarks list (`from=bookmarks`) the crumb reads
   `Bookmarks` in place of them. That's my call in `bookmarks.md` §6, live since Nov 4 (#111).
2. `LinkedFrom` shows real references, but never the parent (`.filter(e => !e.isParent)`; the Lead's rule, 81ce1b0a,
   `pages-tree-layout.md` §3).

In the Nov 4 06:52Z snapshot, all 14 bookmarks sit under a day that holds their card, and for 13 of them that card is the
only reference. So opened from the list, 13 of 14 show no day anywhere. The list row names the day, but the whole row opens
the bookmark. Opened from the sidebar or a card, the crumb already shows the day and lands on the card.

**Which way Brian came in is an inference:** the list and the ask came on the same day, and we don't record which way a page was opened.

**Recommendation:** no new feature and no bookmark-specific code. The header always shows the real parents, however the page
was opened, and `from=bookmarks` stops replacing them. That removes something custom, which is what "不要定制" asks. Then fill
the two gaps in §3 so "只要页面被引用就能看到" holds for databases too.

## 2. What Notion does

| Topic | What it documents | Source |
| --- | --- | --- |
| What makes a backlink | "Backlinks are created automatically every time you @-mention a page." | [Links & backlinks][links] |
| All kinds | `page_mention` (text, title, caption), `link_to_page`, `property_mention`, `comment_mention`. Only pages the user can open | [MCP reference][mcp] |
| Where it sits | Above the title, on hover; or "`{#} backlinks`" under the title, or in the properties on a database page | [Links & backlinks][links] |
| Display choice | Expanded, Show in popover (a count), Off | [Intro to databases][dbs] |
| No backlinks | "nothing appears" | [Links & backlinks][links] |
| Breadcrumb | At the top, "what page you're in, and where that page lives". Every crumb opens, and long paths fold to "…" | [Subpage][sub], [Workspaces][ws] |

**Not documented, so not claimed:** whether a relation makes a backlink (`property_mention` is described only as a mention in
a property), and whether a subpage's parent is listed as a backlink. I haven't tried either in Notion.

**Where we'd knowingly differ:** we list the sources by name instead of a count. Hover doesn't exist at 390, and most pages
here have one to three sources.

## 3. What counts as a reference here

The rule stays "real references only, never text matching" (N-5). `referencesTo` covers the first rows; the gaps are mine to
raise, against Brian's "只要".

| Source | Today | View |
| --- | --- | --- |
| A card on a page, including a bookmark's | Counts | Keep |
| A `[[` link | Counts | Keep |
| A link to a line | Counts for the page the line is on now | Keep |
| A link inside a synced block | Counts once per place (B21-13) | Keep |
| A card or link in a row's body | Counts: a row is a page | Keep |
| The same URL saved on a second day | Counts: one page per URL, so the second card shows (1 of Brian's 14, a card on another day) | Keep |
| **A one-way relation** | **Doesn't count** | **Add.** Nothing on the target shows it today. The source is the row |
| **A linked view of a database** | **Doesn't count** | **Add,** on the database's page. Its home block is the parent, so that one isn't listed |
| A two-way relation, sub-item or dependency | Doesn't count | Leave. The target's own property already names it |
| Rollup or formula | Doesn't count | Leave. Worked out from a relation, not a reference |
| The same URL or title in plain text | Doesn't count | Leave. That's text matching |
| A tag, or a to-do carried to another day | Doesn't count | Leave. Not a reference to a page |
| The day template, a row template, an unaccepted day draft | Doesn't count | Leave. Not Brian's page yet |

Brian has no databases yet (0 at this snapshot), so the two additions change nothing on his screen today. They're in scope
because the ask is general (scope comes from all users, 57deaed7).

## 4. Where it stops

| Case | Behaviour | Status |
| --- | --- | --- |
| No references | No line at all | Built |
| A page's links to itself | Not listed | Built |
| Several links from one page | One entry | Built |
| A long list | First 3, then "N more" opens it in place, no ceiling | Built |
| A source in Trash | "Oct 15 (removed)", doesn't open | Built. **Change:** list these last, so they don't take the first 3 |
| A page in Trash | Its Trash view shows no line | Built, leave |
| Moved page | New parent in the header; the old parent shows as a source while its card remains | Built |
| A row in a peek | The line shows; the crumb doesn't, because the peek has no path | For Jazz |

**Deliberately not in this:** the line of text around each reference, a count-only display, the Off setting, reference lists in
Search or Export. Brian asked for none of them, and none is needed to get from a bookmark to its day.

## 5. The one choice to show Brian

**Should the parent also appear under "Linked from"?** I recommend no, and it's a reading of Brian's words, not something
Brian said: the sentence gives references one place and the parent another. Keeping it out means 13 of 14 bookmarks show the
day in the header and no reference line.

| | Parent in the header only (recommended) | Also under Linked from |
| --- | --- | --- |
| Literal "只要页面被引用" | The reference is visible, as the parent | Every card shows as a reference |
| A page made on a day (15 of Brian's 16 document pages) | One mention of the day | The same day twice, a few lines apart |
| Cost to change later | Remove one filter | Add it back |

Jazz's screens should show a bookmark both ways, so this is judged on the real page.

## 6. For Jazz and Roadbuster

- **Jazz:** how the way back to the list stays once the crumb shows the path, because the Home Screen app has no Back button
  (`bookmarks.md` §6). My suggestion is a `‹ Bookmarks` link ahead of the path, but the form is yours. Also how a sub-item's
  parent reads: its crumb is the database, and R4-5 already lists the parent's title in a group as open.
- **Roadbuster:** this may not be a Postgres question. `linkedFrom` runs in the browser over the workspace it already holds, on
  every render of a page's head, and nothing is stored. So the cost to measure is that scan with a 10,000-row database, plus
  reading relation values if they're added. An index only matters if that's too slow.

## 7. How we'll know

No usage record can show this, so these are checks, with Brian's word as the outcome.

1. From Bookmarks at 1280 and 390, any bookmark reaches its day in one tap, landing on the card, and the list is still one tap
   back.
2. From the sidebar, a card, Search and "In your days", the header shows the same path.
3. A bookmark saved on two days shows the first in the header and the second under Linked from.
4. A one-way relation and a linked view each show on their target. A two-way relation doesn't appear twice.
5. A page with no references has no line, and a source in Trash comes last and doesn't open.

[links]: https://www.notion.com/help/create-links-and-backlinks
[mcp]: https://developers.notion.com/guides/mcp/tools-search-reference
[dbs]: https://www.notion.com/help/intro-to-databases
[sub]: https://www.notion.com/help/create-a-subpage
[ws]: https://www.notion.com/help/intro-to-workspaces
