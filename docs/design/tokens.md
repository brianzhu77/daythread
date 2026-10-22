# Daythread design tokens

Status: **v1 merged (acd30ce), no visual change (§8). v1.1 item 1 (§6 app-wide) on `design/heroui-tokens`.** Values come from what Today renders on main 216a565. Brian (247ee3f3, Oct 22): "first build our design system and
tokens based on the current design on today's route, then build the login page". This file replaces `craft-v1.md` §2
as the source of truth for values; craft-v1 stays as the record of where they came from.

Evidence: computed styles of every visible element on `/` (Today) at 1280 and 390, plus `/pages`, `/tasks`,
`/calendar`, `/review` and the fixture day, on a copy of Brian's data with `scripts/align-fixtures.ts`
(`/tmp/jazz-tok-run/audit.mjs`). Tokens live as CSS custom properties in `src/styles.css`, `:root`.

## 1. Rules

1. **Components use tokens, not raw values.** A new rule with a hex colour, a px font size or a radius that isn't a
   token is a review finding. Layout numbers (column widths, the capture bar height, icon boxes) are not tokens.
2. **One palette for our CSS and HeroUI** is the goal (§6). Until §9 is approved, HeroUI parts keep HeroUI's palette,
   and the sign-in screen sets the §6 mapping on its own root, since it's a new screen and nothing existing changes.
3. **Light only** until dark mode is designed (`color-scheme: light`, as now).
4. Every token change gets the geometry gate (`check-alignment`, 0 fail / 0 missing) and a pixel diff of Today,
   Pages, Tasks and the capture sheet at 390 and 1280 (Lead 4b3ce971).

## 2. Colour

The values are unchanged from what's live. The names are the ones `styles.css` already uses.

| Token | Value | Role on Today |
|---|---|---|
| `--bg-doc` | `#ffffff` | document pages: day page, any page |
| `--bg-grouped` | `#f5f5fa` | desktop sidebar, grouped screens |
| `--card` | `#ffffff` | cards and rows on a grouped background, the active sidebar row |
| `--fill` | `#efeef5` | secondary buttons, the active tab, pills, nav buttons (§6) |
| `--fill-soft` | `#f9f9f9` | a grouped block inside a document (morning card, Review entry) |
| `--tag-bg` | `#eef0f4` | tag and date chips |
| `--ink` | `#1c1c1e` | primary text, section headings, the day title (§6) |
| `--ink-2` | `#6e6e73` | secondary text, written lines in cards, card labels, tags |
| `--ink-3` | `#9ea0a4` | tertiary text: weekday, tree dates, details, done tasks |
| `--placeholder` | `#c4c4cb` | empty-line and field placeholders |
| `--line` | `#e5e5ea` | hairlines and separators |
| `--check` | `#d9d8dd` | unchecked checkbox border |
| `--blue` | `#0a84ff` | primary button, links, focus ring, selection |
| `--blue-pressed` | `#0172d9` | primary button pressed |
| `--blue-soft` | `#e7f3ff` | selected pill, text selection |
| `--blue-text` | `#2a599b` | text on `--blue-soft` |
| `--today` | `#5b91db` | "Today" in day headers |
| `--red` | `#e5484d` | overdue, destructive |
| `--warn` / `--warn-soft` | `#a8551b` / `#fdf2e7` | waiting for confirmation, budget notices |
| `--sim` / `--sim-soft` | `#7a62c4` / `#f2eefb` | "simulated" badge (local build only) |
| `--toast-bg` / `--toast-ink` | `rgba(28,28,30,.94)` / `#f5f5f7` | toasts |
| `--glass` | `rgba(255,255,255,.86)` | phone tab capsule, floating `+` |

**New in v1, naming one-off values that were inline in `styles.css` (same values):**

| Token | Value | Was inline in |
|---|---|---|
| `--ink-on-blue` | `#ffffff` | text and check marks on `--blue` |
| `--line-soft` | `rgba(17,17,26,.06)` | rule above grouped rows |
| `--line-strong` | `#e4e3ec` | hover fill on Linked from rows and the morning card's add |
| `--fill-hover` | `#f2f2f4` | day-title trigger hover |
| `--hover-dim` | `rgba(0,0,0,.06)` | tree action buttons hover |
| `--warn-line` | `#f0d6bd` | borders of receipts waiting for confirmation, failed v2 receipts |
| `--red-line` | `#efc9c4` | border of a failed receipt |
| `--drop-line` | `#3484ed` | the editor's drag drop line |
| `--scrim` | `rgba(20,20,30,.18)` | behind sheets |

## 3. Type

Font: `--font-ui`, the system stack `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI',
system-ui, sans-serif`. Body line height is 1.55. Rows that sit next to an icon use a fixed line height (in the
table).

| Token | Size | Weight / line height | Where on Today (and elsewhere) |
|---|---|---|---|
| `--text-large-title` | 34px | 700 / 41px | Pages, Tasks screen titles |
| `--text-title` | 28px | 700 / 34px | day title ("Thursday, Oct 22") |
| `--text-heading` | 20px | 600 | list headers, Calendar day headers |
| `--text-section` | 19px | 600 / 1.35 | day-page section headings ("Top 3", "Other") |
| `--text-body` | 17px | 400 / 1.55 | lines on the page, card titles, morning-card task titles |
| `--text-row` | 16px | 400 / 24px | page-card titles and rows inside the editor |
| `--text-ui` | 15px | 400 / 1.55 | sidebar rows, buttons, pills, card lines |
| `--text-small` | 14px | 400 / 1.55 | previews, notes, HeroUI `md` buttons |
| `--text-meta` | 13px | 400 / 1.55 | reasons, details, status lines, "Today" chip |
| `--text-caption` | 12px | 400–600 / 1.55 | sidebar labels, tree dates, eyebrows |

Weights: `--weight-regular` 400, `--weight-medium` 550 (active sidebar row, link buttons), `--weight-semibold` 600,
`--weight-bold` 700.

v1 swaps only exact matches: 89 font sizes and 50 weights now use these tokens. Still raw: the rem sizes (`.94rem`
= 15.04px, `.95rem` = 15.2px, `.74–.88rem`), one-offs (11, 12.5, 18, 22, 30px) and weights 500 (6) and 650 (3). They
fold in §9.

**Not folded (different roles, keep):** 19px section headings vs 20px list headers. Section headings sit inside the
17px text column, where 19 keeps the 1.12× step that the Oct 20 comparison settled.

## 4. Space, radius, elevation, motion

**Space.** No space tokens in v1. Spacing is tied to row geometry that `check-alignment` guards, and a mechanical swap
would add risk for no visible gain. The steps in use on Today are `2 4 6 8 10 12 16 18 20 24 48`px, with an 18px page
gutter and a 10px row gap. New components (sign-in first) use only these steps. The one-offs `3px`, `7px`, `14px` and
`26px` are optical (icon-to-text) and stay layout numbers.

**Radius** (names avoid Tailwind's `--radius-sm/md/lg`, which HeroUI and the editor scope use):

| Token | Value | Use |
|---|---|---|
| `--radius-tight` | 4px | inline link focus |
| `--radius-control` | 6px | small icon buttons (disclose, row ⋯) |
| `--radius-inline` | 8px | editor blocks, page cards in the editor, subpage rows |
| `--radius-row` | 10px | sidebar and tree rows |
| `--radius-block` | 12px | grouped blocks (morning card), fields |
| `--radius-card` | 16px | cards on grouped screens |
| `--radius-sheet` | 24px | capture sheet top corners |
| `--radius-pill` | 999px | pills, primary and ghost buttons |

Circles use `50%`. v1 swaps 44 exact radii. Still raw: 3, 5, 7, 14, 18, 20 and 22px (11 uses, mostly phone capture bar and
popovers), which fold in §9.

**Elevation:**

| Token | Value | Use |
|---|---|---|
| `--shadow-row` | `0 1px 2px rgba(0,0,0,.08)` | active sidebar row, dragged tree row |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04)` | note cards |
| `--shadow-card-soft` | `0 1px 2px rgba(17,17,26,.04)` | receipts, material rows (folds into `--shadow-card` in §9) |
| `--shadow-fab` | `0 5px 24px #0002` | desktop capture `+` |
| `--shadow-float` | `0 2px 6px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.10)` | tab capsule, popovers, sheets |

**Motion:** `--dur-fast` .12s ease for colour and opacity on press and hover. HeroUI keeps its own .15s.

**Hit targets:** `--tap` 44px minimum on phone.

## 5. Focus and states

- Focus: a 2px `--blue` ring with a 2px offset, on keyboard focus only (`:focus-visible`).
- Disabled: opacity .4 for our buttons. HeroUI's `--disabled-opacity` (.5) becomes .4 with §6.
- Pressed: primary fills `--blue-pressed`; others go one fill step darker (`--fill-soft` → `--fill`).

## 6. HeroUI theme → our tokens

Today, HeroUI parts render with HeroUI's palette, not ours. Examples: the day title is `oklch(.21 …)` instead of
`--ink`, nav buttons are `oklch(.94 …)` instead of `--fill`, and Calendar weekdays are `oklch(.55 …)` instead of
`--ink-2`. The mapping, applied app-wide in §9 and on the sign-in root now:

| HeroUI variable | → | Visible change |
|---|---|---|
| `--foreground`, `--surface-foreground`, `--overlay-foreground`, `--field-foreground`, `--default-foreground`, `--segment-foreground`, `--link` | `--ink` | day title and HeroUI text: `#18181b`-ish → `#1c1c1e` |
| `--muted` | `--ink-2` | Calendar weekdays and relative days: about 2% lighter, and warm grey instead of cool |
| `--default` | `--fill` | nav and icon buttons: `#ebebec`-ish → `#efeef5` (contrast with ink stays above 13:1) |
| `--accent`, `--focus` | `--blue` | HeroUI links and focus: `#3b82f6`-ish → `#0a84ff` |
| `--accent-foreground`, `--danger-foreground` | `#fff` | — |
| `--danger` | `--red` | — |
| `--background`, `--surface`, `--overlay`, `--segment` | `--bg-doc` / `--card` | — (both white) |
| `--surface-secondary` | `--fill-soft` | — |
| `--border`, `--separator` | `--line` | — |
| `--field-background` | `--fill` | sign-in fields: grey field on a white page |
| `--field-placeholder` | `--placeholder` | — |
| `--field-radius` | `--radius-block` (12px) | already 12px |
| `--disabled-opacity` | .4 | matches our buttons |

App-wide, the remap goes on `:root`. Inside `.bn-shadcn` (editor menus) the existing remap of `--accent` and `--muted` still
wins, so editor menus don't change.

## 7. For the sign-in screen

The screen is `empty-start-states.md` §2. On these tokens:

- page `--bg-doc`, column 360px max, centred, 18px gutter at 390;
- brand line in `--text-ui` at weight 600, title in `--text-title`, helper text in `--text-small` `--ink-2`;
- email field: HeroUI `TextField`, `--field-background`, 48px tall, `--text-body`;
- code: HeroUI `InputOTP`, 6 cells, each 44×52, `--text-title`, same field fill;
- primary button: full width, 48px, `--radius-pill`, `--blue`;
- the "Sent to {email}" line and "No code? · Use a different email · Resend" in `--text-meta`, with the links in `--blue`;
- error "That code didn't work" in `--text-meta` `--red`, under the cells, with no red field fill.

Full layout and screenshots come with the sign-in design check (C4 in `core-build`).

## 8. Checks for the v1 commit (no visual change)

Run on a copy of Brian's SQLite data with `align-fixtures.ts`, built app, Chromium at deviceScaleFactor 2.

1. Screenshots of `/`, `/pages`, `/tasks`, `/calendar`, `/review`, `/day/2026-10-18`, the fixture day and the open
   capture sheet, at 390 and 1280 (16 images, full page). The baseline is taken twice: byte-identical, so the
   method is stable. **After v1: all 16 byte-identical to the baseline.**
2. `check-alignment` on the same build: **310 pass, 0 fail, 0 missing.**
3. In `styles.css` outside `:root`, the raw values left are those listed in §3 and §4, plus three shadow colours on
   the phone toolbar, selection bar and paste notice (`#0002`, `#0003`, `.04`).

## 9. v1.1: small visible changes

**Item 1 is built on `design/heroui-tokens`** (from ed0e011; Lead agreed after sign-in, eb6bc379). Measured on a copy of
Brian's data, 20 full-page shots at 390/1280: Pages, Tasks, Review, Tags and sign-in are byte-identical. The day
pages, Calendar and the capture sheet change only in colour, with at most 10/255 per channel: day title
`#18181b`→`#1c1c1e`, nav and icon buttons `#ebebec`→`#efeef5`, Calendar weekdays `#71717a`→`#6e6e73`, and
HeroUI's accent text `#1e63ae`→`#2164b5`. `check-alignment` is 0 fail / 0 missing. Item 2 is still open.

To finish "one system", these would change pixels slightly:

1. **HeroUI → tokens app-wide (§6).** The day title gets about 2% lighter (`#18181b`→`#1c1c1e`). Nav buttons get a
   cooler, lighter grey. Calendar weekdays go from cool grey to `--ink-2`. HeroUI links and focus move to our blue.
2. **Folds:** rem sizes onto the scale (15.04 and 15.2 → 15, 12.48 / 12.16 / 11.84 → 12, 13.6 / 12.8 / 14.08 →
   13 or 14 by role). Weights 650 → 600 and our 500 → 550. Radii 14/18/20/22 → 12/16/24. `--shadow-card-soft` →
   `--shadow-card`.
3. Each fold is measured: pixel diff per screen, with the changed area listed, plus `check-alignment` 0/0.

My recommendation: do 1 now, since it makes the sign-in screen and the rest of the app one palette. Do 2 when each
component is next touched, because the gain is consistency of the code more than anything he'd see.
