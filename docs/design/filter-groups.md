# Nested filter groups: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Jazz to review**. Not approved and not built.
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
- **A rule's `⋯`:** "Move into a group", as Notion's "Add to advanced filter", and Delete. A group's `⋯`: Remove group, and "Move rules out".
- **Each group has its own all/any,** the same control as R3-4.
- **At 390:** the same sheet, each layer indented by a small step with a line. Three layers must leave a value readable, so a rule wraps to two lines rather than scrolling sideways. Native check.

**On the view, chips can't show a tree.** With no groups, chips are as today. With a group, one chip: **"Status is Reading and 1 group"**, which opens the sheet. Rows filtered out are still counted as before.

## 3. Rules

- **A rule that can't be read** (property deleted, no value yet) doesn't count either way, as R3-4. A group with none left that count doesn't count either. So no deleted property can empty or fill the view.
- **An empty group** is ignored. On closing the sheet, it's dropped.
- **Removing the last group** returns to plain chips.
- **`+ New` (§7.4):** the row takes a value only where it's needed, and only one way, by walking the tree with R3-4's rule: the first single value that makes it show. If none does, it takes none, with §7.4's notice. A move on a board or calendar checks the same way.
- **Every place that reads a filter follows it:** every layout, calculations (R3-8), Chart, automations' "In a view", Dashboard, and CSV export of a view.
- **On To-dos** too, since it's a view filter, and "this page's day" works inside a group.
- **One Undo for the sheet's edits,** as filters behave today.

## 4. For Roadbuster

- **Storage:** today `filter: Condition[]` plus `filterAny`. I'd add an optional `filterGroups` tree and leave `filter` holding the top-level rules, so that a view with no groups doesn't change.
- **An older tab** ignores the tree and applies the top-level rules. So it shows **more** rows, unlike R3-4, which reads narrower. A `+ New` there could then add a row that's hidden on the new build. It's harmless, since the row still exists and "hidden by this view's filter" covers it, but state it in the release. It must keep the field when it saves. To be run with a rollback.
- **One evaluator,** shared with `viewRows`, so there's no second copy for charts or automations.

## 5. Checks before release

- A table of cases over all, any and three layers, in unit tests, including rules that can't be read.
- The chip's words match the sheet.
- `+ New` under a group: takes a value when one clearly works, otherwise the notice.
- A chart and a calculation agree with the rows shown.
- Pinyin in a value at 390, with the sheet above the keyboard.
- An older tab keeps the tree, and a rollback restores it.
