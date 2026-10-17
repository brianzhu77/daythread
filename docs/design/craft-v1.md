# Daythread v1 visual system — following Craft

Status: **draft for review** (author Jazz, reviewer Bumblebee). Not approved until Bumblebee signs off and the Lead accepts it.
Revision r2: Bumblebee's review of r1 (f4205730) applied — Tasks pills, red chips only for passed deadlines, capture type chips, Starred removed. Behaviour is defined elsewhere, in this order: (1) the accepted specs — v0.3, v0.4 `pages-delta.md` and the Good Stuffs addendum; (2) `docs/reviews/craft-study/feature-map.md`, a study draft whose Brian decisions C1, C4 and C5 are still open; (3) this file, which only decides how things look. Where they disagree on behaviour, the higher one wins.

Decision this implements: Brian, 2026-10-16 — "the first version can copy Craft; build the features first, then develop our own style." Scope is the Lead's list in thread `#daythread:cf3b03a8`: copy Home, the phone tab bar, Calendar with daily notes, Tasks, the document page and light/dark mode. Collections, publishing/sharing, document styles and covers, comments, multiple spaces, onboarding and login are out of scope and not covered here.

Source: `refs/Craft ios Dec 2025/` (Mobbin, iOS, Dec 2025; gitignored, study only). Screenshot numbers below refer to `Craft ios Dec 2025 N.png`. Colors marked *sampled* were read from those PNGs; the rest are judgement. We copy layout, spacing, type and colour behaviour. We do **not** copy Craft's icons, illustrations, app icon or brand assets; icons come from an open icon set (proposal: Lucide, 1.75 px stroke).

What is evidence and what is my call:

- *Observed in Craft*: everything in §1–§3 that cites a screenshot.
- *Design decision (mine)*: the desktop sidebar (§3.2, Craft refs are phone only), the mapping of Daythread screens (§5), and every "Daythread:" note.
- *Needs Bumblebee/Lead*: §7.

---

## 1. What makes it look like Craft

1. **Two surfaces only.** Lists and home screens sit on a cool, faintly lavender grey (`#f5f5fa`); documents are pure white. Cards on grey are white with no border. (521, 410, 426 vs 25, 432)
2. **Large left-aligned titles.** Each tab opens with a bold 34 px title ("Home", "Tasks", "Calendar") and nothing above it but floating round buttons. (521, 410, 426)
3. **Floating chrome.** No toolbar bars. Navigation and actions are white capsules and circles with a soft shadow floating over content: the bottom tab capsule, the `+` circle, back/share/⋯ at the top, the editing tools at the bottom of a document. (426, 432, 87)
4. **Pills everywhere.** Filters, tags, date chips and primary buttons are fully rounded. Selected filter = light blue fill with blue icon and text. (410, 413, 426)
5. **Quiet greys, one blue.** Text is near-black; secondary text is mid-grey; the only saturated colour is system blue for selection, "Today" and primary actions. Red appears only for overdue/destructive. (413, 426, 355)
6. **Sheets and popovers, not pages.** Settings, pickers and menus open as rounded translucent sheets from the bottom or popovers anchored to their button, over a dimmed, blurred page. (84, 340, 355)

---

## 2. Tokens

Implemented as CSS custom properties in `src/styles.css`. Light is the default; dark applies with `prefers-color-scheme: dark` (and later a manual switch).

### 2.1 Colour

| Token | Light | Dark | Use | Evidence |
|---|---|---|---|---|
| `--bg-grouped` | `#f5f5fa` | `#141414` | Home, Tasks, Calendar backgrounds | sampled 521, 426, 462 |
| `--bg-doc` | `#ffffff` | `#141414` | document pages (day page, any page) | sampled 432 |
| `--surface` | `#ffffff` | `#222222` | cards on grouped background | sampled 426, 462 |
| `--fill` | `#efeef5` | `#232227` | search field, secondary buttons, pills | sampled 521 |
| `--fill-soft` | `#f9f9f9` | `#1c1c1e` | grouped block inside a document ("This Day") | sampled 432 |
| `--tag` | `#eef0f4` | `#1e1e20` | tag and date chips | sampled 426, 413 |
| `--ink` | `#1c1c1e` | `#f2f2f7` | primary text | sampled 521 (≈ near black) |
| `--ink-2` | `#6e6e73` | `#a1a1a6` | secondary text, inactive tab icons | judgement (iOS secondary label) |
| `--ink-3` | `#9ea0a4` | `#6c6c70` | weekday after a date, placeholders, chip text | sampled 426 |
| `--line` | `#e5e5ea` | `#2c2c2e` | hairlines between rows and under day headers | judgement |
| `--check` | `#d9d8dd` | `#48484a` | unchecked checkbox border | sampled 413 |
| `--blue` | `#0a84ff` | `#0a84ff` | primary buttons, selection dot, active tab | sampled 46 (`#0388ff`), 355 (`#0172d9` pressed) |
| `--blue-soft` | `#e7f3ff` | `#0a2540` | selected block, selected filter pill | sampled 46 |
| `--blue-text` | `#2a599b` | `#7fb2ff` | text and icon on `--blue-soft` | sampled 413 |
| `--today` | `#5b91db` | `#9d7cf0` | "Today" in day headers, today's date chip | sampled 426; dark uses Craft's violet (462) |
| `--red` | `#e5484d` | `#ff6369` | passed deadlines ("Was due Tue"), destructive menu items | judgement (413 shows a red alarm icon; we use red more narrowly, see §4.5) |
| `--scrim` | `rgba(20,20,30,.18)` | `rgba(0,0,0,.45)` | behind sheets and popovers | judgement |

Daythread-specific colours that Craft doesn't have (keep, but muted to match):

- `--warn` `#a8551b` / `--warn-soft` `#fdf2e7` for "waiting for confirmation" and budget notices.
- `--sim` `#7a62c4` for the "simulated" badge (local build only).

### 2.2 Type

System stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif`. PingFang SC is listed explicitly so Chinese text uses the same metrics on Mac and iPhone.

| Role | Size / line height / weight | Example |
|---|---|---|
| Large title | 34 / 41 / 700, tracking −0.4 px | "Tasks", "Calendar" (410, 426) |
| Document title | 28 / 34 / 700 | "Tomorrow, Fri, Nov 28" (432) |
| Section header | 20 / 25 / 600 | "Inbox", "Pinned Docs" (410) |
| Day header | 20 / 25 / 700 date + 600 coloured "Today" + 400 `--ink-3` weekday | "Nov 27 · Today · Thursday" (426) |
| Block heading in a doc | 17 / 24 / 600 | "This Day" (432) |
| Body | 17 / 26 / 400 | document text (25) |
| List row | 17 / 22 / 400 | task rows (413) |
| Secondary | 15 / 20 / 400 | descriptions, previews |
| Chip / caption | 13 / 16 / 500 | "Inbox", "Nov 28" (413) |
| Sheet section label | 13 / 16 / 600, uppercase, tracking 0.4 px, `--ink-3` | "NESTED CONTENT" (84) |

Desktop keeps the same sizes; the extra width goes to margins, not bigger type.

### 2.3 Spacing, radius, elevation

- Base unit 4 px. Screen side padding **20 px** on phone (521); document column max **700 px** on desktop.
- Row height: list rows **44 px** (tap target); task rows 44 px; day header block 56 px.
- Gaps: 8 px between pills; 24–32 px above a section header; 12 px between a header and its first row.
- Radius: chips/pills `999px`; cards **16 px** (426 daily-note card); grouped block in a doc **12 px** (432); sheets and popovers **24 px** (84, 340); checkbox **5 px** at 20 px size (413).
- Elevation:
  - `--shadow-float`: `0 2px 6px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.10)` — tab capsule, `+`, top round buttons, popovers.
  - Sheets: same shadow plus `backdrop-filter: saturate(1.6) blur(20px)` on a `rgba(250,250,252,.82)` fill (light) or `rgba(40,40,42,.82)` (dark).
  - Cards on grey: no shadow, no border.
- Motion: 200 ms ease-out for sheets sliding up and popovers scaling from their anchor (0.96 → 1); 120 ms for pressed states. Respect `prefers-reduced-motion`.

---

## 3. Navigation

### 3.1 Phone (< 900 px) — copy Craft

- **Bottom tab capsule**, floating 12 px above the safe area, white, `--shadow-float`, four icons with the active one on a `--fill` pill (426, 521). Daythread tabs: **Today · Tasks · Calendar · Pages**. Labels are not shown (Craft shows none); each icon has an accessible name.
- **`+` circle** to the right of the capsule. In Daythread it opens **capture** (§5.3), replacing today's fixed bottom capture bar.
- **Top right**: floating round ⋯ button (and a bell later). Top left on pushed screens: a round back button; the page title appears small in the top bar only after the large title scrolls away (87, 340).
- Content scrolls under the floating chrome; leave 96 px bottom padding so the last row clears the tab capsule.

### 3.2 Desktop (≥ 900 px) — my adaptation

Craft's Mac app has a sidebar, but we have no Mac screenshots, so this is a design decision, kept consistent with the phone tokens:

- **Sidebar 260 px** on `--bg-grouped`, content on `--bg-doc`. Top to bottom: search field (`--fill`, 36 px, radius 10), then Today, Tasks, Calendar as rows with icons, then **Pages** (the tree), then **Days** (by month, collapsed except the current month). Starred is later (feature map), not v1.
- Tree rows 30 px, 15 px text, 16 px indent per level, disclosure chevron on hover. Selected row: white pill with a hairline shadow. Long titles truncate with an ellipsis.
- The sidebar collapses at 900–1100 px to icons only; below 900 px the phone layout takes over.
- Capture on desktop stays a floating field under the page title (current main behaviour) and `⌘K` focuses it; the `+` button is phone only.

The static draft in `prototypes/craft-visual/pages.html` (branch `ui/craft-visual`) shows the sidebar and tree; it will be updated to these tokens.

---

## 4. Components

Each item: what Craft does → what we build.

1. **Large title header** (410). Title at 20 px from the left edge, 34 px bold; optional pill row below (filters). Our day page uses the *document title* style instead (§5.1), because it is a document.
2. **Search field** (521). Full width, 44 px, `--fill`, radius 12, magnifier icon, placeholder "Search pages and tasks".
3. **Filter pills** (410, 426). 44 px tall, `--fill`; selected: `--blue-soft` with `--blue-text` icon and label. Icon-only pills are allowed when the meaning is shown on the selected one (410).
4. **Section header** (410). 20 px semibold title, a ⋯ button 8 px after it, and a collapse chevron at the right edge.
5. **Task row** (413, 426). Checkbox 20 px, 5 px radius, 1.5 px `--check` border, checked = `--blue` fill with white tick; then the title; then chips. Date chip: clock icon + text in `--tag`, e.g. "Due tomorrow", "Due Thu". The chip is red **only when a deadline has passed** ("Was due Tue"). A task that was planned for an earlier day and not done is never red: it goes to the morning hand-off instead (feature map C2, D07). We don't copy Craft's red "overdue" look for planned dates (413).
6. **Grouped block in a document** (432 "This Day"). `--fill-soft`, radius 12, 16 px padding, 17 px semibold heading, ⋯ next to the heading, collapse chevron at right.
7. **Day header in a list** (426). "Oct 16 · Today · Friday" with a hairline under it and ⋯ at the right; the daily note appears as a white card (radius 16, ~130 px tall, title + first line) followed by that day's tasks.
8. **Page card in a document** (87). Small document icon (40 × 48, white with hairline), title 17 px, one-line preview in `--ink-3`. A link page uses the same card with the site's favicon in place of the document icon. Inline mention: a pill with icon + title.
9. **Recent page cards** (521). Horizontal scroller of portrait cards ~165 × 210, radius 14, showing a miniature of the page. v1: title + first lines rendered as text; no thumbnails.
10. **Bottom sheet** (84, 355). Radius 24 top corners, grab handle, translucent blurred fill, optional search field at the top, uppercase section labels. Primary action = full-width blue pill; cancel = grey pill beside it (355).
11. **Popover menu** (340). Anchored to its button, radius 20, translucent, rows 44 px with an icon column, hairline group separators, destructive rows in `--red`.
12. **Toast** (339, 353). Small pill at the **top centre**, white, `--shadow-float`, 15 px text, optional action ("Open"). Daythread's undo notices use this on phone ("Not today · Undo · Keep planned"); on desktop they sit bottom centre. Auto-dismiss after 6 s except when the notice carries Undo for a commitment change (keep until the next action, as today).
13. **Empty state** (410). `--fill` rounded box, centred outline icon, two lines of `--ink-3` text.
14. **Block selection** (46). Selected block gets `--blue-soft` and a blue dot at the right edge. Applies once the block editor lands; not in the current slice.

---

## 5. Daythread screens in Craft's language

### 5.1 Day page (the Today tab)

- White document background. Title in document-title style: **"Today, Fri, Oct 16"** (Craft writes "Tomorrow, Fri, Nov 28", 432). A date pill under it ("Oct 16, 2026 ⌄") opens the date picker sheet; prev/next day are swipes on phone and arrow buttons on desktop.
- **Start the day** becomes a grouped block (component 6) titled "Start the day", directly under the date pill, collapsible. Its rows use the task-row component with Keep / Not today as small pill buttons on the right.
- The **facts strip** ("Still open · 4 · oldest 4 days") becomes one muted line under the grouped block, not a card.
- Template sections (TODO – Top 3, TODO – Other, Events, Good Stuffs, Notes) render as block headings (17 px semibold). Rows are task rows (component 5). Good Stuffs links are page cards (component 8).
- "Review today" is a full-width grey pill at the end of the page and also a ⋯ menu item.

### 5.2 Tasks tab

Large title "Tasks"; pills **Today · Upcoming · Open · Not today** (Craft has inbox, today, calendar, all; 410). There is no separate Inbox (feature map §2.3, C2).

- **Today**: the same tasks as today's day page, including the "Planned · not in note" rows that can be put back.
- **Upcoming**: 01's "by date" list.
- **Open**: "Still open", including never-dated tasks, which carry an "Unscheduled" chip.
- **Not today**: paused tasks; Craft has no equivalent.

This tab only lists tasks; the hand-off, Placement and Not today rules don't change.

### 5.3 Capture (the `+`)

Phone: `+` opens a bottom sheet with the cursor already in a multi-line field and the keyboard up, so a capture still starts with one tap. Under the field is a row of type chips, **Auto · Task · Page** (filter-pill style, §4.3); **Task** adds a date chip. Auto is drawn as the default until Brian picks one (feature map C5). The primary pill reads "Save"; the receipt card appears in the sheet when done. What each type does (when Auto saves directly and when it asks for confirmation) is defined in v0.3 01 §4, not here. Craft's quick create (19, 350) uses the same sheet with "Create". Desktop: the floating field under the title stays. Receipts on the page keep their current content, restyled as white cards on `--fill-soft`.

### 5.4 Calendar tab

Copy 426: pills Daily Notes · Tasks · Events, then a scrolling list of day headers (component 7) each with the day's page card and tasks. Tapping a day header opens that day's page.

### 5.5 Review

Full-screen sheet over the day page: step dots at the top, one step per screen, the primary action as a blue pill in a floating footer. Keeps the steps from 01 §7 and the Saved items step unchanged.

### 5.6 Pages tab (Home)

Copy 521 minus Craft-only items: search, recent page cards, **Pages** tree. No Starred (later), no "Shared with me", no tags in v1.

---

## 6. Changes from current main (692f4f1)

Current main already has the white document, rounded checkbox and pill buttons from `eeb72e0`. To reach this spec:

1. Replace the token block in `src/styles.css` with §2 (accent `#4a5bd8` → `#0a84ff`; add grouped background, dark mode).
2. Day page: document-title style, date pill, Start the day as a grouped block, facts line, date chips with icons.
3. Phone shell: bottom tab capsule + `+` (capture sheet); remove the fixed capture bar on phone; top-centre toasts.
4. Desktop shell: sidebar (Today, Tasks, Calendar, Pages, Days). Tasks, Calendar and Pages screens show an empty state until their features exist.
5. Review restyled as a sheet.

Steps 1–2 are style-only and can ship first. Steps 3–5 change layout and need Wheeljack to confirm routes (`/tasks`, `/calendar`, `/pages`) before I build them.

---

## 7. Open questions

Resolved in review: tab order Today · Tasks · Calendar · Pages (Bumblebee adopted it; what the app opens on is still Brian's choice C1); capture behind `+` on phone, with focus in the field on open, to be checked against Brian's captures per day after a day of use.

1. **Default capture type** — Auto or Task; Brian's choice (C5). Only the default chip changes.
2. **Accent colour** — Craft lets users choose the accent (456). v1 ships system blue only.
3. **Icons** — Lucide proposed; needs Wheeljack's OK to add the dependency (or inline SVGs for ~15 icons).
