# Conditional colour: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **§1 decided by the Lead (c3eb70ca); the rest for Jazz to review**. Not prototyped and not built. Task #287, checklist R4-12.
- **Evidence, all weak:** I found no Notion help page for it. Two third-party guides are the source: [Thomas Frank][f] (undated, its images suggest August 2025) and [Matthias Frank][m] (undated, later). They disagree on property types (§2). A third, [sparxno][s], appears in search results saying a table can colour a whole row or one property. I couldn't open that page, so that claim comes from a search summary. I haven't used the feature.
- **Brian's use:** no databases at the last read (Nov 3, rev 793).

## 1. Which colours: tints, each new rule starting grey (Lead c3eb70ca, not to Brian)

Brian's rule is black, white and grey (116a40ab), and options have no colour here (`databases.md`, "No colour"). R4-12 says the look holds "outside the rule's own colour". A rule is colour Brian asked for on that view, like a page cover or a formula's `style`.

| Option | For | Against |
| --- | --- | --- |
| **A. Notion's palette, one tint per rule, with grey as the default (recommended)** | The point of the feature is telling states apart at a glance, and a Notion user expects red for overdue. No view changes until Brian makes a rule | Colour exists in the app's views |
| B. Greys only | Keeps the rule without any exception | Two or three greys on tinted rows are hard to tell apart, the problem `chart.md` §4 already works around. It isn't the Notion feature |

**With A:** a new rule starts grey, so choosing colour takes a deliberate tap. No view, template or default ever ships with a colour. It's reversible, since a rule's colour is one field, and no view changes until Brian acts.

**Tints (Jazz 96d52959):** Formula's nine, opaque and already at 4.5:1 with `--ink` in both themes, named `--tint-red` and so on (`tokens.md` rule 1), so the app has one palette. Text stays `--ink`. Colour never replaces a value, because the value that matched is still in its cell.

**The grey needs its own step.** Formula's grey tint is `--gray-3` in both themes (#f0f0f0, #222222), which is also `--fill` and `--fill-hover`. Every new rule starts grey, so a rule's first look would be a row that seems to be hovered. A rule's grey is `--gray-4`, a step past that fill (Jazz 3260cc24); Formula's stays. The other eight are Formula's.

**Other text on a tint:** the script also checks `--ink-2`, and a formula's `style` colours in a tinted row. `--ink-2` clears 4.5:1 on all nine in both themes. A formula's colours all clear it in dark, and 6 of 81 pairs fall short in light, all on the grey, the lowest at 4.37:1; left as they are (Jazz 3260cc24, Bumblebee yes). `--ink-3` falls to 2.71:1 on the grey in light, against about 3.3:1 on white, so a tinted row should use `--ink-2` for it.

## 2. A rule

From `⋯` → Layout → Conditional colour, per view, so each linked view has its own (both guides).

- **A rule is one filter rule plus a colour.** It reuses R3-4's rule builder and its operators, so "Date is before today" means the same in both places, and it re-evaluates at midnight as a filter does. The guides describe one property per rule.
- **Several rules, the highest that matches wins** (Thomas Frank), reordered by drag. A row takes one colour, never a blend.
- **Which properties:** anything a filter can read. Thomas Frank excludes Relation, Rollup and Formula, and Matthias Frank says they've since been added. I take the later one, as it's also the better feature. Formula arrives first (#288), so a rule on it is ready by then.
- **No "Match Option":** Notion can use a Select option's own colour. Ours have none, so a rule always names its tint. If options ever gain colour, this gains the switch.
- **A rule that can't be read** (its property deleted): it matches nothing and shows as broken in the list, as a filter rule does. It's never deleted quietly.

## 3. What gets coloured

| Layout | Coloured |
| --- | --- |
| Table | The whole row, or only the rule's property (a choice per rule, on the weak source above) |
| List, Board, Gallery, Calendar | The row or card |
| Timeline | The bar |
| Chart, Form | Never (Thomas Frank) |
| Feed | As Thomas Frank lists it, once Feed exists |

**The phone:** same colours, and the rule list in a sheet. Thomas Frank doesn't mention the phone, and I'd rather not have a view that reads differently at 390.

**To-dos views:** allowed. It's display only, and it changes nothing on a to-do (§11, R4-14).

## 4. Where it meets other states (for Jazz and the gate)

- **Frozen columns (R4-13):** a sticky cell needs an opaque background, so a tint has to be composed over the row's base. A translucent token would show the columns scrolling under it. **#287 builds both, so build them together.**
- **Selected rows (§12), hover, the row just returned to, a dragged card:** these must still read on a tint. My proposal is that they keep their own treatment drawn over it, with the outline as the signal, not another fill.
- **Wrapped rows (R3-14), groups and folds:** the tint fills the row's full height. Group heads and the foot's calculations are never coloured.
- **Rows in Trash, a kept row after a filter change:** the rule is read from the row's current values, with no memory.
- **CSV (R4-7):** colour isn't exported. Old tabs keep the view's field when saving (R4-15).

## 5. Cost

Rules are evaluated per row per view, as filters are. **R2-7's budget gets a variant with 10 rules on a full table,** measured on the Worker. A workspace with no rules pays nothing. I've no limit from Notion on the number of rules, so ours has none unless that measurement asks for one.

## 6. Open

- **Settled with Jazz (96d52959):** the tints, §1. §4's stacking as proposed: a picked row, a hover and a returned row keep their own treatment drawn over the tint, and a dragged row keeps its fade. "Whole row or only this property" stays per rule, default whole row. It's on a weak source and easy to take out.

[f]: https://thomasjfrank.com/notion-conditional-color-formatting-everything-you-need-to-know/
[m]: https://matthiasfrank.de/en/notion-updates/conditional-color-upgrade/
[s]: https://sparxno.com/blog/notion-conditional-color
