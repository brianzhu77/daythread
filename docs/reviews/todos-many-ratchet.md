# Independent To-dos bulk edit review

Initial candidate 255664f2: ordinary scenarios pass; combined limit not yet cleared.

Independently reran todos-many.mjs in Chromium and WebKit (21 checks each) and todos-source unit tests. Own domain.ts additionally sets Start and Deadline on two tasks and verifies one Undo restores exact tasks; status on tasks whose source day is trashed completes and Undo restores task state without throwing. Build passed. Code review includes partial refusals and whole-command Undo.

The current command/UI use rowsAtOnce while the schema still uses 200. PR128 raises rowsAtOnce to 10,000. Roadbuster recommends a separate 500 bound after memory measurements. The schema, domain and UI must be reviewed together on the updated head before clearance; this initial record does not approve that combination.

Not run: Worker, real Postgres, physical device, box selection or List/Gallery-specific browser cases. The scripted board drag checks both selected tasks move together with one Undo; it does not assert the exact destination status, so is not proof of precise drop targeting.

## Updated head 3bfff568: functional boundary passes, memory finding open

The schema, domain and bar now consistently use a separate 500-item To-dos bound; ordinary rows remain 10,000. Build and targeted To-dos unit tests pass. Both engines pass the updated author script, including All on 505 selecting 500, changing 500 statuses and one Undo restoring them. This closes the previous mismatched-limit finding.

Own limit.ts uses 500 actual task lines on one day, created by one save-editor command. Schema 500/501 and the domain's atomic 501 refusal pass. Planned on all 500 plus one Undo restores exact pages/tasks with an ordinary Node heap, in about 1.1 seconds locally.

**Open memory finding:** with `node --max-old-space-size=128 --no-warnings tests/evidence/ratchet-todos-many/limit.ts`, the process runs out of memory during the Planned command, after seeding and schema checks complete. Phase logs establish where it fails. This contradicts the earlier constrained-heap sizing margin, but does not establish that a deployed Worker has crashed.

Diagnostic experiment: temporarily changing only editor-document.ts's parsedLimit from 2,000 to 20 makes the identical 128 MB invocation pass, including exact Undo. Source was restored in a finally block; no application fix is part of this review. The strong document-string Map retains intermediate large parsed versions while each task is moved. Twenty is a diagnostic setting, not a recommended production cache policy: a cache change must preserve ordinary rendering costs.

Recommendation: bound the retained cache memory, reduce the batch limit, or demonstrate sufficient margin in the real Worker before treating Planned at 500 as cleared. Status-at-500 browser success is not coverage of this path. Evidence: merged-limit.log (OOM), merged-limit-default.log (functional pass), cache-experiment.log (temporary cache bound), limit.ts (reproduction). No deployed Worker or real Postgres run by Ratchet.
