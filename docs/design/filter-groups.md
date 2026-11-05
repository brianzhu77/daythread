# Nested filter groups: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **approved (Lead 63c58195), with the Lead's decisions in the checklist's D8: the Lead builds it on `feat/filter-groups`, and Jazz and Ratchet read §2 and §4.** Not built.
- Asked by the Lead (3f046122, b9af4ec7). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts), which gives groups mixing "and" and "or", nested up to three layers, and "Add to advanced filter". It doesn't cover how chips look or the phone, so those are my proposal. **Builds on** R3-4 (`View.filterAny`, live 2026-11-03).

## 1. The idea

R3-4 gives one level: all rules or any rule. A group answers the next question: "Status is Reading **and** (Rating is 5 **or** Tag contains Favourite)".

## 2. What he sees

**In the Filter sheet,** below the rules:

```
Show rows where: all rules match ⌄
  Status  is  Reading                ⋯
  ┌ any rule matches ⌄             ⋯
  │ Rating  is  5                    ⋯
  │ Tag  contains  Favourite         ⋯
  │ + Add rule
  └
+ Add rule    + Add group
```

- **`+ Add group`** at the top level and inside a group, up to three layers, as Notion. It goes away at the third.
- **A rule's `×` stays, and its `⋯` holds only the moves (Jazz 35291f4c):** "Move into a new group" (not at the third layer), "Move in with Rating is 5" for each group beside it, and "Move out of this group". They open in place, as a menu over a scrolling sheet would be cut off, and Esc shuts them and leaves the sheet.
- **A group's `⋯`:** "Move rules out", and "Remove group and its 2 rules", which says so with an Undo.
- **The sheet is 360 wide at 1280 (Jazz),** so a third-layer condition still reads "contains". `+ Add filter` keeps today's words, since it's the same action at any layer.
- **Each group has its own all/any,** the same control as R3-4.
- **At 390:** the same sheet, each layer indented by a small step with a line. Three layers must leave a value readable, so a rule wraps to two lines rather than scrolling sideways. Native check.

**On the view, chips can't show a tree.** With no groups, chips are as today. With a group, one chip: **"Status is Reading and 1 group"**, which opens the sheet. Rows filtered out are still counted as before.

## 3. Rules

- **A rule that can't be read** (property deleted, no value yet) doesn't count either way, as R3-4. A group with none left that count doesn't count either. So no deleted property can empty or fill the view.
- **An empty group** is ignored by the evaluator, and the sheet can't leave one (Jazz, Lead): `+ Add group` starts with a rule, and taking a group's last rule takes the group. So nothing is dropped on closing.
- **Removing the last group** returns to plain chips.
- **`+ New` (§7.4):** the row takes a value only where it's needed, and only one way, by walking the tree with R3-4's rule: the first single value that makes it show. If none does, it takes none, with §7.4's notice. A move on a board or calendar checks the same way.
- **Every place that reads a filter follows it:** every layout, calculations (R3-8), Chart, automations' "In a view", Dashboard, and CSV export of a view.
- **On To-dos** too, since it's a view filter, and "this page's day" works inside a group.
- **Undo, as filters behave today:** changing a rule offers none, so neither does a group's own all/any or a move. **Corrected (Lead, from Jazz 35291f4c):** I'd said one Undo for the sheet's edits, but filters have no Undo today. Removing a group, and Clear filter when the view has a group, take more than a rule's worth away, so they have a notice with Undo (Jazz aeb631bc). In a linked view that saves with its page, which has no notice.
- **At 20 rules** the two `+` buttons give way to one quiet line, "20 rules at most".

## 4. For Roadbuster

- **Storage:** today `filter: Condition[]` plus `filterAny`. I'd add an optional `filterGroups` tree and leave `filter` holding the top-level rules, so that a view with no groups doesn't change.
- **An older tab** ignores the tree and applies the top-level rules. **Corrected (Ratchet dbb79fa4; I had said it only shows more):** that shows more rows under a top-level "all", as a group no longer narrows them, and **fewer** under a top-level "any", as `Status = Reading or (Rating = 5)` hides a five-star row that isn't Reading. State both in the release. A `+ New` there can add a row that disappears when the new build opens it. The row still exists, but the old build can't say so, as it doesn't read the tree. It must keep the field when it saves, tested separately for an ordinary edit, Duplicate view and a linked view, as a reconstructed view may take another path. To be run with a rollback.
- **Duplicate view on an older build (run, Lead):** the original keeps its tree, and the copy has none, as the older command's shape doesn't know the field. The copy still applies the top-level rules.
- **One evaluator,** shared with `viewRows`, so there's no second copy for charts or automations.

## 5. Checks before release

- A table of cases over all, any and three layers, in unit tests, including rules that can't be read.
- The chip's words match the sheet.
- `+ New` under a group: takes a value when one clearly works, otherwise the notice.
- A chart and a calculation agree with the rows shown.
- Pinyin in a value at 390, with the sheet above the keyboard.
- An older tab keeps the tree, and a rollback restores it.
