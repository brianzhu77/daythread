# BlockNote spike independent evidence review

Ratchet · task #31 · 2026-10-17 UTC. Reviewed spike/blocknote b783c12 and report-only correction 51deaa9 in `/Users/dogrod/Developer/daythread-blocknote-spike`. Nothing from this branch is approved for merging into the app.

## Confirmed within a disposable browser fixture

Independently reran the submitted assertion probes on actual Start `/spike` at 3115. Copies of the probes used the same assertions and package versions, with only the package import made absolute; cwd/output was `/tmp/ratchet-spike-review` so author evidence was not overwritten.

- `adapter-probe.mjs`: passed semantic whole-row delete + synchronized in-memory Undo, stale semantic Undo rejecting both sides, unrelated typing Undo not restoring a paused Task, actual click on atomic row selector followed by Backspace/Undo/Redo, mixed text selection preserving Placements, rich JSON with stable IDs surviving a fresh editor mount, and no page errors. The initial inline row uses a programmatically forced NodeSelection; the separate atomic row has an actual clicked selection affordance. These are distinct evidence strengths, correctly called out in the report.
- `clipboard-probe.mjs`, headed Chromium: passed native copy followed by two pastes. New presentation IDs, same Task A, fixture Task count unchanged and no new commitment/pause. The custom paste bridge is enabled; this does not validate BlockNote's unmodified default paste.
- `SPIKE_CUT=1 node clipboard-probe.mjs`: passed native cut plus two pastes with the same identity and placement invariants. These tests use Chromium's real clipboard events, but the Task selection is initialized via the fixture's helper and is not a touch selection test.
- Read the adapter implementation: semantic effects are gated by pre-selection, explicit delete key and plan role. The observed mixed selection has one deleted block *and* one updated block, supporting the report's rejection of delete-count-only classification.

The above prove narrow in-memory behavior and editor mount, not database atomicity, full user interaction acceptance or real input-device behavior. Original 35 app tests do not exercise this editor and must not be cited as editor coverage.

## Evidence defect, now corrected

The b783c12 report claimed actual pointer drag into Notes passed, citing `headed-pointer-drag-notes.json`. Independently inspected that exact committed file: no drop event, no move change, task-a remains in original document order, adapter=false. `pointer-drag-notes.json` also has no completed move. This did not support the claim. Reported to Wheeljack; he withdrew it (57ab63d9) and committed 51deaa9, moving actual pointer drop to **unconfirmed**. Read the corrected report. No new drag experiment was run, respecting the current stop on further Placement/section work. Programmatic API move is separate evidence and does not substitute for pointer/touch drag.

## Still unverified / not cleared

- Actual pointer or touch drop, especially across section boundaries; Placement section/order + presentation changes in one checked command.
- Multi-operation history, multiple semantic deletes, reorders, remote changes and redo conflicts beyond the narrow tested sequences.
- Persistent atomic saves, process/network failure, recovery buffer, reconciliation and explicit retry; the mutation inside a pre-change filter can diverge if a later filter rejects or a save fails.
- Real iPhone/Safari, hardware IME/composition, native selection/menu/clipboard and virtual keyboard.
- Production page conversion/migration, large documents/performance and live workspace/provider behavior.

Conclusion: the corrected report is evidence-consistent and supports **BlockNote as a candidate for later validation**, with no production-editor go decision. The open gates remain open. Brian's latest day-thread/pages clarification may change the adapter model; this review does not guess those choices or authorize further integration. No remaining report-blocking discrepancy after 51deaa9.
