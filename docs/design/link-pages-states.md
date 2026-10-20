# A2 · Pasting a URL makes a page: states

- Author: Jazz (Design) · 2026-10-20 · status: **design states for review**. Built on v0.4 `pages-delta.md` N-3, N-4,
  N-5. Where this doc is more specific, it fills in the "[details Design]" parts of those rules. It doesn't change them.
- Inputs:
  - Brian `3596b765`: "先建一个空页面，把链接作为属性带进来，我可以手动抓取" ("make an empty page with the link as a property;
    I can fill it in myself");
  - Brian `e83b0640` (O1=B): no fetching, no model;
  - Lead: A2 is next after A6b-1; Roadbuster writes the plan, Ratchet pre-reviews.
- **No network.** Nothing is fetched, so there's no fetching, timeout or offline state. The only failure is the app's
  own save failing, and that reuses the page card's existing "Not created · Retry".
- Evidence from his data (copy of the 2026-10-20 backup): 0 Materials, no URL in any page, and two hand-written recipe
  pages (韩国大酱汤, 佛卡夏披萨). So the likely first use is pasting a recipe link and writing the page himself. Nothing
  he has today needs migrating.

## 1. When a paste makes a page

A paste makes a link page only when **everything pasted is web links, one per line** (`http://` or `https://`, blank
lines allowed), **and the line it lands on is empty**.

| Paste | Result |
| --- | --- |
| One URL on an empty text, bullet or numbered line, on a day or a document page | One link page; the line becomes its **link card** (§2) |
| Several URLs, one per line, onto an empty line | One card per URL, in order, one notice for all (§4) |
| A URL into a line that already has text, or text mixed with URLs | Normal paste. URLs stay links. Nothing is made |
| A URL into a task row, a heading, a quote or a code line | Normal paste. A task keeps the link as its own link (D12) |
| A URL into a page title | Plain text in the title |
| Typing a URL (not pasting) | Stays a link. Nothing is made |
| `mailto:`, `file:`, `javascript:` or anything else that isn't http(s) | Normal paste |

Why "the line is empty": pasting into a sentence is writing, and turning half a sentence into a card would destroy his
words. An empty line is the "我贴一个URL过来" case. There's no menu asking what to make, because Undo (§4) is the
escape.

**Not in A2 (proposal, Lead decides):**
- **Make page for a URL inside a sentence** (N-3 row 4). Brian's case is the pasted URL, and cutting and pasting the
  URL onto its own line already does it. Add it if a week of use shows links stranded in sentences.
- **Capture bar URLs.** Today they become "Saved link" Materials through the model. Switching them to link pages
  changes the capture contract, so it should be its own step. Until then, there are two kinds of saved link. Brian
  has none of the old kind, so this costs nothing yet.
- **Editing or removing a page's URL** (N-4's "Already saved as…" and Undo against the current owner). A pasted URL is
  rarely mistyped, and if it is, he can delete the page and paste again. This removes the hardest part of the
  duplicate rules from the first build.
- **The saves list with a note per save** (N-5). A URL on its own line has no note, and "Linked from" already shows
  every day he pasted it. It comes back together with Make page, because that's where a note comes from.

## 2. The link card (where he pasted)

The existing page card (`editor-page-card`) with three changes:

```
[globe]  xiachufang.com/recipe/10324  ·  ↗          (default title: no domain repeated)
[globe]  韩国大酱汤 (正宗)           xiachufang.com  ↗   (after he renames it)
```

- **Icon:** a globe, both here and wherever a page icon shows a link page (sidebar tree, Pages rows, Subpages, Trash).
  It must not be the chain icon that "Linked from" uses.
- **Tap the card:** opens the link page, same as any page card.
- **↗ (44 px target, right side):** opens the website in a new tab. It's the only thing on the card that leaves the
  app.
- **Domain:** shown quietly (`--ink-3`) only while the title differs from the default (§3), checked when the card is drawn, so renaming it back hides the domain again. Otherwise it would show the
  domain twice.
- **One line** at every width. The title is cut with … and the domain is the first thing dropped at 390. ↗ never
  moves.
- **States**, all from the existing card:
  - creating: spinner, card not tappable;
  - failed: "Not created · Retry", and the URL is never lost because it's in the card;
  - in trash: muted with "In trash".
  The URL text shows as the title in all three.

## 3. The link page

```
‹ Pages                                              ⋯
韩国大酱汤 (正宗)                                     ← title field, as today
[globe] https://www.xiachufang.com/recipe/10324  Open ↗    ← URL row (new)
Linked from  Mon, Oct 19                              ← as today
Write…                                                ← empty body
```

- **Default title:** the URL without `https://`, `http://` and a leading `www.`, with percent-escapes decoded
  (Chinese paths read as Chinese) and no trailing `/`. The query and fragment are kept, because
  `youtube.com/watch?v=…` would otherwise give every video the same name. It's an ordinary title: editable, never
  updated from the URL again, and if he clears it, it reads "Untitled" like any page.
- **URL row:** sits under the title, above Linked from. It shows the URL **exactly as pasted**, on one muted line
  (`--ink-2`, 15px) cut with … at the end, with the full URL on hover or long-press. "Open ↗" is styled like the
  app's other text buttons. The row isn't editable in A2 (§1).
- **Where the page lives (Lead `22:32`, after Bumblebee):** the same as `/page`. It's a **child of the page he pasted
  into**, usually the day, with the card where he pasted. This replaces N-3's "top level". His two recipe pages already
  live this way, so there's one rule for where pages live. The breadcrumb shows the parent ("‹ Mon, Oct 19"), and by
  N-5's display rule the parent isn't repeated in Linked from. In Pages it shows under "In your days" with the globe
  icon.
- **The same URL pasted on a later day** keeps the page under its **first** parent. The new day only gets a card, so
  it shows in Linked from.
- **Trashed link page:** read-only like any trashed page. The URL row stays, and Open ↗ still works, because opening
  a website changes nothing.

## 4. Notices and Undo

They use the editor's existing notice strip. Every create says what happened and offers Undo.

| Case | Notice |
| --- | --- |
| New page | "Made a page · Undo" |
| Same URL as a live page | "Saved before · Mon, Oct 19 · Undo". The card goes to the **existing** page and no page is made |
| Same URL as a page in the trash | "Restored from trash · Undo", or "Restored to Pages · {parent} is in trash · Undo" when the old parent is still in the trash. It's exactly **Restore on that page's banner** (A4 `pages-trash-layout.md` §4–§5): **this page and the subpages deleted together with it**, never the rest of that delete, and never subpages deleted earlier on their own (those keep their own Trash row). It goes under its old parent, or the top level if the parent is in the trash. The card points to it |
| Several URLs | "Made 3 pages · Undo". With repeats: "Made 2 pages · 1 saved before · Undo" |
| Save failed | No notice. The card shows "Not created · Retry" (§2) |

- **The date in "Saved before"** is the day the page was made, shown in the app's day format ("Today", "Mon, Oct 19").
- **Undo turns the card back into the URL text he pasted, as a plain link, on the same line.** It also removes the
  page if this paste made it and nothing else has touched it yet: no other card, and no title or body edit. If this
  paste restored the page from the trash, Undo puts back in the trash **exactly what the paste restored** (the page
  and its subtree), as the same Trash row, and keeps any edits made in between. Edits never block this, because
  nothing in the trash is lost. **A new reference does block it:** if a card or `[[` reference to that page (or its
  subtree) was added anywhere since the restore, Undo only turns this card back into the URL text, the page stays
  live, and the notice reads "Kept {title} · linked from {page}". It's the same test as for a page this paste made.
  If he **moved** any page of that set since the restore, it's kept too: "Kept {title} · it was moved" (Roadbuster
  95c5ba7), so the Trash row never comes back with a different tree.
- **When Undo keeps a page the paste made**, the card still turns back into text, and the notice says why: "Kept
  {title} · it has your edits" (a title or body edit, or a child page) or "Kept {title} · linked from {page}" (another
  card or `[[`). Otherwise Undo **deletes** that page outright. It never shows up in Trash, because he never had it. For a repeat paste, Undo removes only the
  card. The aim is that "I only wanted the link" is always one tap.
- **⌘Z right after the paste does the same as Undo.** If the editor can't make that a single step, say so in the
  plan. The fallback is that ⌘Z removes the card, and the page stays with its "Made a page · Undo" notice still on
  screen.
- **Typing elsewhere doesn't block Undo.** Undo checks only this paste's cards (same block, same page). It turns
  those back into text and leaves every other line, including a note he typed after the paste, as it is. A card he
  already deleted is skipped. Only when none of the cards are left does it say "Page changed · nothing was undone"
  (Lead `2c2c1350`).
- **Under Good Stuffs, the line Undo puts back is a plain link with no follow-up.** It isn't collected as a saved
  link again until he edits that line (Ratchet `cad76b75`), because Undo means the paste didn't happen.
- **Deleting a card later** (Backspace, cut) removes only the card, like any page card (N-2). The page stays in Pages.
- **The same URL pasted twice on the same page** gives two cards to one page, each with "Saved before". That follows
  "each paste keeps its own line" (N-4).

## 5. Same URL

Exactly N-4's key: trim; lower-case the scheme and host; drop the default port; an empty path becomes `/`; everything
else is kept as typed. So `https://Example.com` and `https://example.com/` are the same page; `http://` and `https://`
aren't; tracking parameters are not removed. The page always shows the raw URL from the first paste. One key, one
page, live or in the trash, including two pastes at the same moment.

## 6. Checks (fake data, his copy, 1280 and 390)

1. Paste one URL on an empty line of today → card, "Made a page · Undo", the page is a child of today (breadcrumb
   "‹ Today", Pages "In your days", globe icon), empty body.
2. Paste the same URL with different host case or a trailing `/` on another day → "Saved before · {date}", no second
   page, the page stays under the first day, and the second day shows in its Linked from.
3. Trash the page, paste the URL again → "Restored from trash", one page, live. Variant: the link page is under a
   page that was deleted with it. Paste its URL → only the link page and its subpages come back, to the top level,
   with "… {parent} is in trash". The parent stays in the trash.
4. Undo right after 1 → the line is the URL text again, and the page is gone from Pages and Trash. Undo after 2 →
   only the card goes. Undo after 3 → the page is back in the trash.
5. Paste a URL into the middle of a sentence, into a task row and into the title → nothing is made.
6. Paste three URL lines → three cards, one notice.
7. A long Chinese-path URL at 390: the card stays one line and ↗ stays in place. The title field wraps. The URL row is
   one line with ….
8. Stop the server, paste → "Not created · Retry", and Retry after restarting makes the page once.

## 7. Open questions for the plan

- What happens to **Material** and the review's Good Stuffs step once links are pages? There are no Materials in his
  data, so A2 doesn't need a migration. But the plan should say whether the sort step and Related read link pages now
  or later (N-6).
- Is ⌘Z as one step (§4) cheap in BlockNote? If it isn't, the fallback is fine for the first build.
