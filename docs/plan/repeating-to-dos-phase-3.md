# Repeating to-dos, phase 3 (around the screen): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The export says a repeating to-do's rule on its line, and To-dos views offer a read-only Repeat column.

**Architecture:** Two read-only additions on top of phase 1's `repeatOf` and `repeatWords`. Nothing is stored, no
command changes.

**Tech Stack:** TypeScript run by Node 24 type stripping, `node:test`.

**Spec:** `docs/design/repeating-to-dos.md` §4 ("Export") and §6 (phase 3).

## Global Constraints

- English only. No new dependency. Erasable TypeScript; value imports carry `.ts` in files a test reaches.
- A to-do with no repeat exports and reads exactly as today: the whole existing suite stays green and untouched.
- Copy is exact: the export's ` · Repeats every week` (U+00B7), after ` · Blocked by …` when both apply; the column is
  named `Repeat` and its cell reads `Every week` (the rule's words with a capital).
- `tests/todo-repeats-around.test.ts` was written first. Never change an asserted value in it to make it pass.
- Run as CI does: `TZ=America/Vancouver node --test <file>`. One commit. Do not push. Do not open a PR.

## Review Focus

1. A finished to-do, and a repeat whose to-do is gone, export and read with no rule (tested).
2. The Repeat column must not become editable through any path that edits a To-dos cell: `todoChange` refuses or
   ignores it (tested), and it is not among the bar's columns (`todoBarColumns`).
3. A view that filters, sorts or groups by the Repeat column works as any text column does (not tested: say in the
   report what the code does).

### Task 1: The export line and the Repeat column

**Files:**
- Modify: `src/domain/export.ts` (the to-do line, about line 121; the export's own description, about line 247)
- Modify: `src/domain/todos-source.ts` (the property list and `offered`, about lines 26-44; the row's values, about line 74)
- Modify: `docs/design/repeating-to-dos.md` (status line: all three phases built)
- Test: `tests/todo-repeats-around.test.ts` (exists, 2 tests, failing)

**Interfaces:**
- Consumes: `repeatOf(ws, taskId)` and `repeatWords(rule)` from `src/domain/todo-repeats.ts`. `repeatOf` returns a
  repeat only for a to-do that exists; the rule shows only while that to-do is open.
- Produces: `export const repeatColumn = 'repeat'` in `todos-source.ts`.

- [ ] **Step 1: Run the tests, see them fail.** `TZ=America/Vancouver node --test tests/todo-repeats-around.test.ts`
- [ ] **Step 2: The export.** On a to-do's line, after the Blocked by part, add `` ` · Repeats ${repeatWords(repeat)}` ``
  when the to-do is open and is a repeat's current one. In the export's description, after the sentence about
  `· Blocked by`, add: ``A repeating one ends with `· Repeats` and its rule.``
- [ ] **Step 3: The column.** A property `{ id: repeatColumn, name: 'Repeat', type: 'text', readOnly: true }` after
  `Blocking`; in `offered`, so the first view does not show it; the row's value is the rule's words with a capital
  first letter, set only for an open current to-do. `todoChange` changes nothing for it.
- [ ] **Step 4: The design doc's status line** reads: `approved by Brian 2026-11-24. Phases 1, 2 and 3 built.`
- [ ] **Step 5: Run.** The file passes. Then
  `TZ=America/Vancouver node --test tests/task-links.test.ts tests/todos-source.test.ts tests/todo-rules.test.ts tests/todo-repeats.test.ts`,
  `npm run typecheck`, and the whole suite once: `TZ=America/Vancouver FUTURE_DAYS_CONTRACT=1 npm test` (0 fail).
- [ ] **Step 6: Commit.** `feat(repeats): the export says the rule, and To-dos views offer a Repeat column`
