# PR164 backwards selection retest

Candidate 69cda271. The original independent backwards cross-line browser fixture passes unchanged in Chromium and WebKit at 1280. The composer now quotes the first line in document order, A line of notes. Source uses firstSelectedLine from selection.$from for the fallback, independent of drag direction.

Run node tests/evidence/comments/ratchet-crossline.mjs http://127.0.0.1:3726 /tmp/ratchet-selected.sqlite chromium (then webkit). Synthetic SQLite only. Prior Unicode/atom/styled within-line selection, repeated-phrase reload/fallback and Resolve/Reopen results remain applicable to this localized fallback change. No new Worker, real Postgres, phone, native Pinyin, performance or rollback run. This clears the finding.
