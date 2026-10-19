# Page Step B — acceptance preflight

Task #72. Baseline cd3c494. This is an acceptance plan and storage preflight, not a pass on an implementation. Latest scope: Lead b56155fb and final clarification81ce1b0a (spec dd5e347), N-2/N-5/N-9; deletion/trash, URL-to-page/dedup and [[ input are deferred.

## Critical domain checks

1. Build day D plus A > B > C, another root X. Refuse moving A into A/B/C, moving a daily page, missing destination, and stale concurrent revision. Refusal changes no page, reference, task, placement or revision. Valid C→X/top level preserves C and descendant IDs, bodies and references, including editor metadata. Undo restores only the accepted move through the existing command contract; duplicate operation replay must not move twice.
2. Move a branch with descendants: subtree remains intact, no duplicate or disconnected pages; breadcrumb terminates at root or a daily parent. Queries must not recurse forever on malformed cycles/orphans. Do not silently repair persisted malformed data. Test at least a deep chain and duplicate page titles (identity is ID).
3. A child remains in Subpages after its body card is deleted/cut/bulk-deleted; moving it removes it from old Subpages and adds it once to the destination. Move must not manufacture a card or silently remove an existing one. Daily pages stay fixed and can have children. New children and moved-in pages append to the new parent’s children using existing pages ordering; no sibling ordering field or drag reorder in this slice. Same-parent move should have a defined no-op contract.
4. Compare tasks, versions, placements, events, material follow-up, captures and ledger before/after move: unchanged. Existing cards open the same page after rename/move. Moving a linked page must not change URL identity, source notes or follow-up state.

## Linked from contract

- Derive from actual live reference/card blocks, not text matching, titles, parentId, URL equality or Material save history. Deduplicate by source page, include dates for daily pages, deterministic newest-first and tie handling.
- With two cards from one source: delete one retains one entry; delete last removes it; Undo restores it. Distinguish cards currently in editor content from stale editor metadata. Changing the source title/date updates its label without changing identity.
- A parent relation alone contributes no entry. **Final Lead81ce1b0a:** an actual card in the parent counts in reference records; the UI always filters the breadcrumb parent from Linked from, even when there are other entries. After moving away, the old parent with a remaining card appears. N09: reference source IDs remain unchanged and each source remains reachable through breadcrumb or Linked from. Test parent with card vs without card, plus another source, then move; a new parent without a card must not become a reference.
- Opening an entry goes to the referencing page top. No promise of exact block landing. Existing references to removed sources should follow current domain behavior; new trash semantics are outside Step B.

## Desktop and 390 checks

- Sidebar: Today exactly once, Days grouped as accepted by design, roots plus expandable descendants; active page expands its ancestors. Expansion click is distinct from navigation; keyboard controls and focus remain usable. Very long/identical titles do not hide the target's location.
- Subpages at end of every applicable page, breadcrumb on non-daily pages, Linked from under title as designed. On phone Pages starts at roots, Subpages goes down and breadcrumb goes up; no phone drag tree required.
- Move search: top-level destination is discoverable; self/descendant absent or clearly disabled; date destination can accept a child but cannot itself move. Empty results, cancellation, command failure and Undo leave navigation and data consistent. If an excluded descendant is found by search it must still be refused on the server.
- Desktop drag/reorder is explicitly deferred by Lead81ce1b0a. Move to… is the supported control in this slice.

## Rollback preflight and final gate

Confirmed by source and executed baseline fixture: parentId already exists in layout2 onward, including both current and undo snapshots; current layout is3. Baseline repository cd3c494 created A>B>C, reopened it, renamed the parent, and preserved parent IDs in current and undo. Evidence tests/evidence/pages-tree-preflight-72/baseline-storage.mjs/log.

Therefore **if** Step B only adds commands/queries/UI and reuses parentId plus existing pages ordering, no schema downgrade script is expected to roll back to cd3c494. Old UI may flatten/hide tree controls, but must preserve the hierarchy on load and subsequent save. Lead81ce1b0a explicitly disallows a siblingOrder field in this slice; any new mapped fields or migration must be raised and invalidate this assumption.

When a candidate exists, check migration count/schema diff, write moved hierarchy using it, open that same temporary DB with cd3c494, perform a legitimate old-version edit, reopen with candidate and verify hierarchy, references, undo snapshot and ledger. A baseline-only fixture cannot prove future candidate rollback. No production data was read or changed.
