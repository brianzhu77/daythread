# PR163 final Next helper read

Candidate f36d9a41. The previously reviewed domain behavior remains clear: four independent fixtures plus 17 author automation tests pass (21 total). The new runsOnFix helper returns the latest due period only for an unchanged scheduled rule with a failure pause. A changed schedule has no recovery preview; the helper respects Until and prior period markers. The editor renders that recovery prefix before its Next line. This addresses the outstanding source-level prediction gap.

Run node --test tests/ratchet-scheduled.test.ts tests/automations.test.ts. No independent browser replay of this newest label, Worker, real Postgres, native or rollback run. Recovery still uses the existing open/idle run-repeats path; this review does not claim an immediate synchronous run inside updateAutomation itself.
