# Plan audit — approved design docs vs the real screen (Jazz, 2026-10-19)

Scope (Lead, b842c6d3): editor-interaction §0 F1–F19 and §4, v05 morning card + Weave, craft-v1 steps 1–5, prelaunch Craft-replacement list. Other specs are in Roadbuster's table and Brian's own asks are in Bumblebee's.

How checked: my own copy of main `24a1b4b` on port 3061 with an empty database (`/tmp/jazz-audit-data`), headless Chromium at 1280 and 390, plus reading source. Brian's 3000 was not touched. Screenshots are in `/tmp/jazz-audit-data/`. Headless Chromium can't show motion, the native drag image, IME or a real phone keyboard, so those rows say "not checked".

Status: **built** / **partial** / **missing** / **dropped** (with who decided). "Brian OK" lists a message only where one exists. Where no Brian message is given, none was found.

## 0. Finding about the spec itself

- `docs/design/editor-interaction.md` **was never merged to main.** It lives only on branch `design/drag-and-dates` (tip `4a45305`). The editor was built and reviewed against it, but anyone reading main can't see it. **Fix: docs-only merge.** That's my miss: I should have asked for the merge when it was approved.

## 1. Editor feel checklist (§0) and layout (§4)

| Item | Status | Evidence | Brian OK to defer? |
|---|---|---|---|
| F13 `/` menu items: Heading 1/2/3, Body, Bullet, Numbered, Task, Quote, **Separator, Page, Link** | **partial**: Separator, Page and Link are missing. "Body" shows as BlockNote's "Paragraph". The Heading 2 hint is "Section", not "A section, like TODO - Top 3" | `/` on 3061 lists 8 items: Task, Bullet List, Heading 2, Heading 1, Heading 3, Quote, Numbered List, Paragraph (`page-editor.tsx:641`) | No. **Page is the item Brian noticed.** Link (paste a URL → link page) is Roadbuster's pages-delta item |
| F13 `/` alias match ("todo" → Task) and the 8-item cap | not checked | | |
| F12 markdown shortcuts | **built** | `---`, `>`, `[]`, `1.`, `###` all convert. Inside a task row `1.` and `##` stay plain, as specified | |
| F3 drag preview: lifted white card with shadow; a heading shows "Events · 1 line" | **dropped by decision (replaced)** | Corrected after Ratchet (f5c319f3): task #48, plan approved by Brian 21:59Z Oct 17, replaced the custom "N lines" preview with the native real-content preview, which Ratchet verified in task #49. Headless can't capture the native drag image, so my "missing" was wrong. Mid-drag tint and blue line are visible (`drag-1-mid.png`) | Brian 21:59Z (task #48) |
| F4 drop line | **built** (static look) | One 2px blue full-width line (`drag-1-mid.png`). The 150 ms slide-apart is not checked | |
| F2 handle (desktop) | **built** | 6-dot handle at the left of the hovered heading, label "Select or drag section" | |
| F2 handle (phone, right edge of the focused line) | not checked | | |
| F7 selection: tint, right-edge dots, bottom bar Style · Actions · Delete | **partial** | Tint is built (`drag-1-mid.png`). Dots and bar not checked in this pass | |
| F16 phone keyboard toolbar: Aa · + · indent/outdent · undo/redo · hide keyboard | **partial**: only undo · redo · + | `390-today.png` | No |
| F17 saving: quiet "Saved" | **built** | "Saved" appears at the top right after typing. "Not saved · Retry" not checked | |
| F5, F6, F9–F11, F13a, F14, F15, F18, F19 | not checked here | Ratchet's editor acceptance covers behaviour. IME and real-device rows still need Brian's iPhone | |
| §4 phone viewport `interactive-widget=resizes-content` | **built** | viewport meta on 3061 | |
| §4 capture moved to `+` on desktop, with ⌘J | **built** | "Capture · ⌘J" button, round + bottom right | |
| §4 one quiet loading state | **missing** | Both "Loading your day…" (`day-screen.tsx:27`) and "Opening your page…" (`continuous-page.tsx:7`) still exist, so the layout moves twice on first open | No (small) |
| §4 sidebar copy, no "Nested pages come with v0.4" | **built** | | |
| Rename a page (not in my spec; follows from Pages) | **missing** | also Roadbuster item 3 | |

## 2. v05 morning card and Weave (`docs/design/v05-morning-and-weave.md`, approved by Bumblebee 890325e)

| Item | Status | Evidence | Brian OK? |
|---|---|---|---|
| Morning card regrouped: Tasks (merged, one reason line) / Proposals (dashed +) / "2 lines from Thu ▸" | **missing** | `start-the-day.tsx` is still the v0.3 card: "Suggested last night" + Keep / Not today / Keep all + Done / Later | No. Brian chose O4=b (suggestion list he taps) on Oct 17 |
| `+` instead of a checkbox, "Add all tasks", the Undo row, Top 3 full | **missing** | as above | No |
| Proposals (text lines from earlier days, e.g. "call dentist Friday") | **missing** | Overlaps Roadbuster item 10 and Bumblebee's "Bring to today for prose lines" | No |
| Weave pages: band, out-of-date state, removed state, empty state, woven icon | **missing** | No "weave" anywhere in `src` | No. Depends on a real model (Bumblebee item 3) |
| Weave A (section in Pages) vs B (fifth place) | **open** | I found no message where Brian picked one | Ask him with the model setup question |

## 3. craft-v1 steps 1–5 (`docs/design/craft-v1.md`)

| Step | Status | Evidence |
|---|---|---|
| 1 Tokens | **partial**: light tokens shipped. **Dark mode is missing** (0 `prefers-color-scheme: dark` rules in the loaded CSS) | 3061 stylesheet scan |
| 2 Day page style | **built**, later changed by the editor-first layout (§4) | `1280-today.png` |
| 3 Phone shell: tab capsule, `+` capture sheet, top toasts | **partial**: capsule and sheet are built. **The Auto · Task · Page type chips are missing** (they waited on C5, and I found no answer from Brian) | `390-capture.png`: field + Save only |
| 4 Desktop sidebar + routes | **built** | |
| 5 Review as a sheet over the day page | **partial**: it's a full screen at `/review` with step dots and a floating footer, not a sheet | `390-review.png` |
| §5.6 Pages tab: search, recent page cards, tree | **missing**: Pages is a flat list (Brian asked for that on the Pages screen, 77423ea0). Search and recent cards were never built. The tree is pages-delta step B | |

## 4. Prelaunch Craft-replacement list (`docs/design/craft-v1-prelaunch-replace.md`)

| Item | Status | Note |
|---|---|---|
| 11 Craft-sampled colour tokens marked Replace (`--bg-grouped #f5f5fa`, `--fill`, `--today`, `--blue-*`, `--check`, `--ink-3`, `--tag-bg`, `--fill-soft`, dark values) | **not started** | All still at the Craft-sampled values in `src/styles.css`. This was scoped for before an App Store submission, not for now. It isn't a gap in Brian's first version, but it must be done before any public build |

## Missing / partial for the Lead's merged list (design view, most visible first)

1. `/` menu is missing **Page** (step A, in progress), **Link** (pages-delta) and **Separator**. "Paragraph" should read "Body".
2. **Morning card v05** (merged Tasks / Proposals / lines, `+`, Undo) isn't built. The card is still the v0.3 one, and Brian chose this direction on Oct 17.
3. ~~Drag preview (F3)~~: corrected. It was replaced by the native real-content preview (task #48, approved by Brian), so it isn't a gap.
4. **Phone keyboard toolbar** is partial: Aa, indent/outdent and hide keyboard are missing.
5. **Dark mode** isn't built.
6. **Capture type chips** are missing, waiting on Brian's C5 answer, which was never re-asked.
7. **Review as a sheet** is partial (full screen instead).
8. **Double loading state** on first open.
9. **Weave** isn't built, and the A/B choice is unanswered. Both depend on the model setup.
10. The editor spec isn't on main (docs merge).
11. Prelaunch colour replacement isn't started. It's for before App Store, not this round.
