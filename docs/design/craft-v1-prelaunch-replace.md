# Craft v1 — what to replace before App Store launch

Status: **inventory only** (author Jazz, 2026-10-17). Nothing here changes the current design or code. Requested by the Lead in thread `#daythread:06469260` after Brian set the long-term App Store goal.

Scope checked: `docs/design/craft-v1.md` r2 (5559ae0a…) and the shipped UI on main `38296f1` (`src/styles.css`, `src/components/**`). Craft reference screenshots stay out of the repo (`refs/` is gitignored).

Rule used (from the Lead's note to Brian): borrowing Craft's **layout and interaction patterns** is fine. Before launch we replace anything **taken from Craft's own pixels or words**: sampled colours, copied wording, and any combination distinctive enough to be mistaken for Craft. This is a design inventory, not legal advice; the trademark search and any legal review are separate pre-launch items.

How to read the table:

- **Replace**: taken directly from Craft (sampled from a screenshot, or Craft's wording). Must change before launch.
- **Review**: not copied as such, but part of the overall Craft look; decide when we design our own style.
- **Keep**: generic platform values (Apple iOS system colours, common UI patterns) or our own work.

## 1. Colours

Tokens in `src/styles.css` (`:root` and the dark-mode block); sources from craft-v1 §2.1.

| Token | Light / dark (shipped) | Source | Verdict |
|---|---|---|---|
| `--bg-grouped` | `#f5f5fa` / `#141414` | sampled from Craft 521, 426, 462 | **Replace**. The lavender grey is a signature of Craft's list screens. |
| `--bg-doc` | `#ffffff` / `#141414` | white sampled 432; dark sampled | Light: **Keep** (plain white). Dark `#141414`: **Replace** (Craft's exact dark background). |
| `--card` | `#ffffff` / `#222222` | sampled 426, 462 | Light: **Keep**. Dark `#222222`: **Replace**. |
| `--fill` | `#efeef5` / `#232227` | sampled 521 | **Replace** (both). |
| `--fill-soft` | `#f9f9f9` / `#1c1c1e` | light sampled 432; dark is iOS secondary system background | Light: **Replace**. Dark: **Keep** (Apple system value). |
| `--tag-bg` | `#eef0f4` / `#26262a` | light sampled 426, 413; dark judgement | Light: **Replace**. Dark: **Keep**. |
| `--ink` | `#1c1c1e` / `#f2f2f7` | sampled 521, but equals Apple's label colours | **Keep** (Apple system value). |
| `--ink-2` | `#6e6e73` / `#a1a1a6` | judgement, Apple secondary label | **Keep**. |
| `--ink-3` | `#9ea0a4` / `#7c7c80` | light sampled 426; dark adjusted for contrast | Light: **Replace**. Dark: **Keep**. |
| `--check` | `#d9d8dd` / `#48484a` | light sampled 413; dark is Apple system grey | Light: **Replace**. Dark: **Keep**. |
| `--blue` | `#0a84ff` | Apple systemBlue (Craft's sample was `#0388ff`) | **Keep** (Apple system value). |
| `--blue-pressed` | `#0172d9` | sampled 355 | **Replace**. |
| `--blue-soft` | `#e7f3ff` / `#0a2540` | light sampled 46; dark judgement | Light: **Replace**. Dark: **Keep**. |
| `--blue-text` | `#2a599b` / `#7fb2ff` | light sampled 413; dark judgement | Light: **Replace**. Dark: **Keep**. |
| `--today` | `#5b91db` / `#9d7cf0` | light sampled 426; dark is Craft's violet (462) | **Replace** (both). The violet "Today" in dark mode is especially recognisable. |
| `--line`, `--placeholder`, `--red`, `--warn*`, `--sim*`, `--toast-*`, `--glass`, `--scrim` | — | judgement or Apple system values | **Keep**. |

Net: 12 tokens have at least one value to replace. Because older names (`--paper`, `--accent`, …) are aliases of these, replacing the tokens in one block re-themes every screen; no component edits are needed for colour.

## 2. Wording

Only Daythread's own wording ships today. Checked every visible label on main `38296f1`.

| Where | Text | Origin | Verdict |
|---|---|---|---|
| Day page title (`day-screen.tsx`) | "Today, Fri, Oct 16" | modelled on Craft's daily-note title "Tomorrow, Fri, Nov 28" (432) | **Review**. A plain date format, not distinctive wording; low risk. Remove the code comment that cites Craft when the style is replaced. |
| Tab names | Today · Tasks · Calendar · Pages | generic nouns; Craft uses Home · Tasks · Calendar | **Keep**. |
| Tasks pills | Today · Upcoming · Open · Not today | Daythread's own (Craft: inbox, today, calendar, all) | **Keep**. |
| Capture sheet button | "Save" | ours; Craft uses "Create" | **Keep**. |
| Calendar pills | Earlier · Today · Later | ours; craft-v1 §5.4 proposed Craft's "Daily Notes · Tasks · Events", which was **not** shipped | **Keep**. Do not adopt the §5.4 Craft wording later. |
| craft-v1 §4.2 search placeholder | "Search pages and tasks" | our wording, not shipped | **Keep**. |

Code comments and file names that mention Craft (`styles.css` header, `/* … Craft-style */`, "craft-v1 §…" references, `docs/design/craft-v1.md`) are internal, not user-visible, but should be renamed to our own design-system name when the visual layer is redone, so the shipped source doesn't describe itself as a copy.

## 3. Distinctive combinations (Review)

Each pattern below is common on its own. Together they make up most of what reads as "Craft" in our screenshots. Replace at least the colour and a couple of these when we design our own style.

1. **Floating white tab capsule plus a separate round `+`** at the bottom on phone (craft-v1 §3.1). Common iOS pattern, but the exact capsule-plus-circle pairing with Craft's shadow is close to Craft's.
2. **Lavender-grey list screens + white documents + white borderless cards** (craft-v1 §1.1). Goes away with the colour replacement above.
3. **Large 34 px titles with nothing above them but floating round buttons** (§1.2). Apple's standard large title; keep it, but our own header details will help.
4. **Day header format "Oct 16 · Today · Friday"** with a coloured "Today" (Calendar, §4.7). Change the format or colour treatment.
5. **Shadow token `--shadow-float`** (`0 2px 6px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.10)`). Judged from screenshots, not sampled; review with the rest.

## 4. Already clear

- **Icons.** `src/components/icons.tsx` and the clock in `styles.css` are simple stroke icons drawn for Daythread; no Craft icon assets. Before launch, either keep them or move to an open-licence set (Lucide was proposed, ISC licence) and record the licence.
- **Illustrations, app icon, logo**: none copied.
- **Fonts**: system stack only (`-apple-system`, PingFang SC); nothing bundled.
- **Screenshots**: `refs/Craft ios Dec 2025/` is gitignored and never shipped.

## 5. Suggested pre-launch order

1. Replace the 12 colour tokens (one block in `styles.css`, light and dark), then check contrast again.
2. Rework the day header format and the phone tab bar as part of "our own style".
3. Rename `craft-v1` in docs and code comments.
4. Record the icon source and licence.
