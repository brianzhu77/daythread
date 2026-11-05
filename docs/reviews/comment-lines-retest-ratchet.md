# PR158 draft retest

Candidate 5adec19f. Clear for the accepted first-release scope.

The original independent held-response fixture passes unchanged in Chromium and WebKit at 1280. First comment commits while its response is held; typing NEW WORDS during that request leaves those words visible after the reply and after closing/reopening the line composer. The saved comment contains only the sent words. The localized change moves pane navigation into onSaved and only navigates with no leftover text.

Run: node tests/evidence/comments/ratchet-race.mjs http://127.0.0.1:3725 /tmp/ratchet-lines-fixed.sqlite 1280 chromium (then webkit). Both engines pass both assertions. Synthetic SQLite only.

Earlier storage/floor evidence cddde01f remains applicable: this change touches only composer navigation. No new real Postgres, Worker, phone, alignment or performance run. Lead 836135d4 explicitly accepts the synced-line anchor difference for this release; shared threads remain open P2-4/P2-7. This clears the draft regression, not the future shared-thread feature.
