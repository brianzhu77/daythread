# PR138 batch retest

Candidate f48a665e. Cleared within the tested scope; no application changes by reviewer.

The earlier batch concern is addressed: claims move immediately before each reminder, completion or release immediately after it, and subscriptions send concurrently. The claim time advances with elapsed batch time. The real sender bounds each request to 30 seconds, below the five minute lease.

Independently reran the original overlap and workspace-transfer fixtures and the retry/lease fixture: all pass. All 14 push tests pass, including the author’s held first reminder with three subscriptions and an overlapping tick taking the unclaimed later reminder exactly once per device. The fixtures use the actual PushStore with PGlite and an injected sender, not deployed Postgres or a real push service.

This clears the batch caveat as well as preserving the two original fixes. Crash recovery remains at least once: a process can send before its completion record is committed. No new Worker, Chrome notification, iPhone, or tap check by this reviewer; Lead owns the deployed preview evidence.
