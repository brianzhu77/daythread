# Chart: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
- Asked by the Lead (3f046122). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [charts](https://www.notion.com/help/charts), which I read but haven't used. That page doesn't describe the phone beyond export. His use: no databases at the last read (Nov 2), so the examples are illustrations.

## 1. The idea

A chart is **one more layout of a view**, like Board or Gallery: same rows, same filter, read-only. "Books finished per month." "Hours by project."

- **Made from** `+ Add view` → Chart, or `⋯` → Layout.
- **On a day page,** it's a linked view with the Chart layout, so a template can carry one and "this page's day" filters it. `/` stays one Database item (the Lead's frame), with `chart` added as an alias that leads to it.
- **No new block type and no change to stored rows:** `layout` gains `chart`, plus a chart settings field. An older tab should draw it as a table and keep its fields, as with List and Calendar. To be run at release.

## 2. Forms

Notion's five: **Vertical bar, Horizontal bar, Line, Donut, Number.** Number is one big value and its label. It's the simplest and suits a day page ("12 runs this month").

## 3. Settings, in `⋯` → Layout

| Setting | Bar and line | Donut | Number |
| --- | --- | --- | --- |
| **What to show** | The property along the axis (X) | Each slice represents | n/a |
| **Measure** | Count, or a Number property with Sum, Average, Median, Min, Max or Range; Cumulative on a sorted axis | same, with no Cumulative | same |
| **Group by** | Optional second property | n/a | n/a |
| **Sort by** | Axis order or value | Value | n/a |
| **Visible groups** | Hide values, as Group's Hidden | same | n/a |
| **Style** | Height, grid lines, labels on or off, legend | Value in the centre | n/a |

- **The first time,** like Board's "Columns come from": it asks for What to show, listing the properties it can use, and defaults Measure to Count.
- **What can be charted,** following Notion: not Button, ID, Files, Rollup or a list-output Formula. A date axis groups by day, week (from his Week starts setting, R3-20), month or year, and shows every period between the first and the last. **A period with no numbers depends on the Measure (corrected 2026-11-05, Jazz 60daebcf, as #162 is built):** Count draws zero, as nothing was counted. Sum and the rest have no value, so a line breaks and a bar is absent, because a blank isn't a zero (§6). Cumulative carries its running total flat. A line never joins across a gap.
- **Same numbers as everywhere:** the view's filter applies, and Sum and the rest match column calculations (R3-8) on the same rows.

## 4. Colour (Jazz's call, fb7d3274, reading only, not prototyped)

His rule is black, white and grey (116a40ab), and options have no colour (`databases.md` §6.1). That's fine for a single series, which is most charts here. A grouped chart is where it pinches.

I ran the dataviz skill's palette validator on four greys, `#111111, #555555, #8a8a8a, #bdbdbd`, in light mode:

- Adjacent pairs are distinguishable, including for colour-blind readers (worst ΔE 16.5, target 8).
- It flags low contrast on the lightest (1.83:1), which obliges visible labels or a table. It also fails its lightness band and chroma floor, because those checks expect hues. That's the validator's standard, not a finding that greys don't work.

**The rule:**

- **Up to 4 greys, from the app's tokens** (`--ink`, `--ink-2`, `--ink-3` and a lighter grey, not hex), so a chart follows the theme.
- **A grey follows a value's order, not its size:** a Select or Status uses its option order, and other values their sorted order. A filter never repaints a value. A new value that sorts earlier can, among values with no options, and that's accepted.
- **Beyond 4 values:** the rest fold into "Other", which a tap opens, with the whole list in the table below. It's drawn as an outline with no fill, not a fifth grey, so it can't be mistaken for a value. Nothing's missing, though Notion would draw up to 50.
- **Tap to focus:** tapping a series or legend entry dims the rest, since greys are hardest to follow on a line chart.
- **Always:** a legend for 2 or more series, direct labels where they fit, and a 2 px gap between fills. A donut's lightest slice needs its label outside.
- **No two y-axes,** ever.
- **If he later wants colour:** it's the per-option setting §6.1 already allows, and charts read it. No separate chart palette.

The dark theme, if used, gets its own selected greys and its own check.

## 5. Reading a chart

- **At 1280:** hover shows the value and its label. A click on a bar, slice or point opens that group's rows below the chart.
- **At 390:** a tap does both. Full width, no sideways scroll, and axis labels thin out rather than overlap. Horizontal bars suit long option names on a phone.
- **The rows it opens** are a plain table, read-only, as in Notion, and a row opens as a page. Notion's "Save as view in" is included.
- **A table of the data** is one tap away at both widths, so no number is only in a shape.
- **Export:** copy or download PNG or SVG, in its own `⋯`. Works in the Home Screen app, or says why not.

No editing from a chart, as Notion.

## 6. States

| State | He sees |
| --- | --- |
| No rows, or none after the filter | The axes and "No rows", with the filter chips |
| Its property deleted or changed to one it can't use | "Choose what to show", as a board's "Group by" link. Undo or changing the type back restores it |
| A Measure with blanks | Blanks don't count as zero, except in Count |
| Rows beyond the cap | Counted in full: a chart shows the whole result, not the first 25 |
| A row change elsewhere | Updates without a reload |
| A very large database | Stated limit and a clear refusal, not a stall. Notion's limit is 200 groups and 50 subgroups |

## 7. For Roadbuster and Jazz

- **Drawing:** we have no chart library. I'd start with hand-drawn SVG, since these five forms are simple and a day page's budget is tight (R2-7), and load it only when a chart is on screen. Prove me wrong if labels and axes get expensive.
- **Where the numbers are computed:** ideally one function shared with Group and R3-8. A chart over all rows must not make R2-7 worse on a day page.
- **Alignment gate:** the title and chevron as other layouts. The plot itself needs a screenshot check.

## 8. Release order, within Chart

Vertical and horizontal bars and Number first, since they prove the settings and the rows it opens. Then Line and Donut. Then Group by and Other. Then Export and Save as view. All in scope.

## 9. Checks before release

- A chart's total matches a table with the same filter, on a copy of his real data.
- Week groups move with Week starts.
- A value keeps its grey when a filter changes.
- A template with a chart: each new day shows that day's rows, and R2-6 and R2-7 hold.
- A tap on a phone in the Home Screen app raises no keyboard.
- An older tab keeps `layout` and chart settings, with a rollback run.
- Looked at by eye at both widths, since no gate checks label collisions.
