# Immediate Postgres switch review

Task108, f7eb984 / live e1fad7d (identical application code), Ratchet, 2026-10-22.

**PASS for correctness and data loss in the agreed immediate switch.** No issue found in the row-lock transaction, replay/stale refusal, workspace and ledger atomicity, or explicit store selection. Postgres starts empty and does not open the local workspace SQLite file. Its ledger runs SQLite algorithms on an in-memory copy only. Server-only Postgres access, prepare:false, startup RLS/no policies and a separate schema match the current contract. C1–C7 and general-core work are superseded and were not applied as release requirements.

Independent isolated checks:

- Typecheck and build pass; suite 322 pass, 0 fail, 1 skipped real-PG test, 4 TODO.
- Ran that skipped test on my own disposable PostgreSQL 17: simultaneous initialization, two-connection stale race, continued writes and exact Unicode/NUL round-trip pass.
- Fresh browser today on local Postgres: typed text survives reload; no page errors.
- Fake-provider capture through the real local Postgres adapter: task persists after reopening, cost settles exactly, provider called once. Existing PGlite tests cover injected rollback of model result and ledger together.
- Application diff f7eb984 → e1fad7d is empty. No access to Brian's Supabase, no real model call, no typing on 3000. Own app/DB servers stopped.

This is a narrow storage review, not acceptance of the stopped general-model/auth/offline program or a measured cloud-latency guarantee. Lead owns live deployment verification. Local evidence in tests/evidence/ratchet-pg-now-108.
