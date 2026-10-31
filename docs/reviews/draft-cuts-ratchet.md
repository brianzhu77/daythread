# PR #47 independent review

Ratchet · task #250 · 2026-10-31 · **PASS 0f17f6c**, including main 40da378 + PR46 ddd8a40 combined build.

Reviewed the removal and `PendingTomorrowLines`: the input UI is removed while the existing account-keyed pending list, operation identities, prior-day receipt recovery and reconnect retry remain. Pending strings become Tasks, with target date the later of intended day and today. Historical card-only domain commands remain for older requests/replay; row-menu scheduling stays reachable. The strip's other-open line is removed, not maintained by a second exclusion set. Combined day screen keeps both DraftLine and PendingTomorrowLines.

Independently ran the author's replay scripts on the combined production build, local invented SQLite data, Chromium 1280 and WebKit 390:

- `pending.mjs`: 14/14. Overdue line and half-typed input become actual Task rows on today; future intended line goes to tomorrow. Pending storage clears; reload does not duplicate. Removed card, Continue and Tomorrow UI absent, no page errors.
- `no-other-open.mjs`: 2/2. Removed strip line absent.
- Additional independent fault test (`tests/evidence/ratchet-draft-cuts/recovery.mjs`): commit add on server, return 503 instead of reply. Pending line stays, reconnect replays the same operation, storage clears, exactly one matching Task remains after reload. Another account's pending key stays untouched. Both browsers pass.

Combined suite 214 pass / 0 fail / 3 skipped, typecheck and production build pass. Combined alignment at 1280 and 390: 175 passed, 0 failed, 0 missing, on invented fixtures with every required category present. The larger existing v1 fixture is Jazz's independent run, not claimed as mine.

No new defect found in #47. This is not authorization to deploy without #46's remaining carried-band edit finding and Lead's combined Worker check. Actual authenticated account switching, physical iPhone and app termination were not rerun. All data in committed evidence is invented. No production reads/writes for this review.
