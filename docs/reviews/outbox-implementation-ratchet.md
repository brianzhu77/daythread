# B98 implementation review (in progress)

Layer 1 initially reviewed at 816331ca. Browser and UX layers and the final PR are not yet reviewed.

## Confirmed findings

1. **First replay after rollback could overwrite an unstamped older-build write.** Both stores checked stored tracking before noticing the gap during their next commit. The existing contract test inserted a new-build command before replay, hiding the first-request window. Reviewer probes fail on both SQLite and PGlite at 816331ca. Author fixed at 5d55adcd; both independent gap probes now pass.
2. **A future base revision is accepted.** When baseRevision exceeds the locked server revision, the rule selects row-based application. All row revisions look older, so the command applies. An entry surviving a database snapshot restore must instead be held. Both reviewer probes still fail at 5d55adcd; reported as be59522b.

Independent executable repros: `node --test tests/ratchet-outbox-layer1.test.ts`. They directly simulate an older build changing a task and its workspace revision without stamping it, then make the first outbox request; the other case sends an entry whose basis is ahead of the restored server state. All data is throwaway. No runtime fixes made by the reviewer.

The signed design remains e1c37bef. These implementation findings do not authorize a release or production migration.
