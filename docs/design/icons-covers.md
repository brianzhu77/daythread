# Page icons and covers: design

- Author: Bumblebee (Product) · 2026-11-03, §7 and §8 by Jazz (Design) · 2026-11-05 · status: **for Lead and Ratchet to review**. Not approved and not built.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's guide on [page icons and covers](https://www.notion.com/ja/help/guides/page-icons-and-covers), read through search results rather than in full. It gives: an emoji, a native icon or an uploaded image; a cover by upload, image link or Notion's gallery, with Unsplash; icons showing in the sidebar and wherever the page is mentioned. I found nothing on a row's icon in a table, so that's my proposal.
- **Read directly 2026-11-05 ([English guide](https://www.notion.com/help/guides/page-icons-and-covers), through a fetch and summary):** an icon is added by clicking the default image beside the title, from emoji or an icon set, with a **Random** button, or by uploading. A cover is added inside the page by "Add cover", then "Change cover": Gallery, upload, an image link, Unsplash, or Notion AI from a prompt. It doesn't give sizes, Reposition, or where icons show beyond the title. **New here:** Random is small, and I'd take it with the emoji picker. A cover from a prompt would mean paying a model to make pictures, so it's Not planned (Lead 3f167c20). R3-11's Files is live, so uploads are no longer waiting on it.
- **A tension to name:** his look is black, white and grey (Brian 116a40ab), and these add colour **only where he chooses to,** so I think they fit. No page gets one by default. These were added to §14 by me from Notion research, not asked for by Brian. Under 57deaed7 they stay in scope. **First in §14's order since 2026-11-05 (Lead d34dd413),** because they're on pages, which is where Brian works.

## 1. What he sees

- **Adding:** the page's `⋯` has **Add icon** and **Add cover**. Notion shows these on hover above the title, which doesn't exist on a phone and adds clutter at 1280.
- **An icon:** above the title on a page, at the title's left edge. It replaces our default page icon in the sidebar, Pages, `[[` links, page cards, search results and Trash. A tap on it opens the picker, with Remove.
- **A cover:** full width above the title, at a height Jazz sets, kept short on a phone so that the title and first lines stay in view without scrolling. At 1280, hover shows Change and Reposition; at 390, the `⋯` menu has them.
- **A database and its rows:** an icon replaces the grid icon. A row's icon shows before its Name in every layout. A Gallery gets "Card image: Cover" as a choice (R3-3 said this would come with Files).

## 2. Sources

| Source | Needs | When |
| --- | --- | --- |
| **Emoji** | Nothing stored but the character. A picker, with search in English and Chinese | First. No infrastructure |
| **Image link** (cover or icon) | A pasted URL. Stored as a link, not a copy, like images in a body (R3-3): it may vanish | First. A failed one keeps its place as a plain band with no broken-image mark, and the words stay where they are (§7.6) |
| **Upload** | Files (R3-11), the same store and limits. Icons small, covers wide | After R3-11 |
| **Gallery of covers** | Images we'd host, or ones we pick | With upload. A small set of plain greys and textures suits his look, at no real cost |
| **Unsplash** | Its API, with a key and required attribution | **In scope and last (Lead 4a1712e6).** A new outside service that would see what Brian searches, so at the front of the queue it goes to Brian as one choice. Its terms must be checked by then: not checked yet, and no running cost that I know of |
| **Our own icon set** ("native icons") | A set in our greys, with SVG | Second. Small and in keeping with his look |

## 3. Rules

- **His days don't change** unless he adds one. **A day page's cover pushes his day down,** and that's his main screen. It's allowed if he does it. If set on the Day template, each new day gets it, like the template's blocks; R2-6's and R2-7's bars then apply.
- **Titles stay words.** An icon isn't part of the title, so search, `[[`, export filenames and the day draft are unaffected.
- **Undo** works on adding, changing and removing, with the usual notice.
- **Copying:** Duplicate row copies them. A template row's icon and cover go to rows made from it (R3-12).
- **Export:** an icon's emoji is written before the page's heading. A cover link is written as an image at the top. Uploads follow R3-11's rule for files.
- **Another account can never read an upload** (R3-11). A pasted link is fetched by his browser with `no-referrer`, as Gallery's cards are. The server fetches nothing.
- **Offline:** an emoji always shows. A cover that can't load keeps its place, as §7.6 settles.

## 4. For Roadbuster and Jazz

**Roadbuster's read of the code, nothing run (5beabee0):** new columns are safe: `writeDiff` updates only the columns a build knows, so an older build's save leaves `icon` and `cover` alone. Add them through `addedPageColumns`, and both `pageOf` and `rowOf` need them or they vanish on the next save. **Accepted limit:** an older build hard-deleting a page and restoring it through Undo rewrites the row without them, which is rare and only during a rollback. A cover link is capped at 2,000 characters. A list response only carries changed pages, so only the first load pays. The sweep holds an uploaded cover or icon automatically, since `heldText` is the whole workspace, which needs a test and no code. Measure the emoji data first, as that decides whether it needs its own file.

- **Storage:** optional `icon` and `cover` on a page, plus cover position. Likely new columns, added the way `week_start` was: additive, and an old build ignores them and leaves them alone. Please confirm the old build's saves keep them, with a rollback run.
- **Sync:** they should arrive with page lists, because they show in the sidebar. Check the cost of adding them to every page in a list: a long URL on many pages adds up.
- **Bundle:** the emoji picker's data is large. Load it only when opened, and check iOS's newest emoji draw on his phone.
- **Jazz:** icon size and alignment in each place (sidebar, `[[` links, a row's Name), with `check-alignment.mjs` measuring the title's edge with an icon. Cover heights at both widths.

## 5. Release order, within this

1. Emoji icons, everywhere a page's name shows.
2. Covers from an image link, with Reposition, plus Gallery's "Card image: Cover".
3. Our own icons and uploads after R3-11, with a small set of covers.
4. Unsplash, if the Lead agrees.

## 6. Checks before release

- A page with no icon or cover looks exactly as today, pixel for pixel, on a copy of his real data (R1-18).
- An emoji lines up with the title and in the sidebar, `[[` links and a row's Name at both widths, with the alignment gate on.
- The picker at 390 in the Home Screen app: keyboard comes up only for search, Pinyin works.
- A dead image link: no broken-image mark, and nothing moves once it fails (§7.6). The panel's check loads the picture the same way the band does, with `no-referrer`, so a picture that passes in the panel can't fail on the page for that reason.
- An older tab keeps both, with a rollback run.

## 7. How it looks and behaves (Jazz, 2026-11-05)

**Evidence:** sketches drawn over the real app in Chromium at 1280 and 390, with a test emoji and a gradient for the cover, to try the sizes. Nothing here is built or tried on a phone. Sizes below are my judgement, and the alignment gate should hold them once it's built.

### 7.1 The head

From the top: **cover, then the line with the breadcrumb and `⋯`, then the icon, then the title.** Nothing sits on top of a picture, so nothing depends on its colours.

| | 1280 | 390 |
| --- | --- | --- |
| **Icon** | 44 px, on a line 52 px tall, 2 px above the title | 36 px, on a line 44 px tall |
| **Its left edge** | The title's edge, by eye: an emoji has a little space of its own, so 2 px back | The same |
| **Cover** | 200 px, whatever the window's height, from the sidebar's edge to the window's | 120 px, edge to edge |
| **First line of the body, with both** | About 365 px down | About 280 px down, with the title and first lines above the toolbar |

- **No icon and no cover:** nothing is drawn or held, so the page is as today (P1-1).
- **A side peek** has a 120 px cover, and a center peek 160 px, each the peek's own width, under the peek's own top bar.
- **A row's page and a database's full page** have the same head.
- **A template** has the same head, and it's what new rows or days get.

### 7.2 A day

The cover goes above the head and the icon above "Today" and the date, at the title's left edge, with the arrows where they are. **A day has its `⋯` only once it holds something** (`dayMenuGroups`), so an empty day needs one for these. Added to the Day template, every new day has them (P1-6). At 390 with a cover, the day's first section starts about 120 px lower. That's his choice, and worth stating in the budget.

**Proposed (Bumblebee, for the Lead): an empty day doesn't get a `⋯` for this.** A `⋯` on an empty day would change that screen for everyone, against P1-1's "exactly as today", to offer something nobody has asked for there. A day made from the template holds something, so it has its `⋯` already, and the template itself takes them. The cost: a day with nothing written can't take a cover until it has a line.

### 7.3 Where an icon shows

It takes the place of the page's default icon where there is one, and comes before the name where there isn't. It never shrinks when a name is cut short, and the name's first line stays where it was against its row.

| Place | Icon text size | Takes the place of |
| --- | --- | --- |
| Sidebar, Pages | 14 px in the 16 px box | The grey page or grid icon. The row's text doesn't move |
| Page card | 15 px in its 18 px box | The grey icon |
| `[[` link on its chip, a relation's chip | The chip's own text size | The chip's icon, where it has one |
| Search, Trash, Linked from, the breadcrumb, Move to's list | The row's text size | The icon, or before the name |
| A database block's title | 17 px, 6 px before the title | Before the title. A linked view shows the source's |
| A row's Name in a table, list, or the Timeline's table and bars | 14 px, 6 px before the name. On a wrapped name, the lines hang after it | Before the name. A tap still opens the row, not the picker |
| Board and Gallery cards | 14 px, before the title | Before the title |
| Calendar's chips, the phone's Timeline list | The line's text size | Before the title |

To-dos have no icon: a to-do isn't a page. **A day in the sidebar's Days** shows its icon before its date, if it has one.

### 7.4 The picker

**At 1280:** a panel 352 px wide under the icon, or under `⋯` when there's no icon yet. **At 390:** a sheet about 60% of the screen, with the phone's toolbar hidden while it's open, and rising above the keyboard. One release at a time, more kinds join as tabs: Emoji first, then Icons, Upload and Link.

- **Top line:** Search, Random, and Remove when there's an icon. At 1280 Search has the caret. **At 390 it doesn't until tapped,** so the keyboard stays down (P1-2).
- **The grid:** 8 across, 36 px squares at 1280 and 44 px at 390. Recent first, on this device, up to two rows, and no Recent line until there's one. Then the usual groups, with their names as you scroll.
- **Picking** closes it, with the usual notice and Undo. **Random** picks one and stays open, so it can be pressed again. **Remove** closes it. Each is one change with its Undo, as P1-7 says.
- **Skin tones:** a small swatch at the right of Recent's line, kept on this device, as Notion has one and a person's hands shouldn't only be yellow. Not in Notion's guide as I read it, so this is my call.
- **Search** covers English and Chinese names. While Pinyin is composing nothing's searched, so results follow the characters once chosen. **Typing or pasting an emoji** offers it as the one result, so nothing a phone can type is out of reach.
- **Nothing found:** "No emoji for {what's typed}".
- **Loading,** since the data loads when opened: the panel at its full size with a plain grey grid, so nothing jumps. **It can't load, or offline:** "Can't load emoji · Try again", and the search still takes a typed emoji.
- **Keys at 1280:** arrows move in the grid, Enter picks and Esc closes, back to where it was opened from.

### 7.5 A cover

- **Adding:** `⋯` → Add cover opens a small panel. In the first release it's one field, "Paste an image link". The picture shows in the panel once it loads, and Add is only there then. **A link that doesn't load says "Can't load that image" and isn't saved,** so a dead link can't be added by mistake.
- **Changing:** hovering at 1280 shows Change and Reposition at its lower right, on a plain backing. At 390 `⋯` has Change cover, Reposition and Remove cover. Change opens the same panel, with Remove.
- **Reposition:** the picture moves up and down under the pointer or finger, with "Drag to move · Done · Cancel" on it. Esc cancels. Done is one change with one Undo. It's saved as a share of the picture's height, so it holds at both widths. A picture with nothing to spare in height doesn't offer it.
- **While loading:** the band at its full height in `--fill`, so nothing moves.

### 7.6 A cover that won't load

**Settled (Bumblebee, 2026-11-05): it keeps its place, as Jazz recommends below.** It's state, which the minimal look allows, and a page that jumps 200 px under someone reading is the worse failure. The cost is a grey band on every open until it's changed or removed, which is why Change and Remove stay reachable.

§3 says it "leaves no gap", and P1-4 and §6 say "nothing moves once it fails". **Both can't hold,** since the band holds its place while it loads.

**I recommend it keeps its place:** the band stays in `--fill`, with "Can't load this cover" in small grey words, or "Offline", and Change and Remove reachable as usual. There's no broken-image mark. The words on the page don't jump a second after he starts reading, and he can see why the cover's gone. **The other way:** the band closes when it fails, which leaves no sign but moves every word up 200 px while he's reading.

### 7.7 Contracts before building (Ratchet f18d4910, a review of the document and sketches)

- **The preview belongs to the current link.** Load A, change to B before A finishes, then A succeeds: Add stays unavailable until B loads. Closing the panel or removing cancels late replies. The existing cover stays until its replacement is committed. Having loaded once checks that preview, and doesn't promise the link will stay alive.
- **Reposition's rule.** Stored as a normalized position within the vertical travel the crop allows, not as a share of the picture's height (this replaces §7.5's wording). Tested with one portrait and one wide picture across a full page, center peek and side peek. Cancel or Esc restores the exact earlier position with no command, and Done makes one Undo. Arrow keys move it while the mode is open, so there's a keyboard way.
- **Icon and cover edits live alongside typing.** Rapid Random presses, a failed icon save, and changing or removing a cover while the body is saving keep both the newest choice and the words. A refused or failed change shows a state, and an older reply never replaces a newer choice. Tested with a held save and a late Undo, as well as an ordinary pick and Undo.
- **The 390 picker sketch** still shows the editor toolbar. §7.4's written rule, toolbar hidden, is the target.

## 8. Later releases, as far as the design goes

- **Upload (P1-5)** uses the states in `body-files.md` §4 on the band or the icon: a progress track, "Not uploaded · Retry", "Too large · 25 MB at most". An uploaded icon draws in the same box as an emoji, with its corners slightly rounded.
- **Our own icons** are a tab in the picker, in `--ink-2`.
- **Unsplash** is a tab in Change, with the credit its terms ask for.
