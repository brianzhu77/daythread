# PR167 retest at 707a3cae

Floor preservation and the optimized stored-value path are clear for the focused checks. Slow formula/relation/rollup selection cost remains open for Lead's limit decision and Worker gate.

Original cheap-expression fixture, same synthetic 10,000 rows and N+1: 1,000 picked took 33 ms versus 29 ms fixed (100: 21 versus 35 ms). One sample per condition; order/JIT noise makes small differences unimportant. The previous 961 ms cheap-expression regression is removed. Source now preflights once per parsed list/scope and skips workspace projection when a formula only reads stored cells on its own row.

Slow-path fixture selecting prop("twice"), where Twice is a formula N*2: 1,000 picked took 1,121 ms versus 22 ms fixed (100: 138 versus 19 ms). This is still Node in-process, load about 4.6, not Worker or Hyperdrive. The measured 1,000 rows are one tenth of the allowed 10,000, so “under a second and bounded” does not establish the cost of the full allowed selection. Choose a smaller slow-path cap (author offered 100), or gate the full allowed request and representative expression on the Worker. No new evidence clears that request budget here.

Independent freshness fixture passes: force a slow relation read; add a row in the same tap; point the original row's relation at it; then read that relation's N into a later property. It reads 7 from the newly added row. Existing 32 button/variable tests pass, 33 total. Actual 9417eea2 PGlite old-write/current-return script also passes unchanged on this head, preserving all three v2 payloads. No new correctness defect found in the changed fast/slow path.

Evidence scripts: ratchet-variable-cost.ts accepts an optional expression (default N+1); pass 'prop("twice")' for the slow path. ratchet-variable-fresh.test.ts is the independent freshness case. No independent browser, native Pinyin, real Postgres, Worker, rollback deployment or broad formula regression run in this focused retest.
