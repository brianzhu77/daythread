# Vercel-now narrow review

Task110, candidate7ef8e24, Ratchet, 2026-10-22.

**PASS for the current storage/background/recovery changes.** Independent typecheck, 325 tests/0fail/1real-PGskip/4TODO, and VERCEL=1 build pass. Generated output: node24, iad1,120s. PR3 CI check succeeds at the reviewed head.

On my own disposable Postgres, injected Vercel request context and a held fake-provider reply: submitCaptureForModel returns while organize is pending and registers its promise with waitUntil. A second cold service module leaves the capture text, young reserved attempt and active draft alone. Releasing the reply persists the task and settled cost. This verifies application registration and local behavior, not the Vercel platform's actual lifetime. Retry/draft/cost lookup call sites also register their background promises. The five-minute ledger cutoff is longer than function maxDuration; SQLite's standalone behavior is retained.

**Follow-up in the same task:** killed captures can remain organizing indefinitely in this version; Jazz's next commit will end them through the existing model-failed/Retry receipt. Lead69fad7b6 explicitly says that follow-up does not hold the preview link. Recheck it when handed off. Lead owns actual preview protection, pooler/data identity and a live/throwaway capture check; those are not claimed verified here.

No access to Brian's DB, no paid model calls or typing on3000. Local Postgres stopped. [waitUntil API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) describes lifetime extension bounded by function duration.

## Follow-up recheck: 2b18260 / beba2d8

**PASS for the added expiry path, with the disclosed pre-reservation Retry limitation.** Both heads have identical trees. Independent typecheck/build and 13 targeted expiry/repository/service tests pass. A fresh aged organizing capture loaded in the phone browser becomes the existing failed receipt with Retry; its exact text is retained and no page error occurs. Expiry timing follows the matching attempt; late answers for an expired revision are refused in the tested domain path.

The known gap is real: a retried capture with no new reservation remains organizing, and model-price lookup occurs before reservation, so this window includes that request. No text is lost, but this version does not guarantee every killed Retry ends with a button. Foreground polling also stops before five minutes; reload/focus triggers the expiry. Lead explicitly allows the link before this follow-up, and Product deferred the extra late refresh. Record these limits rather than claim complete recovery.

Latest PR head verified as beba2d8508efbd1682559f2f3ddd9ee5c4aaa12b; Vercel deployment succeeds. The earlier7ef8e24 GitHub CI was green; no new GitHub check was listed for this head at query time. Real preview capture lifetime remains Lead's separate check. All reviewer servers stopped, no real DB/model use.
