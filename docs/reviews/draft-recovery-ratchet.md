# PR54 independent review — final pass

PASS revised head `9f0dea3` on `4e640db`. Initial `591f08e` needed the visible expiry fix below. Own final build/typecheck pass; the full suite on the initial head passed 219/0/3. Application changes are confined to the shared request hook.

## Confirmed finding, now fixed

A held request still displays Preparing after 61 seconds in a visible tab without a focus/visibility event. There is no timeout callback notifying the shared request store. The expiry check only runs during a render or event. Consequently the visible user cannot use Retry after the stated lost-request deadline. Focus did correctly start the second ask. Reported as d0d52b75; Lead requested an expiry notification in 147cc291.

`9f0dea3` adds a per-ask timeout that marks only the still-current ask failed and notifies subscribers; completion clears its timeout. On the final built tree both Chromium and WebKit now show Retry after 61 seconds without any focus/visibility event, then recover with exactly one wake ask. The other six late/ownership/navigation probes were rerun on the final head and pass. A separate final probe stores a ready status (using the same provider-free status substitution) and confirms repeated focus/visibility and reload never ask again in both engines. Final logs: expiry-final.log, extra-final.log, ready-final.log.

## Independent browser evidence

The six author scenarios pass when executed on my built preview, with a fresh invented SQLite workspace for every case, in both Chromium 1280 and WebKit 390:

- Throwing prepare shows local failed/Retry, then one wake ask recovers.
- Two thrown asks exhaust the automatic budget; further focus does not ask, manual Retry does.
- Two failed set-draft writes show Retry and recover on wake.
- A hanging ask is not duplicated before 60 seconds; wake after expiry asks once and recovers. The additional observation immediately before wake reproduces the finding above.
- Hidden midnight rollover with the first new-day ask aborted recovers on visibility with one extra ask.
- Stored draft does not ask again on focus, visibility or reload. The local model is disabled, so the fallback is stored as failed; that also exercises the rule that stored failures do not automatically retry.

These are independent runs of the author's scenarios. The production build uses hashed server-function IDs, so the copied script resolves prepareDayDraft's ID from the built asset rather than assuming the development base64 ID. The first rejected counter assertions are retained in production-route-harness.log; they were harness routing failures, not app failures.

Additional independent probes in both engines check late response, ownership and navigation:

- Hold the first computation, expire it, and let a second response become ready. Releasing the first response afterwards leaves exactly one draft with the newer stored document unchanged. There are two set-draft attempts; the server's first-ready-wins protects the newer ready record. To avoid a provider call, only the second computed response status is changed from failed to ready in its Seroval scalar.
- A response whose owner scalar is different never sends set-draft; words typed during the hold persist.
- Navigating to Tasks while computation is held still saves typed words and attaches the eventual draft to the original day.

Ownership injection is not an actual authenticated account switch. The Seroval response scalar needs its own escaping; an initial probe assumed ordinary JSON and was corrected before accepting results.

## Reproduction and scope

Evidence under `tests/evidence/ratchet-draft-recovery/`: seed.ts, recovery.mjs/run.mjs, recovery.log, extra.mjs/extra.log. Start a built preview on 3693 with SQLite `/tmp/ratchet257.sqlite`, auth off, then run scripts sequentially. Each case resets only that invented database. No production data, production writes, real provider calls, native phone or Worker tests by this reviewer. Lead owns the real-model Worker gate.

Own preview stopped after final review. No active follow-up reminder.
