# Workspace account link — independent review, task #113

**PASS 585a8b5**, including the startup migration and rollback path. No blocking finding. Scope remains one document, not a multi-user storage redesign. No authorization to restore Production is implied.

The main execution review used 8f0db3b. The final delta 585a8b5 changes only the trigger's error text and matching test expressions; I inspected that diff, reran all seven link tests, and reran the injected-failure/pool-flag probe on a fresh final-version schema. The unchanged structural results below remain applicable.

## Independent evidence

All my execution used disposable local Postgres 17/PGlite, fake Auth and fake model responses. No real Supabase user, journal or 3000 was modified, and no paid model request was sent.

- Typecheck and build pass. Full suite on 8f0db3b: **339 pass, 0 fail, 11 skipped, 4 TODO**. Final-version focused link tests: **7 pass**.
- Independently ran the real-Postgres test file with a disposable database: **2 pass**, covering the four-pool sign-in brake and two first sign-ins racing to link the workspace once.
- Independently ran the built-server browser/API harness with fresh schema `ratchet113`: **47 pass**. This includes password/session/draft regressions and correct-password/not-linked 403 with neutral text, fields retained, and no failure counted.
- Independently ran the rollback harness with my own new/old built checkouts on separate ports, using fresh schema `ratchet113rollback`: **10 pass**. New build links and saves; old **ef54ba3** starts on the migrated/bound table, signs in, saves and reloads; the old repository writes a model ledger entry; new build starts again and retains all three typed lines, the link, ledger, and same-account old session.
- Added an injected failure after both link update and session insertion inside the transaction. The exception rolls back both; document, revision and ledger remain byte-equivalent. A separate one-connection-pool probe proves `SET LOCAL daythread.allow_relink` does not survive into the next pooled request.
- Added an actual held fake model call through `model/service.ts`: after the initiating owner scope returns, the delayed result still commits under that owner. On a second held call, deliberately relinking before releasing the model response makes the old-owner result fail; the newly linked row's document/revision/ledger remain unchanged. The expected refusal is captured in `background.log`.
- Owner-scoped read/write/ledger rejection, simulated `auth.users` FK enforcement and deletion restriction, once-only trigger, multiple-row startup rejection, session mismatch deletion and neutral sign-in counting are covered by the independently executed link suite.

Scripts and logs: `tests/evidence/ratchet-workspace-link-113/`. They are disposable local fixtures; do not repoint them at the real journal. The rollback driver is the author's harness adapted to isolated reviewer ports; the atomic and delayed-background probes are additional reviewer scenarios.

## Design and migration assessment

Keeping `user_id` nullable is justified by rollback: an older build inserts the default row without this column before PostgreSQL resolves its `ON CONFLICT`, so a new NOT NULL requirement would break cold starts. The database trigger instead refuses changing an existing non-null link. Binding occurs after verified owner credentials, under the row lock, in the same transaction as session issuance and attempt accounting. A mismatched verified account gets no session and neither increments nor clears failure accounting.

The request gate checks session identity and the workspace link in one query. Repository reads lock the owner-matched row before mutation; the locked row cannot be rebound concurrently before those writes commit. Local auth-off operation deliberately uses the one existing row. Background model work carries the initiating identity, and the independently tested relink case fails closed.

The startup completeness check and advisory lock avoid repeating exclusive ALTER operations on every cold start. New schema creation, column/trigger installation and FK creation are transactional. This is a reasonable overlap with the separately identified startup-lock follow-up.

## External evidence and remaining rollout checks

Lead's real-Supabase verification is separate from my local evidence (fc10e692): on copied throwaway workspace schemas, the pooler role successfully creates the real `auth.users` FK with ON DELETE RESTRICT and the unique/trigger protections; a real owner ID is accepted; 564d622 saves/reloads on the migrated table; the new build retains the link and edits. Lead reports both schemas dropped and the real workspace unchanged at revision 23. No DELETE was attempted on the real Auth user.

Jazz independently passed the not-linked screen at 390/1280 (3760f303). Before completing rollout, Lead should verify the deployed signed-out request boundary and Brian's successful owner sign-in/link on the final build. Existing pre-link sessions may require one more sign-in. This review does not claim the live row is already linked or that real first-login verification has happened.
