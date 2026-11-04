# PR118 independent review

Candidate `ffb54ade`; Ratchet, 2026-11-04. **Changes requested: reject a destination inside any row being moved.**

## Confirmed invalid hierarchy

1. In database From, create Root with sub-item Kid.
2. Create a database Nested as a page inside Kid.
3. Move Root to Nested.

The command accepts the move and now moves Kid with Root. It leaves `Kid.parentId = Nested` and `Nested.parentId = Kid`: a cycle in the page hierarchy. One Undo restores the original pages, but the invalid move should never commit. The picker offers Nested and the built app reports successful movement in Chromium and WebKit. This is a structural integrity defect; this review does not claim demonstrated word loss.

The older single-row move also appears to lack an own-descendant guard on code reading; the new tree move additionally requires checking page descendants of **every** row in the moving tree. The guard belongs in the command, and the picker should omit those targets. Roadbuster accepted this finding and owns the fix.

Reproductions: `tests/evidence/ratchet-move-tree/cycle.ts` (domain), `cycle.mjs` plus `nested.ts` (built browser), and corresponding logs.

## Independent boundary evidence

`limits.ts` uses invented fixtures and real domain commands:

- A depth-50 tree, including a Trash row, moves and one Undo restores the exact original pages, with sub-items initially enabled or disabled in the destination.
- An existing target configuration is reused, including its relation IDs.
- A three-row tree reaches exactly 10,000 live destination rows and one Undo restores all rows.
- At 10,001 the move refuses, leaving the entire input workspace unchanged.
- A stale child title command with the old database ID refuses without changing state.

Build and typecheck passed. Local suite: 711 passed, 0 failed, 6 skipped (real Postgres not configured here).

Browser work uses only an invented SQLite store on port 3698. The author move-tree scenarios pass in Chromium and WebKit: parent move and toggles, one Undo, moving a sub-item alone, a stale tab's child edit, and the 390px sheet. Worker/real Postgres gating belongs to Lead; this report makes no independent claim for those environments or a physical phone.

No product code changed by this reviewer. Final browser results and logs are stored alongside the reproductions.
