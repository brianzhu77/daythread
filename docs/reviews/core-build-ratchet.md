# Direct general-core build plan review

Task105. Reviewed 9ff30e4, rechecked 5189f2e. Ratchet, 2026-10-22. Plan only, no implementation tests claimed.

**One archive clarification still required.** The general model stays approved; the no-import build, PGlite plus real CI Postgres split, Vercel, patch-only projection, row conflicts and lost-response contract fit the accepted scope.

## Resolved during review

1. Staging-before-every-step conflicted with credentials needed only at C4. 5189f2e explicitly accepts C1–C3 on local/CI Postgres and introduces staging at C4, earlier only if credentials arrive. No earlier request to Brian needed.
2. Preview cannot prove automatic cron scheduling. Revised plan manually invokes the protected recovery endpoint in staging, tests missing/wrong/unset secret with zero job changes, and recovers on the next authorized request. Vercel cron runs only on production. Nitro otherwise permits unauthenticated cron if CRON_SECRET is absent, so the planned explicit fail-closed guard is necessary.
3. Undo before-images could restore an old version and make a stale client valid again. Revised §6 explicitly restores content with current+1. C3 needs the v1 → writev2 → Undov3 → stalev1 refused case, including tombstone restoration.

## Remaining: define when the archive becomes immutable

§7 now correctly skips GET-side expireDrafts and drains reserved model attempts, but simultaneously says late results can write costs and that the ledger/database remain unchanged. Those are different contracts. Also, today's SQLite model worker is not bounded by Vercel's future maxDuration; a reserved counter alone does not establish that its callback has stopped.

Use an explicit archive sequence: stop new commands/model starts; drain or settle/mark unresolved old attempts; stop the old worker process; start the archive with all mutation paths disabled. After the archive banner becomes effective, late callbacks must not write pages **or the archived ledger**. If cost reconciliation is still needed, record it before the freeze or in a separate operational record, not by reopening the archive. This does not restore data migration/import work.

C6 acceptance: hold an old model response across the transition, attempt to deliver it after archive activation, and prove no DB content/ledger mutation. Read every screen including an expired draft; attempt editor/capture/morning/Undo/trash and model-result paths. Compare logical DB rows plus file/WAL state appropriately; a file checksum alone while WAL is active is not sufficient.

## Implementation gates retained

- C1 real Postgres roles/FORCE RLS tests mandatory even if PGlite lacks a feature; PGlite is single-connection and cannot prove contention. Both use the same schema/migrations; CI fixtures model auth.users/claims explicitly.
- C2 transactions set **verified** transaction-local identity before touching protected rows, acquire the workspace row lock before authoritative reads, keep the lock through validation/patch/history/operation commit. Pooler contention is a staging gate once credentials exist.
- Freeze versions when editing begins, including canonical target task versions; do not recompute expected tokens from a newer refresh. Normalize once and keep appliedVersion/history tokens consistent.
- C3 existing typed history remains independent of prunable inverse data; unrelated-row edits survive Undo. Lost response tests must cover a later other-tab edit as well as plain replay.
- C5 exercise restart/lease-expiry/double recovery with a fake provider and zero duplicate charges. Verify the account supports the configured five-minute cron before enabling that schedule: Hobby's daily-only limit would reject deployment. This is an internal account/config check, not a new hosting decision for Brian.
- C4/C5/C6 design checks and fresh seeded fixtures as named in the plan. Cloud authorization, RLS, browser functionality, speed, real phone usage and release remain unverified until their steps.

Sources checked: [Vercel production-only cron](https://vercel.com/docs/cron-jobs/quickstart), [Nitro cron authentication](https://nitro.build/deploy/providers/vercel#secure-cron-job-endpoints), [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [PGlite single connection](https://pglite.dev/docs/).
