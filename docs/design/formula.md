# Formula: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead, Roadbuster and Jazz to review**. Not approved and not built.
- Asked by the Lead (66d5b7a1: carry on with design passes; I chose this one). Settles R4-3's open point. Nothing is cut for lack of evidence, and use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help pages on [formulas][f], [syntax and functions][s] and [common errors][e] (the last from a search result, not read in full). I read them; I haven't used Notion's editor. Those pages don't cover the phone, regular expression flavour, or time zones beyond one example, so those parts are my proposal.
- **Brian's use:** no databases at the last read (Nov 3, rev 793). Nothing here comes from watching Brian, so examples are illustrations.

## 1. The call: follow Notion's language, so a copied formula works

R4-3 left open how far to follow Notion. **I'd follow it all the way, in one language with no dialect of our own.** Someone who finds a formula in a Notion guide should be able to paste it. Our own language would be smaller to build and would cost that forever.

- **Both call forms:** `length("hello")` and `"hello".length()`.
- **Properties:** as tokens, and pasted text with `prop("Name")` or a bare `Name` resolves to them.
- **Stored by property id, shown by name,** so a rename changes nothing, and a deleted one reads as an error rather than a wrong value.
- **Walking relations:** `Tasks.length()`, `Parent.first().Status`, `Tasks.every(current.Status == "Done")`.
- **Our own evaluator only.** Nothing is ever run as code (R4-3).

## 2. What's in

| Group | Contents |
| --- | --- |
| **Built-ins** | `+ - * / %`, `== != > >= < <=`, `and or not` with `&& || !`, `true false`, `X ? Y : Z`. The page's table omits `/` and `!=`, but its examples use them |
| **Logic and text** | `if ifs empty length substring contains test match replace replaceAll lower upper repeat link style unstyle format trim split join` |
| **Numbers** | `add subtract multiply divide mod pow min max sum median mean abs round ceil floor sqrt cbrt exp ln log10 log2 sign pi e toNumber formatNumber` |
| **Dates** | `now today minute hour day date week month year dateAdd dateSubtract dateBetween dateRange dateStart dateEnd timestamp fromTimestamp formatDate parseDate` |
| **Lists** | `at first last slice concat sort reverse unique includes find findIndex filter some every map flat`, with `current` and `index` |
| **Other** | `id equal unequal let lets` |

**Not applicable:** `name` and `email`, because there's no Person type (`databases.md` §14, Not planned). A pasted formula using them shows the error, with the reason.

**Types, as Notion's:** Title, Text, Email, URL, Phone, ID and Select read as Text. Multi-select reads as a list of Text, Checkbox as Boolean, Date, Created and Edited as Date, Number as Number, Relation as a list of pages. A Rollup reads as its result. **Status isn't in the page's table, so I'd read it as Text,** like Select, which is how its `Status != "Done"` example reads. A relation to To-dos reads a task's Status, Planned, Start and Deadline (R3-23).

**Empty:** `0`, `""` and `[]` all count as empty, as Notion says, and `find` returns empty.

**Output:** text, number, checkbox, date or a list, including a list of pages, which draw as page refs.

## 3. What it does elsewhere

- **Read-only and never stored,** as a rollup is (`withLinks`, R3-7). A change in a value or a linked row shows without a reload. A row template or a duplicate has nothing to copy.
- **Filter, sort, calculations:** by output type, using one evaluator, so a cell and a filter can't disagree.
- **Group:** read-only groups by what it works out to, and a drag is refused with a notice, as Rollup groups are (R3-22). No Board, for the same reason.
- **Chart:** a list output can't be charted (`chart.md`).
- **Rollup of a formula: allowed,** counting as a layer (§5). Notion's pages show a formula over a rollup, and don't show this direction, so it's my proposal.
- **`+ New` in a view filtered on a formula:** nothing can be set to satisfy it, so it follows the existing rule for a row hidden by a filter.
- **Export and CSV:** the computed value (R4-3, R4-7).
- **To-dos:** can't have extra properties (§11), so no formula there.
- **Buttons and Automations:** Notion uses formulas in their actions, and `buttons.md` waits for this. They use the same evaluator, and come after this ships.

## 4. Writing one

- **Where:** Edit formula in the property menu. At 1280 a field on top, the list of properties and functions beside it, and a live preview of the current row when opened from a row, as Notion. At 390 a sheet above the keyboard, with the list one tap away.
- **The explanation of each function** shows only when one is selected in the list. It's a reference opened on request, so it doesn't break the rule against explanatory text (1ac6784b).
- **While typing,** the field says what's missing and what type is expected, as Notion's does. An unfinished formula can't be saved over a working one: Done is refused with the reason, and Cancel leaves the old one.
- **Pinyin (added, Notion's pages don't cover it):** the field doesn't react mid-composition. Full-width `（），“”` outside a string read as their half-width forms, because a Chinese keyboard produces them and the error would otherwise be invisible. Chinese property names work bare and in `prop()`.

## 5. Errors and limits

| Case | What happens |
| --- | --- |
| **A property is deleted or its type changes** | "Error" in `--red` in the cell, with the message in the property menu (`databases.md` §6.1). Undo of the delete brings it back. Never a crash, and never a wrong number |
| **A value that doesn't fit at one row** (an empty date in `dateAdd`) | That cell reads empty or "Error", with the others unaffected. Filters treat it as empty |
| **A loop** | Refused at Done, "Cycle detected", through formulas, rollups and relations across databases. It uses R3-7's cycle check, which was built to hold here |
| **Depth** | **15 layers,** Notion's stated limit: each formula or rollup referenced adds one, across databases. Refused at Done with the reason |
| **Too slow at one row (added)** | Regular expressions, `repeat` and nested `map` can be made to run for a very long time. Each row's evaluation has a step budget, and over it the cell shows "Error · too long" and the view stays usable. Regular expression flavour: JavaScript's, since Notion's page doesn't say. **For Roadbuster:** a budget doesn't interrupt a JavaScript regular expression, so this needs a linear engine or a pattern check |
| **`link` to something unsafe (added)** | Only `http` and `https` become links. `javascript:` and others show as text |

## 6. Dates and time

- **`now()` and `today()` use the same clock as the day pages,** the browser's, so `today()` and today's page agree. They refresh when the app opens, at midnight with the day page, and on any change, not every minute.
- **Stored dates read as written,** with the same zone rules as a Date property.
- **`day()` and `week()` follow Notion** (Monday = 1, ISO weeks) even though database views start the week on Sunday (R3-20), so a copied formula gives the same answer. This is the one place the two differ, and I'd accept it.

## 7. Styling

`style` takes Notion's `b u i c s`, its colours and `_background`, and `unstyle` removes them. The app's look is black, white and grey (Brian 116a40ab), but a colour here is one Brian typed. It applies inside the cell only and never to the row (conditional colour is R4-12).

## 8. Left out of this pass

Notion's AI writing or fixing a formula, a paid feature there. It would be a new model cost, so it would come to the Lead first and isn't designed here.

## 9. For Roadbuster and Jazz

- **Cost:** R4-3 holds a view of 100 rows to R3-7's bar. Sorting or filtering on a formula evaluates every row, and chained formulas multiply. Please say what's cached and where it's dropped. With no formula in a workspace, nothing changes (`withLinks`' rule).
- **Where it runs:** the browser for views, and wherever export runs. The Worker's CPU limit matters if that's the Worker.
- **Rollback:** a new property type, so like #80's: an older build shows the column empty and keeps the expression. Please run it.
- **A type change** to Formula and back keeps the old values, as R3-16. Please confirm.
- **Size:** yours. I'd expect the parser and types to be the main cost, and the function list long but simple.
- **Jazz:** the editor at both widths, tokens, and how errors read in a Board card and a list.

## 10. Release order, within Formula

1. The language over a row's own properties, with the editor, errors and the whole function list except lists over pages.
2. Walking relations, `current`, `let` and rollups in and out, with the cycle and depth checks. Filter, sort, Group and calculations by output type.
3. `style`, `link`, and then Buttons' and Automations' use of it.

## 11. Checks before release

Add to R4-3 when built:

- A table of every function, with Notion's own examples from its page as the expected results.
- `Parent.Sub-item.every(current.Status == "Done")` and `if(and(now() > Due, Status != "Done"), "Overdue", "")` give the right answers pasted as text.
- Rename a property: same result. Delete it: "Error", and Undo restores it.
- A loop across two databases is refused, and a chain of 16 is refused at the 16th.
- A pathological regular expression and `repeat` don't hang the tab at 390 in WebKit.
- A cell, a filter, a sum at the foot and the export all agree on the same row.
- `today()` changes at local midnight with the day page, with no reload.
- Pinyin in the field at 390, with the sheet above the keyboard.

[f]: https://www.notion.com/help/formulas
[s]: https://www.notion.com/help/formula-syntax
[e]: https://www.notion.com/help/common-formula-errors
