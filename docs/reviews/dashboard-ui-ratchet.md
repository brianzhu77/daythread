# Dashboard step 1 independent UI checks

Candidate ae7e3bca; shipping dependencies; built locally, served on an isolated synthetic SQLite store. No user data, model calls or deployed writes. Both Chromium and WebKit at 1280×900.

## Confirmed findings

1. **Width has no live preview at a snap.** Drag a 1/2 + 1/2 split to 1/3 + 2/3. The badge correctly reads that split, but the first widget remains 450px during the drag and changes to 300px only on release. `SplitHandle` updates only badge state; §5 requires each snap to show at once. Same result in both engines.
2. **Escape exits edit mode but release commits the height drag.** Hold the height handle, move it 80px, press Escape, then release. Edit mode ends, yet height saves: Chromium320→400px, WebKit400→480px (same isolated store, sequential runs). Reload retains the change. Cancel the active resize and its document listeners, restore the preview, and prevent late pointer-up from committing after cancel/unmount. Same handler pattern needs cancellation coverage for width too.

`tests/evidence/dashboard/ratchet-handles.mjs` reproduces both: two positive released-width checks and two no-page-error checks pass; six assertions fail (width preview, height cancellation, post-reload cancellation, in each engine). The script uses authored synthetic `seed.ts`; it never reads a real account.

## Boundaries

This is a focused failure-path run, not the complete G6-1/G6-2 acceptance suite. Source review found host/block/widget routing keys scoped correctly; only full database pages render widgets, inline dashboard blocks render links, so the former proposed same-page twin-dashboard-widget case does not exist (Roadbuster d87020df, Product4136027f).

I duplicated a Runs widget through the menu on the local store. A follow-up shared-row-edit probe was inconclusive: clicking the Stage cell's center after horizontal scrolling was intercepted by the sticky title/Open control in a narrow widget. I do not classify that probe as a proven product defect or a passed row-edit check. No browser evidence for filter persistence/shared-row updates, floor rollback, native phone, actual two-tab sync or performance in this report. Author's row-gutter + and Tab-order work remains incomplete at this candidate.

Product9481aa6f clarified G6-2: the first Escape cancels the active resize, restores preview, saves nothing, and **keeps edit mode open**; a second Escape leaves edit mode. The saved fixture now checks that sequence explicitly for the repair rerun. Those additional assertions were not part of the original executed run above.
