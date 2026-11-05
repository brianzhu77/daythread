# PR164 selected-word comments review

Candidate a8344d4e. One reproduced gap: backward selection spanning two lines falls back to the last line in document order, instead of the first as documented. Select from inside Second distinct line backwards to inside A line of notes; invoke Comment. The composer quotes Second distinct line. Both Chromium and WebKit reproduce it. selectedWords returns null for a cross-line selection, and commentOnSelection then uses getTextCursorPosition, whose BlockNote implementation reads selection.anchor rather than selection.from. Use the document-order first selected block for this fallback.

Independent fixture: node tests/evidence/comments/ratchet-crossline.mjs http://127.0.0.1:3726 /tmp/ratchet-selected.sqlite chromium (also webkit), with a server using that throwaway store.

Passed independently:
- Author words.mjs at 1280 in Chromium and WebKit: exact second repeated phrase, stored offset, unchanged document, reload, mismatch fallback retaining quote and line mark.
- ratchet-selected.mjs: real selectedWords with a synthetic ProseMirror schema in Chromium, emoji/Chinese UTF-16 positions, inline atom, formatted spans, backward within-line selection.
- ratchet-lifecycle.mjs in Chromium: Resolve removes underline, Reopen restores it, editor document remains unchanged.
- Existing comments tests: 10 pass (including PGlite storage).

No native Pinyin, real phone selection, real Postgres, Worker, performance or rollback execution in this review. Synthetic SQLite and synthetic documents only. The schema adds at inside the existing JSON anchor, rather than changing the editor document.
