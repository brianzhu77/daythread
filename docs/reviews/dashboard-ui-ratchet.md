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

## Retest 5f6f003f

Both reported resize failures are repaired in independently built Chromium and WebKit runs on a new synthetic store. All 14 handle assertions pass, including live width preview, normal release, first Escape keeping edit mode, second Escape leaving it, unchanged cancelled height and reload persistence. Added `ratchet-cancel.mjs`: eight assertions pass across both engines for width-Escape restoration/persistence, SPA navigation unmounting an active height handle before release with no late save, and no page errors.

Source review: `useHandleDrag` removes document move/up/Escape listeners on release, Escape and unmount; cancellation restores preview without a command. The shared lift change introduces an optional ancestor-class wrapper only for callers supplying context; other lift callers keep the previous path. Existing non-dashboard drag flows were not independently rerun here.

I also executed the author's `floor.ts` against an **own checkout of actual floor9417eea2 code** and an isolated synthetic SQLite store: **7/7 pass**. Floor commands rename the dashboard and its own filter, a source property and an unrelated page. New code reads back widths4/8, row height400, widget filters and reserved dashboard.filter unchanged. This is SQLite data compatibility, not a floor browser or Worker/Postgres check.

This clears my two resize findings on this candidate. It does not clear the whole step for release: Jazz's newly accepted three-widget full-row resize contract still needs implementation and review, the floor browser run remains separate, and this report does not replace the full acceptance/performance gates.

## PR204 delta review: 4e22306a

Independent new three-widget browser fixture `ratchet-three.mjs` passes **12/12** across Chromium and WebKit: keyboard grows left/middle through equal widths, pointer previews all three widths with the full badge, Escape restores all three, and reload confirms no cancelled write. The saved two-widget handle/cancel suites also pass again (**22/22**) on this candidate. These runs use an isolated synthetic store and built app at1280.

Actual floor9417eea2 SQLite data fixture was rerun with the new command shape: **7/7 pass**. No independent floor browser or Worker/Postgres run. Author reports floor browser separately. Shared lift's optional context path was source-reviewed; non-dashboard drag regressions belong to Lead's broader gate.

The reviewed resize/storage code is clear. This is not acceptance of unfinished G6-2 controls: row-gutter + and specified Tab order are listed gaps. G6-7 speed measurement (12widgets) remains required before release; no speed measurement was made by this reviewer. G6-4 browser Trash/hard deletion and whole-dashboard removal were requested separately by Product and are not covered by these focused runs.
