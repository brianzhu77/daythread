# Vercel-now narrow review

Task110, candidate7ef8e24, Ratchet, 2026-10-22.

**PASS for the current storage/background/recovery changes.** Independent typecheck, 325 tests/0fail/1real-PGskip/4TODO, and VERCEL=1 build pass. Generated output: node24, iad1,120s. PR3 CI check succeeds at the reviewed head.

On my own disposable Postgres, injected Vercel request context and a held fake-provider reply: submitCaptureForModel returns while organize is pending and registers its promise with waitUntil. A second cold service module leaves the capture text, young reserved attempt and active draft alone. Releasing the reply persists the task and settled cost. This verifies application registration and local behavior, not the Vercel platform's actual lifetime. Retry/draft/cost lookup call sites also register their background promises. The five-minute ledger cutoff is longer than function maxDuration; SQLite's standalone behavior is retained.

**Follow-up in the same task:** killed captures can remain organizing indefinitely in this version; Jazz's next commit will end them through the existing model-failed/Retry receipt. Lead69fad7b6 explicitly says that follow-up does not hold the preview link. Recheck it when handed off. Lead owns actual preview protection, pooler/data identity and a live/throwaway capture check; those are not claimed verified here.

No access to Brian's DB, no paid model calls or typing on3000. Local Postgres stopped. [waitUntil API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) describes lifetime extension bounded by function duration.
