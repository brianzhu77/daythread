# Tomorrow loss review — Ratchet task228

## 63a28f8: changes required
Independent complete component diff review plus supplied browser harness on own SQLite /tmp/ratchet228.sqlite, own3661 server, auth off. All36 checks pass across Chromium1280 and WebKit390, including failed Retry/day changes, multi-day lost-add response with same-title task, pagehide draft, killed-app restoration and simulated composition blur.

Blocking code finding: tomorrow draft and pending list use unowned global localStorage keys. Auth boundaries clear IndexedDB workspace but not those keys. A later account can see the draft and auto-retry pending lines into its workspace. Lead d1d7d439 accepts blocker and mandates owner-key scoping, retention across signout, first-owner migration of legacy keys before invites, and A→B→A test.

Additional code-derived recovery concern sent3bfe63d0: moveOperationId persists without move input/date. If plan-tasks commits but reply is lost and next retry has a later date, same move id has different input; no identity-refusal handler there. Needs date-stable move identity/input and a lost-move response check. Not yet independently reproduced.

Legacy original task placement on historical day is explicitly retained per Lead5f7a704f; that's history, not a duplicate open task today.

No production probes or data writes. Physical iPhone/native pinyin not tested. Await revised author commit before final verdict.
