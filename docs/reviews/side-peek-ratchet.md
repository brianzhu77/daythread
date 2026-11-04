# PR121 independent review

Candidate `8dbcc0cb`; Ratchet, 2026-11-04. **Changes requested for navigation choosing the wrong view.** Local production build and invented SQLite data only, port 3698.

## Confirmed navigation defect

Put two views of the same database on one page, with different sorting. Open a row appearing in both from the first view, then click Next. The arrow follows the later view's order instead of the view clicked.

In the reproduction, the first view has `... ubik, blank, f1 ...`; the second has `ubik, blank, f30 ...`. Opening `blank` from the first and clicking Next opens `f30`, although `f1` is visibly next in the clicked view. Reproduced in Chromium and WebKit.

`drawnRows(rowId)` globally selects the last matching `[data-row]`, then finds its database block. A row ID cannot identify the originating view. Pass the actual view/block scope from the opening action, including for a view inside a peek. This also affects center peek, which shares the helper.

Reproduction: `tests/evidence/ratchet-side-peek/two-views.mjs`, `two-views.ts`, `side.ts`, logs. The initial harness selected Dune, which was outside the later view's drawn cap and correctly navigated; the final harness selects a row drawn in both with different successors.

## Independent checks

Build and typecheck passed; local suite: 709 passed, 0 failed, 5 skipped.

- Author side-peek baseline passes in Chromium and WebKit: grouped navigation, row replacement and one history entry, cell edit while the row body has typing, menus, Esc/Back, reload, and both resize floors.
- `replace.mjs`, Chromium and WebKit: hold the old row's save POST, replace it with another row, type in the new row before releasing. Both bodies save, the new row's text survives reload, and no runtime error occurs.
- `synced.mjs`, Chromium and WebKit: hold a host save, open its shared block in the peek and type there; also hold a peek save and type in the host while both remain open. Both versions survive, using the existing conflict-copy behavior where applicable; no runtime errors. This is a check of overlapping editing, not a claim that conflict copies never occur.

PR120's separate pending-action lock and destroyed-editor reply findings remain separate dependencies. This review does not clear those, nor claim a combined PR120/121 tree has passed. Worker/Postgres gating belongs to Lead. No physical phone/iPad run here.

No product changes by this reviewer. Scripts and final logs are in `tests/evidence/ratchet-side-peek/`.
