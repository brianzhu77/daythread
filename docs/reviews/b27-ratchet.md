# B27 implementation review

PASS 733840c for independent domain/browser acceptance. Both confirmed defects below are fixed and independently rechecked. Roadbuster's real Chinese-keyboard Simulator acceptance remains a separate pending gate; this report makes no native iOS claim.

## Final checks on 733840c

- Original actual-clipboard reproduction now saves a fresh copied eventId.
- clipboard-matrix.mjs independently checks native inline Copy → fresh id, Cut → paste back → same exact id, then reload → same exact id in WebKit and Chromium. It reads all real clipboard MIME payloads synchronously and asserts the target node, rather than checking whether any unrelated id remains.
- undo-matrix.mjs: WebKit/Chromium × 0/300 ms after a ready reading. One native ⌘Z restores exactly `undo check @Nov 20`, all four cases. Original 300ms repro is therefore fixed. Waiting for the reading is condition-based, with no deliberate extra delay in the zero-ms case.
- Full picker-check on fresh separate SQLite stores: WebKit390 and Chromium1280 pass, including ordinary text, placeholder Return, Chinese trigger, task row, inline clipboard and future view. No page errors. Separate future-read check verifies visible event, Create page still offered, no future page stored and zero POST requests.
- Suite 500 passing, 0 failing (11 skipped, 4 todo); typecheck clean. Combined source verified: getDayView.events delegates to dayEvents, and rows use that same function; future state and strip use the day view.
- Chip-event unit coverage independently passes for Bring's copied document id, newest complete holder, fallback after holder deletion, trash/restore, duplicate holder identity, to-do dates and malformed chips. Date-chip/parser suite independently passes.

No app changes by reviewer. Browser servers3640/3642/3644 and stores /tmp/ratchet218-* are disposable. No user live data writes. Full-fixture alignment, real iOS, production build and broad keyboard layout regressions were not rerun by reviewer; Lead's integration gate and Roadbuster's native run own those checks.

Harness corrections: an initial empty line assertion saw its normal newline; a broad menu selector matched both wrapper and child; an initial reset shortcut selected the wrong range. Corrected matrix resets its fixture per case and checks an initially empty target and a real date chip before Undo. These failed harness attempts are excluded from product findings.

## Historical findings on 438a3ff (superseded)

Ordinary inline copy/paste retained event identity.

A selection confined to one parent returns early from copyBlocks (page-editor.tsx), leaving BlockNote's default clipboard path. Its text/html contains dateMention with data-event-id. The custom paste freshContent remaps ids only when application/x-daythread-blocks is present; this path has blocknote/html, text/html and text/plain instead. The default paste preserves the id.

Independently reproduced in Chromium on a disposable SQLite store, server3640. tests/evidence/ratchet-b27/seed.ts creates the source line. inline-copy.mjs selects that line's inline contents, triggers native browser Copy, reads the actual ClipboardEvent payload synchronously, and pastes its HTML/text at another line. Two date chips render and save, both eventId ratchet-copy. chipEvents therefore returns one event, contrary to the accepted rule that a copied line makes a separate event. Preserve identity only for cut/move; remap copied inline chips in the default/HTML clipboard path too. Re-run with inline Copy, inline Cut, custom block Copy/Cut, and reload.

The eleven authored chip-events tests independently pass, including Bring, complete newest-holder selection, combined day view, trash/restore and to-do date preservation. Date-parser checks were not run in that invocation because the guessed filename tests/date-reading.test.ts does not exist; no parser-pass claim is made. Remaining browser/native acceptance is pending the revision.

## Additional independent checks

Date-chip/parser suite: 9 tests pass independently. WebKit390 picker-check passes all cases on the disposable store after explicitly adding its required template rows; an initial run without that fixture prerequisite timed out before any interaction and is excluded.

Second finding (plan §5): undo-chip.mjs types `undo check @Nov 20`, waits 300ms, chooses via Return and presses native ⌘Z. The entire line is undone to empty. A 1000ms wait before Return gives the expected raw query back. The conversion merges with the recent typing history; isolate it if Undo is to remove only conversion as specified. No authored content is permanently lost (Redo exists); this is a history-boundary contract issue.

Lead26ea2918 supersedes the earlier inline-copy timebox: B27 must not ship with that gap. Existing UI cannot edit a chip date in place; the ordinary directly reachable failure is copy + rename a different appointment on the same date. Divergent dates with reused ids require other document history/conflict paths; do not imply a date-edit UI exists.
