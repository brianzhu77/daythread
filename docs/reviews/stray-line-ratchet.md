# Stray line / row-arrow review — task #115

**PASS 5af3522**, including the hidden-row correction. No remaining blocking finding in this scope. Lead owns alignment and deployment; the section-deletion/Undo-role issue is a separate pending fix.

All browser work used an independent built checkout and synthetic SQLite on port 3425. No typing or QA writes on 3000, live or production.

## Independent checks

- Final typecheck and build pass. Full suite: **339 pass, 0 fail, 11 skipped, 4 TODO**.
- Independently reran the author's ordinary row-navigation harness on fresh pages at **1280 and 390: 13/13 each**. One arrow press moves one row through populated/empty tasks and the Other heading; no gap cursor; horizontal column preserved within the tested tolerance; a slash menu retains its arrows.
- Added both-width wrapped-task checks: Down within the first visual line stays in the same task; Down from its final line enters the next task; Up returns to the last visual line. A synthetic composition-start/arrow/end sequence does not invoke custom movement. This is not a real IME or iPhone test.
- Independently ran the author's natural past-day drill: **4/4**. Hidden rows exist after reopening; Up from Events skips Other's hidden empty task and reaches its heading; selecting that heading reveals its row and Down enters it; after writing/reopening, Down from the written task reaches Events, skipping hidden rows.
- Added a targeted **1280/390 layout-boundary test**: explicitly hide Top 3's empty template row using `display:none`, then click its filled task directly and press Down. Selection reaches the Other heading, and the hidden row remains without a layout box. This deliberately imposed visibility condition tests the exact skip algorithm; it is not described as a natural user reproduction.

Logs/scripts: `tests/evidence/ratchet-stray-line-115/`. The ordinary and natural past-day scripts are reviewer-port adaptations of the author's harness; the wrapped/composition and explicit-visibility tests are additional scenarios.

## Evidence correction

My initial 18b9812 check observed Down entering the Top 3 empty row, but did not first assert that this row was still hidden. The editor's initial selection can reveal Top 3 before the click, as the author pointed out. I corrected that attribution: the observation alone was not proof of entering a hidden row. Final checks assert layout visibility before/after the explicit Top 3 boundary case and separately exercise naturally hidden Other rows and heading-triggered reveal. No invalid fixture-precondition run is counted as a product failure or passing check.

## Code assessment and limits

The gap-cursor extension is disabled while task/checklist edge navigation is supplied by the custom plugin. The plugin acts only for collapsed text selections at a visual-line boundary, when entering or leaving a task/checklist, and defers for modifiers, composition and menus. The follow-up searches past targets with no layout box before resolving horizontal placement. There is no CSS or node-schema change.

Jazz separately checked the ordinary sequence in Chromium and WebKit, including phone width (5f4a4770). Lead independently reported alignment **310 pass, 0 fail, 0 missing** on 5af3522 (ebe1a310). These are attributed checks, not my own WebKit/alignment runs. Real iPhone and real IME composition remain unverified. The existing Delete-merges-section and Undo-restores-custom-role defect is owned by the separate Delete fix and is not claimed resolved here.
