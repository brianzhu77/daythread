# Independent PR138 delivery review

Candidate c490f3d2. Two confirmed findings on the real PushStore with PGlite and an invented workspace; no actual push service involved in these reproductions.

1. **Concurrent ticks send the same event twice.** Hold the first tick's sender, run a second tick, then release the first. Both passed `unsent` before either recorded `markSent`. `overlap.ts` observes two sender calls with the identical event key. This does not claim duplicate production notifications; notification tags may merge their visible cards. Serialize ticks/claim before sending, with retry behavior retained after failures.
2. **Moving an endpoint between workspaces retains the old signup time.** Subscribe workspace A, then sign that endpoint up to workspace B. The upsert preserves A's `created_at` whenever it was not gone. An event in B due five minutes before the move is consequently sent, violating the new clean-start contract. `transfer.ts` reproduces this. No cross-workspace content disclosure is claimed. Reset the clock on an owner/workspace change; retain it on a same-workspace refresh.

Twelve author push tests pass independently; they do not cover these interleavings. No application fix by this reviewer. PR137 rollback test is being independently run separately.
