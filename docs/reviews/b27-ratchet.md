# B27 implementation review

REVISE 438a3ff: ordinary inline copy/paste retains event identity.

A selection confined to one parent returns early from copyBlocks (page-editor.tsx), leaving BlockNote's default clipboard path. Its text/html contains dateMention with data-event-id. The custom paste freshContent remaps ids only when application/x-daythread-blocks is present; this path has blocknote/html, text/html and text/plain instead. The default paste preserves the id.

Independently reproduced in Chromium on a disposable SQLite store, server3640. tests/evidence/ratchet-b27/seed.ts creates the source line. inline-copy.mjs selects that line's inline contents, triggers native browser Copy, reads the actual ClipboardEvent payload synchronously, and pastes its HTML/text at another line. Two date chips render and save, both eventId ratchet-copy. chipEvents therefore returns one event, contrary to the accepted rule that a copied line makes a separate event. Preserve identity only for cut/move; remap copied inline chips in the default/HTML clipboard path too. Re-run with inline Copy, inline Cut, custom block Copy/Cut, and reload.

The eleven authored chip-events tests independently pass, including Bring, complete newest-holder selection, combined day view, trash/restore and to-do date preservation. Date-parser checks were not run in that invocation because the guessed filename tests/date-reading.test.ts does not exist; no parser-pass claim is made. Remaining browser/native acceptance is pending the revision.
