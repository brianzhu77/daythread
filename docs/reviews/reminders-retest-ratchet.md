# Independent PR138 fix retest

Candidate 079709a7. Cleared the two confirmed findings from c490f3d2.

The original independent fixtures now pass on the real PushStore with PGlite:
- Overlap: holding the first sender while a second tick runs produces one sender call for the event.
- Endpoint transfer: signing the same endpoint up to another workspace resets its signup time; that workspace's earlier event is not sent.

An additional independent fixture verifies failed-send release and retry on the next tick, no send after success, an active lease holding through 299,999 ms, reclamation at 300,000 ms, and a completed claim remaining sent after another five minutes. All 13 author push tests also pass independently, including same-workspace refresh and ownership behavior.

The lease deliberately gives at-least-once delivery after expiry. A live send taking over five minutes, as well as a crashed tick, can be retried; webPushSender does not configure a network timeout. This is outside the ordinary concurrent-tick defect now fixed. No exactly-once guarantee across lease expiry or a crash between delivery and completion is claimed.

No actual push network, real Postgres, deployed Worker, browser/UI, notification tap or iPhone retest for this patch. The prior independent PR137 real Chrome/tombstone/push check remains recorded at e8bcd3f9. No application changes by reviewer.
