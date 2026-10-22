# General core — final plan recheck

Ratchet · task #101 · 2026-10-22 03:13Z · candidate **8a07bc4** · **YES / plan accepted**.

This accepts the revised target structure for implementation in reviewed steps. The current SQLite data has not been converted, and this is not a cloud-release approval. Initial review: `supabase-plan-ratchet.md` (ae37af3/db576e8); closing discussion 7c660aa6 and 71b0756e. Reviewed full 9a7f193 plus ad1f2f7, 05ccd65, 75c057b, 176101c and 8a07bc4; cross-checked Jazz's core mapping 0764d26 and the independently inspected real-data copy described in the initial report.

## The three acceptance bars

| Bar | Conclusion and evidence |
| --- | --- |
| General data rather than product tables | **Pass.** §4 uses blocks (pages included), collection/property schemas and generic relations. Days/Tasks/Events/Links are collection rows. Infrastructure tables remain specific for transactions, history and model execution. Stable property/option ids and system keys separate display names from behavior. Task words have one editable source: the target page content; refs own no duplicate title. |
| Known future features add structure without rewriting existing content | **Pass at model level.** §11 gives extensions for line links, synced blocks, B22, multi-day planning, templates, AI pages/provenance, graph/context, export, day trash, sibling order and multi-user. Stable ids, tombstones/last-holder, attribution, array property values and relation identities are included now. Shared content lives under a workspace root, with equal page refs and explicitly read-only fallback caches. Multi-valued property queries use containment, including a second-date test. “No rewrite” means no migration of existing content values/identities; new property-schema rows, indexes, feature code and policies are still normal evolution. |
| Existing data has a lossless transition | **Pass as an explicit migration contract.** The snapshot is 11 current pages, 5 tasks, 10 placements, 169 receipts, plus a separate undo state and model ledger. Sections-only pages, raw deleted metadata, provenance, unknown dates, legacy replay ids/results, reference time ordering and partial UI-state facts have mappings. Reverse comparison is required before each release. Unknown content/property/relation data survives writes through known-field patches, not a tree rebuilt from typed projections. |

## Closed findings

- **R1:** workspace lock precedes reads/checks/writes for all writers; provider calls outside it. Contract suite v2 distinguishes successful serialized different-page writes from stale same-target writes. **8a07bc4 additionally checks the edited ref target's starting version**, preventing two different pages from overwriting the same task title.
- **R2/R3:** legacy receipts have explicit unknown type/time and preserved fingerprints/results; typed Undo families and provenance survive; historical reference times, contextual fingerprints, pending refs and date-only facts are retained. A2 explicitly closes the pre-update pending one-step Undo with a notice rather than claiming it was converted. That planned transition is part of the accepted contract.
- **R4:** server-verified owner gate, restricted RLS role and tenant constraints. Data API roles have no table read/write privileges in the private schema, so direct authenticated writes cannot bypass property validation/history. Public auth/model negative tests are release gates, not assumed complete.
- **R5:** one authority/epoch, writer drain, reverse export including post-cloud edits and the model ledger, old-origin draft handoff and rehearsed recovery. No automatic writable fallback.
- **R6/R7:** model attempt leases/recovery and no automatic second provider charge; user/workspace-scoped offline data; unknown-node placeholders and raw known-field patching; exact legacy deleted-metadata payload kept for rollback.

The final five legacy deleted entries include one with five characters of text; 75c057b gives them a verbatim `history.legacy_block_metadata` payload, enabling reverse export. Lead d4a910ef and revision 176101c explicitly limit that text retention: after the 14-day rollback window, a recorded cleanup reduces it to identity/last-holder, preserving provenance relations. New deleted text likewise expires with Undo. This is an accepted retention transition, not an assertion of indefinite byte-for-byte historical export after expiry.

## Implementation gates stay mandatory

A0/A1 may begin once Lead communicates acceptance. Each later step still needs its own implementation review and executed checks: real and populated synthetic round trips, unknown-field preservation, stale ref-target edits, atomic replay/rollback/budget races, owner/RLS/CSRF denial with zero model calls, process termination/unknown provider outcome, and a cloud-write rollback rehearsal. No such unimplemented tests are represented as passed here.

The generic core addresses the known roadmap without requiring its product features now. It does not promise that every unknown future requirement will need no engineering or schema evolution. No further plan blocker found within the accepted scope. No app code, production data, cloud accounts or QA servers were changed by this recheck.
