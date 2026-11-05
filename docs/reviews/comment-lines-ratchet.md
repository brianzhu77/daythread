# PR158 independent review

Candidate 5f4c6911. One browser regression and one scope gap require resolution.

## Confirmed browser regression

In Chromium and WebKit at 1280, create a line comment `First sent`, hold its successful server reply, append ` NEW WORDS` in the enabled composer, then release. The pane switches to page-comment mode and its field becomes empty. Stored comment contains only `First sent`. Reopening Comment on the original line recovers `NEW WORDS`, so this is retained but stranded draft text, not permanent storage loss.

Cause: CommentsPane.add calls openComments after send success, resetting anchor and changing the pane key, before CommentField can keep its leftover draft visible. Move the switch to its onSaved callback and do it only with no leftover text. `tests/evidence/comments/ratchet-race.mjs` preserves both-engine failure.

## Synced scope

A creation restriction inside synced blocks does not cover an ordinary anchored line subsequently made synced. Independent reducer fixture: comment on l1, wrap it in a synced block, place it on a second page, remove the original place. The line survives as l1:copy, but the thread remains on the old page anchored to absent l1. Comment text survives, but the shared-line behavior in comments.md §4 is absent. Accept an explicit first-release difference or prevent this conversion until mapping is built. Do not call the entire §4 synced contract implemented. `tests/ratchet-comment-lines.test.ts` includes passing initial home retention and failing original-place-removal assertion.

A paste saved before the cut can also be given a new id and leave its thread behind, as Roadbuster already reported; no new independent claim for that path here.

## Passing checks

- Candidate 18 comments and line-comments tests pass.
- Independent PGlite repository replay through actual floor 9417eea2: old schema initializes, newer schema adds anchor, old load cannot see anchor, old Resolve preserves it, newer Undo of old Resolve preserves it and restores unresolved state, old reply preserves it. Includes explicit resolved/unresolved assertions, not just anchor comparisons. Script: `tests/evidence/comments/ratchet-floor.ts /path/to/floor`.
- Source read: anchor migration/RLS table, optional old-row handling, per-column upsert preservation, new Undo applyDiff fallback, row ordering to avoid false thread diffs, cut-first ownership guard, task re-anchoring, quote/mark UI.

No real Postgres, Worker, deployed rollback, real phone, native keyboard or visual alignment gate run by me. PGlite is not real Postgres. No user data touched, and no application edits made.
