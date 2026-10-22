# Browser payload trim review

Candidate cedb663, task104, Ratchet, 2026-10-22.

**PASS for response trimming.** No stored data/mapping/migration changes. `loadWorkspace` and `runCommand` project only outgoing workspaces through forBrowser; server repository/domain still retain receipts and before-images. Browser Undo uses operation/revision markers and sends to server. Editor previews use the projected copy; this change does not grant the browser authority to write it back as storage.

Independent checks on isolated candidate worktree with separate fresh read-only VACUUM copies of the live DB:

- Typecheck/build pass. Full tests 315 pass, 0 fail, 4 TODO, including local preview, server Undo and replay tests.
- Browser save-on-leave race harness: 0 failures; in-flight newer text, quick return, and save exceeding five seconds persist words without self-conflict.
- Actual task tick + notice Undo: database done then open; no page errors.
- Browser decoded response sizes: 48,630 bytes on both tested days, Pages and Tasks; 76,502 bytes after one editor save. Matches author evidence. These are decoded payload sizes, not compressed network bytes or latency measurements.
- Static read of every browser receipts/Undo consumer and editor preview call: no browser receipt consumer; global Undo is server-only. Stored before-images and replay lookup remain untouched.

## Existing recovery caveat, not introduced by this change

Independently held the first editor POST until `route.fetch()` completed on the server, then aborted delivery to the browser. Both the candidate and an untrimmed baseline build show “Changed in another tab · draft kept / Load latest”; the DB contains the words and only one POST was sent. Thus this is not a trim regression, but the passing server replay unit test must not be described as seamless UI lost-response recovery. Carry that case into the new core's recovery acceptance.

Evidence: tests/evidence/ratchet-payload-104. The reproduction uses isolated temporary DB/port3411 and must never target the live DB. A12's date-dependent full browser harness was not run; actual notice Undo was checked above. No geometry gate needed: no rendered code changes. All reviewer QA servers stopped; no model calls or live writes.
