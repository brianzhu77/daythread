# A9 · `[[` page links and quotes with a source, plus B15 Linked from order: states

- Author: Jazz (Design) · 2026-10-21 · status: **design states for review**. Base main 692f587.
- Inputs:
  - v0.3 `00-scope.md` item 4 and REF ("page-level references; a quote keeps its excerpt as text with a source
    link");
  - `01-flows-and-ux.md` §6.2–6.5 and the §8 rows "Reference target removed";
  - `04-acceptance.md` P03, P06, P13;
  - v0.4 `pages-delta.md` N-5 (Linked from: real references only, newest first);
  - checklist A9 and B15;
  - Lead `038e7cf1` (A9 + B15 next; Roadbuster plans, Ratchet pre-reviews).
- Design sources reused: page card and its states (`pages-tree-layout.md`), trash (`pages-trash-layout.md`), link
  pages (`link-pages-states.md`).
- **No model, no network.** Everything here is local text and page ids.

## 1. What `[[` makes: an inline page link

`[[` inserts a **page link inside the line**, so he can write "做法参考 [[韩国大酱汤]] 里的配料". Every tool that has `[[`
(Notion, Obsidian, Logseq) works inline, and the line keeps his words around it. Own-line cards stay what they are
today, made by `/page` and by pasting a URL. `[[` never makes a card.

```
做法参考 [▢ 韩国大酱汤] 里的配料          ▢ = page icon, globe for a link page, calendar for a day
```

- **Look:** a small icon (14 px) and the page's **current** title in `--ink`, on a `--fill` background with 4 px
  rounding, at the line's own text size. It must not look like a web link (BlockNote's blue underline), because it
  doesn't leave the app.
- **Tap or click:** opens that page at the top. There's no promise of landing on a passage (v0.3 §6.2).
- **It's one unit:** the cursor steps over it, and Backspace deletes it whole. Deleting it removes the reference, so
  this page leaves the target's Linked from once its last link or card is gone.
- **Live title:** a rename shows everywhere at once, with nothing stored as text. Copying a line with a link inside
  the app keeps the link.
- **States** (the same meanings as the page card):

  | Target | Shows | Tap |
  | --- | --- | --- |
  | live | icon + title | opens it |
  | in the trash | bin icon + title in `--ink-3` | opens the trashed page (banner + Restore, A4) |
  | gone (no such page) | "Page not found" in `--ink-3` | nothing |
  | being created (§3) | "Untitled" + spinner | nothing |
  | create failed | "Not created · Retry" | Retry |

  "Original removed · Restore" (v0.3 §8) is covered by the trash state: the page opens with its Restore banner.

## 2. Typing `[[` and the pick list

- **Trigger:** `[[`, or **`【【`**, which is what the Chinese input method gives for `[[`. He writes in Chinese, so
  without it the trigger wouldn't work for him. It works in any text line, including headings and quotes, but not in
  a task row (a task title is a task, D12) or in a page title. While an input method is composing, nothing opens,
  the same as `/`.
- **Phone:** the editor's **+** menu gets a "Link to page" item (aliases `link`, `[[`, `链接`, `引用`) that opens the
  same list. That's v0.3's "toolbar button on iPhone", reusing the button that's already there.
- **The list** is a popover under the cursor, in the style of the `/` menu:
  - **No text yet:** up to 6 **recently opened or edited pages**, newest first.
  - **While he types:** pages whose **title** contains the text (case-insensitive, Chinese by substring). Matches at
    the start of the title rank first, then the most recently edited. At most 8 rows.
  - **Each row:** icon, title, and a quiet second line saying where it lives ("in Sun, Oct 18", "in Pages"). For a
    link page, it's the domain. This tells apart two pages with the same title, such as the www / no-www pair Lead
    noted.
  - **Day pages** match their label ("Mon, Oct 19", "Oct 19") and their ISO date. Words like "昨天" or "Mon" alone
    aren't parsed.
  - **Left out:** pages in the trash, which he restores first, and the page he's on, since a page linking to itself
    means nothing.
  - **The last row is always "New page "{text}"",** shown once he has typed something (§3).
  - **Keys:** ↑↓ to move, Enter or a tap to choose, and Esc to close and leave `[[text` as plain text. Typing `]]`
    with no row chosen also leaves plain text.
- **Search is titles only** in A9. v0.3 says "titles and text", but with 9 pages, titles find everything, and
  matching inside the body brings back the snippet and ranking questions. Body search can be added with search
  itself.
- **Nothing matches:** only "New page "{text}"", plus a quiet "No page called {text}" line above it.

## 3. "New page" from `[[`

- It makes a page titled with the typed text, as a **child of the page he's on**, the same rule as `/page` and
  pasted URLs (Lead `ca10deaf`). The link goes in at once in its "being created" state and becomes live when the
  server confirms. Failure shows "Not created · Retry", reusing `/page`'s confirm loop.
- He **stays** on the current page and keeps writing. That's the point of inline linking.
- **No notice.** Like `/page`, ⌘Z removes the link, and the page stays in Subpages, so it's never invisible. Making
  `[[` create-and-undo stricter than `/page` would leave two rules for one action.

## 4. Quote with a source

v0.3 item 4: "A quote keeps its excerpt as text with a source link." He copies from a page (often a link page he has
filled in) and pastes into a day.

- **The trigger is the paste, not a new button.** When he pastes text that he **copied from another page in the
  app**, a notice offers it: "Pasted from {title} · **Add source**". The phone has no text toolbar, and both phone
  and desktop already paste, so the offer comes at the moment it's useful, and only when he asks.
- **Add source:** the pasted lines become a **Quote** block (the existing BlockNote quote), and a source line
  "— [▢ {title}]" is appended at the end of the quote, holding an ordinary §1 page link. Undo on the notice turns it
  back into the plain paste.
- **The text is his copy.** It keeps its wording when the source changes (v0.3 §6.3) and is never re-synced. Only
  the link shows the source's current title and state.
- **Not offered:** text from outside the app, a paste within the same page, a paste into a task row, or a paste of
  whole blocks with cards in them. Those stay ordinary pastes.
- Because the source link is a real page link, the quote's page shows up in the source's **Linked from** (P13).

**Not in this round (Lead `a5a33307`):** §4 is A9b, the next round. This round is A9a (`[[`, §1–§3) plus B15 (§5).
§4 stays here as the design for A9b, and §6 check 7 moves with it.

## 5. Linked from (B15 and what links add)

- **What counts:** a page is listed when it holds a live **card or `[[` link** (a quote's source line included) to
  this page (N-5). Text that merely mentions the title never counts (P13). The parent is still shown only in the
  breadcrumb, never repeated (Step B rule).
- **One entry per page** however many links it has, as now.
- **Order (B15): newest first by when that page last made a reference here.** An entry's time is its newest live
  reference. If that one is deleted, it falls back to the next newest. When the last one goes, the entry leaves.
  **Moving either page never changes the order.** That's the bug B15 fixes: today's order follows page order, so a
  move reshuffles it.
- **References from before B15** get their order **frozen once at upgrade**, as it reads that day. They sort after
  every reference made since, and a later move doesn't reshuffle them (Ratchet `c293ef38`: if their order is
  recomputed from the page list each time, B15 still reshuffles). No real time is invented for them; they're shown
  only as "older".
- **A time is set when a reference is made and never again.** Ordinary saves, renames and moves don't touch it.
  Each link or card has its own time, so deleting the newest falls back to the next one still there.
- **Display is unchanged:** day pages as their date ("Fri Oct 16", "Today"), first 3 shown, then "{n} more"; a source
  page in the trash reads "{label} (removed)" and doesn't open (A4).

## 6. Checks (his data copy, 1280 and 390)

1. In today's Notes, type `做法参考 [[韩` → the list shows 韩国大酱汤 "in Sun, Oct 18" → Enter → the link sits inline,
   and the text around it is intact. Tap → 韩国大酱汤 opens at the top. Its Linked from shows "Today".
2. The same with the Chinese input method's `【【`, and on 390 via **+** → "Link to page".
3. Rename 韩国大酱汤 → today's link shows the new name, with no edit to today's text.
4. Trash 韩国大酱汤 → the link is muted with the bin icon and opens the trashed page with Restore. `[[` no longer lists
   it. Restore → the link is live again.
5. `[[新页面` → "New page "新页面"" → the link becomes live, the page is under today in Subpages, and he's still on
   today. ⌘Z → the link goes and the page stays.
6. Backspace over a link deletes it whole, and today leaves the target's Linked from (if nothing else links there).
7. Copy two lines from 韩国大酱汤 and paste into today → "Pasted from 韩国大酱汤 · Add source" → a quote with
   "— [▢ 韩国大酱汤]". Edit the source text → the quote keeps its wording. Undo → the plain paste.
8. **B15:** link page X from Oct 19, then from today. Linked from reads "Today, Mon Oct 19". Move X under another
   page → the order is unchanged. Delete today's link → "Mon Oct 19" only.
9. Long Chinese titles in a link mid-line wrap with the line at 390, and the link never overflows the screen.
10. `[[`, Esc and `]]` leave plain text. `[[` in a task row and in the title opens nothing.

## 7. Open questions for the plan

- Where is a link stored: an inline content type in the editor JSON (with the server extracting references from it
  for Linked from), or a separate record per link? Design needs only that rename, trash and Linked from stay live
  and consistent.
- "Copied from another page in the app" (§4): can the app's own copy put the source page id in the clipboard
  (`application/x-daythread-blocks` already exists for blocks)? If it can't, cut §4 rather than guess the source.
- B15 needs a time on each reference (checklist: a column and a migration). If the stored link carries its own time,
  that answers this too.
