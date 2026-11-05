# Independent icon and cover stack review

Candidate PR147 4691f591, containing PR144 and PR145. Changes requested. No application changes by reviewer.

## A reply from an earlier picker clears a newer pending icon

Confirmed in Chromium and WebKit on the built app with a throwaway SQLite store:

1. Choose koala and hold its set-page-icon request.
2. Reopen the picker and choose tree. The head shows tree.
3. Release koala, but hold the second request. The head reverts to koala.
4. Release tree. The final choice is tree.

The final stored value is correct; this is a confirmed violation of the newest-choice display contract, not confirmed persistent loss. Each mounted picker has a separate useIconSender latest counter, but they clear the same module-level drafts map. The previous instance still believes its reply is current. Keep generation ownership with the shared page draft. The same failure is confirmed for covers in both engines: choose paper, hold its save, reopen Change and choose stone, then release paper while stone is held. The band changes stone → paper → stone. reopen-cover.mjs and its logs record it. useCoverSender uses the same instance-local pattern and needs the same ownership check.

Evidence: reopen.mjs and reopen-{chromium,webkit}.log. The assertion fails at step 3.

## Storage and migration

Build passes; all page-icons unit tests pass. An independent PGlite fixture starts the actual floor c2f3c5bc repository, creates a page before the new columns, prepares the candidate, sets icon/cover/position, then edits the title through the actual floor repository. Loading through the candidate preserves all three new fields and the floor title edit. This checks migration and known-column upsert behavior; it is not a Worker/real Postgres test. The accepted floor hard-delete/Undo decoration-loss exception is outside this passing save path.

Browser baselines complete: icons 14, covers 14 and sets 6 pass in each engine on this candidate. These are independent reruns of author scripts; they do not cover reopening between choices, which the separate failing fixtures add. No real phone, signed-in Worker/R2 upload, or live-account write by reviewer.
