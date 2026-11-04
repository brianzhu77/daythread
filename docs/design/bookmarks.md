# Bookmarks: one list of every bookmark page

- Author: Bumblebee (Product) · 2026-11-04 · status: **built and live** (#111, 2026-11-04), row opens the page and ↗ opens the site (Lead 26e18f56). Task #295.
- Brian's note on the Nov 3 day page, as the Lead quoted it: "a bookmark entry for all of my bookmark pages, please think about the UX, we can
  do it with a page with special type of pages for bookmark, or a tag, or something else."
- Lead's recommendation: a Bookmarks entry in the sidebar listing every page with a `url`, newest first, with no new
  page type or tag.

## 1. Decision

Build the Lead's list, with no new type, tag or data migration. The Lead's version needs four changes, all from reading
the code and Brian's data:

1. **The phone needs its own way in**, because a sidebar entry doesn't exist there (§3).
2. **"Newest first" has no date to sort by.** Pages don't store when they were made (§5).
3. **A title alone doesn't say what the link is.** The row needs the quote too (§4).
4. **The way back has to return to the list.** Today it would land on the day (§6).

## 2. Why a list, and not the other two

Evidence: Nov 3 snapshot, rev 793. Brian has 14 bookmark pages, none in Trash, all under day pages from Oct 22 to Nov 1.
None has words Brian wrote: each holds at most the fetched quote and an empty line.

| Option | What it would take | Verdict |
| --- | --- | --- |
| **A list worked out from `url`** | One function, one screen, two entries. Nothing stored | **Yes.** All 14 appear on day one, and it can't drift from the pages |
| A special page type | Nothing new: a page with a `url` already is that type | Same thing. A new `type` would only add a migration |
| A tag | A tag on each page. Tags here belong to blocks, not pages | No. All 14 would need tagging, and a bookmark saved without one goes missing |
| A Bookmarks database | Pages move out of their day, or a new way to list them | Not now. It gives status and properties, which Brian didn't ask for. If asked, §9 |

**Notion appears to have no such list.** [Its Web Clipper help][clipper] has you pick a page or database for each clip,
with a new links database as one choice, and describes no list of everything saved. I found no official statement
either way about a list of bookmark blocks, so this is "not documented", not "confirmed absent". It's a place to do
better than Notion, because here a bookmark is already a page with a known URL.

**Nothing moves.** A bookmark stays under its day, with its card, in the tree and in "In your days". B44's answer to
"too much nesting" stands. The list is one more way to reach the page.

## 3. Where the entry is

| Width | Entry | Why |
| --- | --- | --- |
| Laptop | A `Bookmarks` row in the sidebar's main group, after Tags | With the other places Brian goes |
| Phone | A `Bookmarks · 14` row at the top of the Pages list, with the Trash row's look | The capsule has five tabs and the search button; a sixth is about 47 px wide at 390 |

- **Both show only once a bookmark exists,** as Trash does. A new account sees nothing it can't use yet.
- **Address:** `/pages?view=bookmarks`, as Trash and Templates are. On a phone the Pages tab stays current. In the
  sidebar, `Bookmarks` is current and `Pages` isn't, the rule Trash already has.
- Search is unchanged: it already finds a bookmark by title or URL.

Alternative: a sixth tab. It makes the list one tap away on a phone instead of two, at the cost of every other tab. Worth
revisiting only if Brian asks after using it.

## 4. The list

Title `Bookmarks`, newest first, no grouping, filter or sort control. A row:

```
🌐  DAN KOE (@thedankoe) on X                      ↗
    How to fix your entire life in 1 day
    x.com · Sat, Oct 25
```

- **Line 1, the title,** up to two lines. Never cut to one: at 390 a Chinese or long title is the row's identity.
- **Line 2, the page's first words,** one line (`pagePreview`), left out if the page has none. This isn't decoration: on
  5 of the 14, all from X, the title is only who posted it and the quote is the only place that says what it is. The
  card keeps to one line (A2), which is fine beside the writing around it and not in a list of 14.
- **Line 3:** the host, then where it was saved (`pageLabel` of its parent). The host follows the card's rule: left out
  while the title is still the default, which already reads as the URL.
- **↗** opens the website, with the card's icon and label, and a 44 px target at 390. It doesn't open the row.

**Four pages have a URL for a title** and no quote: 3 from Oct 22, before B43, and 1 from Oct 26, where it got nothing.
No backfill: it's a write to production data for 4 rows at most, and Brian can rename them.

## 5. Which pages, and in what order

- **Which:** `visiblePages(ws).filter(p => p.url)`, a new `bookmarkPages` beside it in `page-tree.ts`. That's the rule
  search uses: no Trash, templates or drafts. A row moved into a database (R4-10) with a `url` stays listed.
- **Not listed:** links kept with "Keep as link" (Brian has 4), URL properties, and `[[` links. Brian asked for bookmark
  pages, and those aren't pages with a URL.
- **Order:** `created_at` is empty on all 34 pages in the snapshot; only database rows set it. So:
  - **From this release,** `make-link-pages` sets `createdAt` when it makes a page, as a new row does.
  - **For pages without one,** the date of the nearest day above it, at the end of that day. All 14 have one.
  - **Same day or no date at all:** later position first, and pages with no date of either kind go last.
- A repeat paste keeps the original date, and so does a page restored by pasting its URL again.

## 6. Opening one

- **The row opens the Daythread page, ↗ opens the site.** One rule with the card, so nothing new to learn.
- **Evidence against this:** none of the 14 has words Brian wrote, and Brian said "I don't always want to go deeper".
  The site may be what Brian wants most of the time. I still recommend the page: ↗ costs no extra tap, and it's the only
  way to add a note. We have no record of which one gets tapped, so this needs Brian's word after some use (§8).
- **The way back is `Bookmarks`.** `PageHeaderRow` builds its crumb from the parents, so it says the day, and the Home
  Screen app has no Back button: a phone couldn't return to the list. Opened from this list, the address carries
  `from=bookmarks` and the crumb reads `Bookmarks` in place of the parents. Opened any other way, it's unchanged.
- **Returning** should keep the scroll position. The router's scroll restoration should cover it; the check in §8 says.
- **Trashing the open page** goes back to the list when it was opened from there, not to its day as it does today.

## 7. States

| State | What shows |
| --- | --- |
| Empty, reached by trashing the last one here or by an old address | `No bookmarks yet`, as `No tags yet`. No explanation |
| Page trashed, from anywhere | Gone from the list at once, and the entries go when none are left. It's in Trash, and its card stays "In trash" |
| Day trashed | Its bookmarks go with it, and come back with its Restore |
| Pasting the URL of a trashed page again | Restored by A2's rule, back in the list at its original date |
| A `from=bookmarks` address for a trashed page | The trashed page, as any address does today |
| Untitled (title cleared) | `displayPageTitle`, as everywhere |
| Offline | The saved list as the app has it. ↗ needs the network, as it does on a card |
| A link just pasted, title not fetched yet | Its default title, updating when the fetch lands |
| Another tab | Follows the workspace, as every list does |

**Not in this version:** Trash or other actions on a row, read and unread, tags, search inside the list, and cover
images. Trashing is on the page's own menu.

## 8. Checks and success

**To build:**

- Unit: `bookmarkPages` leaves out Trash, templates, drafts and pages with no URL, and the order in §5, mixing pages
  with and without a date. `make-link-pages` sets `createdAt`, and a repeat paste doesn't change it.
- Browser, 1280 and 390, both engines: the entry appears with the first bookmark and goes with the last. Row opens the
  page, and the crumb returns to the list at the same scroll. ↗ opens the site and doesn't open the row. Trash from the
  page returns to the list, then Undo. `from=bookmarks` doesn't change the line lookup in `page-editor.tsx`, which reads
  only `tags` and `search`. Both themes.
- A copy of Brian's data: all 14 listed, Nov 1 first, with the same 14 cards still on their days and no page changed.
- Rollback: an older build ignores `createdAt` on these pages and drops nothing. Nothing reads
  `createdAt` as meaning "this is a row": only database time properties and a row's own creation use it (Roadbuster
  107552c4, from searching `src`).

**Success, in order of what we can observe:**

1. Brian's word that it's what was meant. This is the one that counts; usage can't show a list being read.
2. Usage reads: new bookmark pages per week, against 14 in the 13 days from Oct 22 to Nov 3. If the list gives bookmarks
   a reason to exist, this should not fall. A fall with the list live would be a reason to ask.
3. Words Brian writes inside bookmark pages, 0 today. Still 0 after a month, plus Brian saying the page gets in the way,
   would turn §6 round: row opens the site, a smaller control opens the page.

## 9. What stays open

- **A status such as "to read".** Nothing in the note asks for it, though 14 saved pages with nothing written in them
  may mean a reading list. If Brian asks, the first step is a database, with this list as what fills it. Nothing here
  stands in the way of that.
- **Keep as link.** If Brian expects kept links here too, a way to turn one into a bookmark is better than listing them,
  because a kept link has no page to open. Not now.

[clipper]: https://www.notion.com/help/web-clipper
