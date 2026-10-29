# Tomorrow loss review — Ratchet task228

## Final: PASS19cab9a
Owner isolation blocker is resolved by per-owner storage keys, using load/run or offline-copy owner. Draft/pending survive signout under that owner. Legacy unowned per-day records import to the first owner once, per explicit Lead ruling. Move ids are now keyed by target date.

Independent validation, all on isolated local SQLite, no production probes:
- Supplied36-case replay passes in Chromium1280 and WebKit390, including no-Return pagehide, killed-app draft restore, simulated composition blur, Retry/date carryover and same-title lost-add reply recovery.
- Additional WebKit390 mocked owner stamps A→B→A: B sees no A draft/pending and sends zero add requests; A recovers both. This verifies the storage/transport-owner boundary on SQLite; it is not a real-auth signout test. Author separately reports real-auth local A/B coverage.
- Additional lost-move replay: original add lands with lost reply; recovery plan-tasks lands with lost reply; retry on another date resolves to one current-day row and no pending line. PASS. Original historical placements retained per Lead.
- Legacy per-day pending migration: old key removed, imported exactly once and saved to clamped current date. PASS.
- Pending layout at390/1280, light/dark: full-width title, state beneath, shared text column, boxes centred; all passed. Independently inspected390 dark screenshot: long carried title reads on two lines and label names today.
- Full alignment on separately seeded fixture SQLite:287 passed,0 failed,0 missing at390/1280. Tomorrow rows independently measured by layout.mjs because generic alignment does not measure them.
- Unit suite146 pass,0 fail,3 credential skips; typecheck clean.

Evidence: tests/evidence/ratchet-tomorrow. No production data/auth calls. Real iPhone app termination/pagehide and real native Pinyin remain unverified; synthetic composition events do not prove those. No unresolved blocker.

## Earlier review history (superseded)

## 63a28f8: changes required
Independent complete component diff review plus supplied browser harness on own SQLite /tmp/ratchet228.sqlite, own3661 server, auth off. All36 checks pass across Chromium1280 and WebKit390, including failed Retry/day changes, multi-day lost-add response with same-title task, pagehide draft, killed-app restoration and simulated composition blur.

Blocking code finding: tomorrow draft and pending list use unowned global localStorage keys. Auth boundaries clear IndexedDB workspace but not those keys. A later account can see the draft and auto-retry pending lines into its workspace. Lead d1d7d439 accepts blocker and mandates owner-key scoping, retention across signout, first-owner migration of legacy keys before invites, and A→B→A test.

Additional code-derived recovery concern sent3bfe63d0: moveOperationId persists without move input/date. If plan-tasks commits but reply is lost and next retry has a later date, same move id has different input; no identity-refusal handler there. Needs date-stable move identity/input and a lost-move response check. Not yet independently reproduced.

Legacy original task placement on historical day is explicitly retained per Lead5f7a704f; that's history, not a duplicate open task today.

No production probes or data writes. Physical iPhone/native pinyin not tested. Await revised author commit before final verdict.
