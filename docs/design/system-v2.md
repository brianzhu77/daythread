# Daythread design system v2: grey, with a little blue

Status: **decided by Brian, Oct 26** ("for most content use only grey, with different levels; for something that really
needs colour, only blue, for a small portion of components"), following Tally's pattern. This replaces the colour and
shape rules of `tokens.md` (§2, §3) and `craft-v1.md` §1; type and spacing stay as `tokens.md` has them. `tokens.md`
§10 (one surface) stands.

## 1. The principle

1. **Everything is grey.** Text, icons, borders, fills, badges, hover and selected states come from one 12-step neutral
   scale. No tinted greys (the lavender of Craft v1 goes), no second accent.
2. **White is the surface.** Pages, the sidebar and cards are white; hairlines separate, fills do not. A block that
   needs an edge gets a 1px border, not a grey background.
3. **Blue is for the very few.** The focus ring, the checked box, the text selection, the editor's chips and the
   word "Today". Nothing else: the primary action and links are grey too. A selected tab or filter is grey.
4. **Rounded rectangles, not pills.** Controls are 8px rounded rectangles with a 1px border; pills remain only for the
   small badges (a tag, a date chip) and the phone's floating tab bar.

## 2. The scales

Radix's greys and blues (values public domain), one role per step, so a token's number says what it is for. The
Light and Dark columns are the same step with the same role: a rule that says `--gray-3` is a badge in both schemes.

| Step | Grey, light | Grey, dark | Blue, light | Blue, dark | Role |
| --- | --- | --- | --- | --- | --- |
| 1 | `#ffffff` | `#111111` | `#fbfdff` | `#0d1520` | the surface (page, sidebar, card) |
| 2 | `#f9f9f9` | `#191919` | `#f4faff` | `#111927` | subtle background: a hovered row, a quiet block |
| 3 | `#f0f0f0` | `#222222` | `#e6f4fe` | `#0d2847` | element background: badges, secondary buttons' hover, selected nav row, text selection (blue) |
| 4 | `#e8e8e8` | `#2a2a2a` | `#d5efff` | `#003362` | element background, hovered |
| 5 | `#e0e0e0` | `#313131` | `#c2e5ff` | `#004074` | element background, pressed; the hairline (grey) |
| 6 | `#d9d9d9` | `#3a3a3a` | `#acd8fc` | `#104d87` | subtle border |
| 7 | `#cecece` | `#484848` | `#8ec8f6` | `#205d9e` | control border: inputs, secondary buttons, the unchecked box |
| 8 | `#bbbbbb` | `#606060` | `#5eb1ef` | `#2870bd` | strong border, placeholder text |
| 9 | `#8d8d8d` | `#6e6e6e` | `#0090ff` | `#0090ff` | solid: tertiary text and icons (grey); the focus ring, the checked box (blue) |
| 10 | `#838383` | `#7b7b7b` | `#0588f0` | `#3b9eff` | solid, hovered |
| 11 | `#646464` | `#b4b4b4` | `#0d74ce` | `#70b8ff` | low-contrast text: secondary text, labels (grey); "Today" (blue) |
| 12 | `#202020` | `#eeeeee` | `#113264` | `#c2e6ff` | high-contrast text: body, titles; the primary button (grey) |

Red stays one value (`--red`, `#e5484d` light, `#ff6369` dark) for a passed deadline and a destructive action. Warn
(`--warn`) stays for the rare notice.

The tokens are `--gray-1` … `--gray-12` and `--blue-1` … `--blue-12` in `src/styles.css`. The older names
(`--ink`, `--ink-2`, `--line`, `--fill`, `--blue`, `--blue-soft`, …) are aliases onto these steps, so component rules
keep working; new rules use the step names.

### Dark

Dark follows the system setting (`prefers-color-scheme`), with no switch in the app: the twelve steps are restated
under the media query, and everything that names a step or an alias follows. Only the colours off the scales are
restated there too: red, warn, the simulated-row violet, the toast, the glass of the phone's tab bar, the scrim, the
hover dim and the shadows (deeper, since a shadow on near-black needs more weight to read). The primary button is
`--gray-12` with `--gray-1` text in both schemes, so it is white on dark. The theme-colour meta and `color-scheme`
follow, so the browser chrome, scrollbars and native form controls match. The editor's container carries HeroUI's
`.light` class (BlockNote's theme prop); the HeroUI mapping is restated on it and its colour scheme is inherited, so
its menus and the native checkboxes follow the page. Nothing is special-cased per screen: a rule that needs a
scheme-specific value is a sign the token is wrong.

## 3. Where blue may appear

The whole list. Anything not here is grey.

| Use | Token |
| --- | --- |
| The focus ring | `--blue-9`, 2px |
| A checked box | `--blue-9` (accent-color) |
| Text selection, the `/` and `@` chips in the editor, a line that just moved | `--blue-3` background, `--blue-11` text |
| "Today" in the calendar and the sidebar | `--blue-11` |
| The dot on a written day in the date picker | `--blue-9` |

**The auth screens are grey only** (Brian, Oct 26): there is no primary among many, so the button is `--gray-12`
with white text, links are `--gray-11` underlined, the focus ring is `--gray-12`. No blue on sign-in, sign-up,
forgot or reset.

**The primary button is the darkest grey** (`--gray-12`, white text, hover `--gray-11`) everywhere, and **links are
grey and underlined** (`--gray-11`, the underline in `--gray-7`, both `--gray-12` on hover): Done, Sign in, Plan for
today, Forgot password, a link in a note. Brian, Oct 26, after seeing the auth screens: the same on the app.

Grey, where it used to be blue: the selected tab on the phone, the selected filter, the pressed style button in the
editor, the Trash's back link, the secondary button (Today / Not today, Restore, Add), the sign-up and sign-in notes.

## 4. Components

| Component | Rule |
| --- | --- |
| Page, sidebar, card | `--gray-1`. The sidebar has a 1px `--gray-5` right edge; the active row is `--gray-3` with `--gray-12` text; other rows `--gray-11` |
| Hairline | 1px `--gray-5`: under the title block's first section, between list rows, around a block that needs an edge |
| Block on a page (Start the day, Due soon, the calendar's note, an empty state) | white, 1px `--gray-5` border, 12px radius; no grey fill |
| Primary button | `--gray-12`, `--gray-1` text, 8px radius, 40px (48px on the auth screens); hover `--gray-11` |
| Secondary button | white, 1px `--gray-7` border, `--gray-12` text, 8px radius; hover `--gray-2` |
| Ghost button (arrows, ⋯, Later) | no border, `--gray-11`; hover `--gray-3` |
| Filter chip (Tasks' lists, the calendar's Earlier / Later) | white, 1px `--gray-6`, `--gray-11` text, 8px radius; selected: `--gray-3`, 1px `--gray-7`, `--gray-12` semibold |
| Input | white, 1px `--gray-7`, 8px radius, 48px; focus: 2px `--blue-9` ring |
| Badge (a tag, a date chip, Draft-like states) | `--gray-3`, `--gray-11` text, 6px radius |
| Checkbox | 1px `--gray-7` border, 5px radius; checked `--blue-9` |
| Text | body and titles `--gray-12`; secondary `--gray-11`; tertiary and icons `--gray-9`; placeholder `--gray-8` |
| Phone tab bar | the white glass capsule stays; the current tab is `--gray-3` with `--gray-12` |

## 5. What this changes on screen

Lists and the sidebar lose their tint; blocks on Today get an edge instead of a fill; every button becomes a rounded
rectangle; the selected tab, filter and nav row turn grey; the primary action and links keep their blue. Type, spacing,
column and the one-surface layout do not move.
