# v0.4 pages delta independent review

Reviewer Ratchet · task #25 · 2026-10-16. Reviewed ec99bd77 then N-7 update 41011501 (full hash below). Document review and paper counterexamples only; no implementation or editor behavior tested.

Conclusion: page identity separate from tree/cards and Task/Placement is sound. N-7 now includes atomic restoration of exactly this delete's set, excludes separately deleted descendants, counts children, preserves tasks and falls back to top level. Four contract gaps should close before pages implementation; none prevents the visual direction work.

## 1. Major: distinguish new child roots from existing transitive linked expansion

N-8 says children are expanded once and only direct children are sent. Existing 03 §2 E1 and X22 require following explicit outgoing references transitively, full content, dedup/cycles, no backlink crawl. Example: Today has child A, A explicitly links B, B links C; A also has unlinked child D. Current wording can mean send only A or send A/B/C. Recommended: direct children are *additional roots*, then apply unchanged E1 outgoing-reference expansion to all roots; D is excluded unless explicitly linked. Permissions and tombstones apply before loading any body. Add acceptance listing exactly Today/A/B/C, not D or backlink-only E. Otherwise mark the reduced context as a deliberate product change, not X22 unchanged.

## 2. Major: URL identity after editing/removing the URL needs collision-safe Undo

N-1 allows removing URL, N-4 blocks editing into another page's URL, but reclaim/Undo policy is missing. Example: page A clears URL U; page B is then created for U; Undo on A must not restore a duplicate or merge pages. Similarly A changes U→V, new B takes U, then Undo. Recommend the current URL key alone reserves identity (including trash); URL edits are atomic conditional operations, and conflicting Undo is rejected with links to both pages and both bodies preserved. Specify whether re-adding a URL to a plain page restores old follow-up history or initializes it; retain history rather than silently reset. Add tests for both conflicts and simultaneous same-URL saves.

Dedup also needs exact key examples: HTTP host case/default port/root slash parsing versus preserving raw path, query ordering and fragment. Keep raw entered URL separately. A URL parser may normalize more than “paths kept as typed”; settle this with an input→key table, not implementation defaults.

## 3. Major: page deletion must preserve the *membership* of yesterday's handoff

N16 is a good invariant but no scenario exercises deletion of yesterday's daily page. A task can keep status and Placement yet disappear from handoff if the query selects only active daily pages. We already reproduced the analogous deleted-presentation failure in the local implementation. Add five yesterday included Tasks, delete yesterday daily page/subtree, reopen today: all five remain in uncapped handoff, not downgraded to capped older carry; task source renders a tombstone, task stays openable independently. Ordinary Notes/Good Stuffs prose from the deleted page must not be exposed as live content. Restore must not duplicate placements or tasks. Fix the projection contract, not only state-write assertions.

## 4. Major: distinguish live backlink facts from historical saves

N-5 correctly separates actual references from save notes, but deleting a card's effect on each needs an explicit rule. Recommend: card removal deletes its live PageReference/Linked from entry; historical save annotation remains in the saves history with source date and removed-line marker. Trashing the source shows removed source; restoring it restores only reference facts whose blocks still exist. Moving target never changes either. Add a test with two saves on one day, delete one card, then trash/restore source: no duplicate daily backlink row, correct remaining live reference and both independent historical notes. Keep source page/block IDs stable through migration.

## Additional acceptance suggestions

- Restore a child separately while ancestors remain trashed, then restore the ancestor delete batch: never steal/reparent the already restored child or duplicate it; no new cycles after concurrent moves. N-7 exact-set restoration resolves pre-deleted descendants but not later independent restoration.
- Create URL page + source card + save annotation + initial follow-up state in one idempotent command; duplicate transport replay has one result. Undo removes only this operation's card/source, deletes newly created page only if still unedited/unreferenced, and never deletes a reused page. Undo of restore/resave must preserve subsequent changes.
- Migration preserves old material identity mapping, independent source notes, decision/skip dates, task conversion link and opt-out. Test a Done/paused/task-converted material and rollback from malformed/cyclic legacy data.

These are recommended defaults and unexecuted acceptance cases. Brian has not accepted the product; visual approval is separate. No request for automatic fetching or wider AI tree traversal is inferred from nested pages.
4101150106f392f6f6835c883e683d3097ffed5481a68eff2bbdeed8d9daecc4  docs/specs-v0.4/pages-delta.md

## Recheck: abad179872ccbefac5c1940ee0c023426b46af09d2d808e898ed427f219f04b1

All four required findings are closed in the document: N-8/N15 preserve E1 traversal from added child roots; N-4/N18–N20 specify key examples, conditional Undo collision rejection and retained history; N-7/N17 preserve uncapped Placement-based handoff after daily-page trash; N-5/N21 separate live backlinks and save history. N22–N24 also cover independent child restore, replay/Undo and migration. No remaining document blocker for the proposed pages contract. Implementation, concurrency and actual editor behavior remain unverified; acceptance examples are requirements, not passing test results. Visual work and Brian's product acceptance remain separate.
