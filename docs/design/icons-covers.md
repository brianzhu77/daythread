# Page icons and covers: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's guide on [page icons and covers](https://www.notion.com/ja/help/guides/page-icons-and-covers), read through search results rather than in full. It gives: an emoji, a native icon or an uploaded image; a cover by upload, image link or Notion's gallery, with Unsplash; icons showing in the sidebar and wherever the page is mentioned. I found nothing on a row's icon in a table, so that's my proposal.
- **A tension to name:** his look is black, white and grey (Brian 116a40ab), and these add colour **only where he chooses to,** so I think they fit. No page gets one by default. These were added to §14 by me from Notion research, not asked for by him. Under 57deaed7 they stay in scope, last in the order unless his use says otherwise.

## 1. What he sees

- **Adding:** the page's `⋯` has **Add icon** and **Add cover**. Notion shows these on hover above the title, which doesn't exist on a phone and adds clutter at 1280.
- **An icon:** above the title on a page, at the title's left edge. It replaces our default page icon in the sidebar, Pages, `[[` links, page cards, search results and Trash. A tap on it opens the picker, with Remove.
- **A cover:** full width above the title, at a height Jazz sets, kept short on a phone so that the title and first lines stay in view without scrolling. At 1280, hover shows Change and Reposition; at 390, the `⋯` menu has them.
- **A database and its rows:** an icon replaces the grid icon. A row's icon shows before its Name in every layout. A Gallery gets "Card image: Cover" as a choice (R3-3 said this would come with Files).

## 2. Sources

| Source | Needs | When |
| --- | --- | --- |
| **Emoji** | Nothing stored but the character. A picker, with search in English and Chinese | First. No infrastructure |
| **Image link** (cover or icon) | A pasted URL. Stored as a link, not a copy, like images in a body (R3-3): it may vanish | First. A failed one leaves no cover, with no frame, and the words stay where they'd be |
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
- **Offline:** an emoji always shows. A cover that can't load leaves no gap.

## 4. For Roadbuster and Jazz

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
- A dead image link: no broken frame, and nothing moves once it fails.
- An older tab keeps both, with a rollback run.
