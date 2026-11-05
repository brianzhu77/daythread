# Independent PR153 review

Candidate: 860a3892. Reviewed the complete six-file feature diff against main. No release-blocking finding in this scope.

Executed independently on a disposable local SQLite store and Vite server:
- Build passes; all 231 formula unit tests pass.
- Author tokens.mjs passes seven scenarios in Chromium and six in WebKit; WebKit composition scenario explicitly skips CDP. Covers unchanged stored property ids, reopening/inserting, malformed input, character deletion, backing wrap/scroll, phone font size. Chromium composition uses CDP, not a native keyboard.
- ratchet.mjs: invalid edit followed by Done retains the original stored formula and leaves the entered text visible; repairing it saves the new expression through reload. Passes both engines. Chromium also commits composition identical to the original text and retains tokens; WebKit explicitly skips that check.
- ratchet-domain.ts: rename by id to a Chinese property, relation member references, malformed inputs and variable shadowing complete without exceptions; expected references pass.

The painted backing does not change stored formula representation or textarea editing semantics. Character-by-character deletion is the accepted product difference, not a defect in this review.

Not run by me: Worker, real Postgres, Simulator, physical phone, native Pinyin, screen-reader or performance benchmark. Roadbuster's Simulator and Jazz's theme screenshots are separate evidence, not mine. The new cases do not exercise a concurrent property rename while the editor is open.

Reproduce with the candidate's dependencies installed, a server pointing DAYTHREAD_SQLITE_PATH at a throwaway store, and:

    node --test tests/formula.test.ts
    npm run build
    node tests/evidence/formula/tokens.mjs http://127.0.0.1:3724 /tmp/ratchet-formula.sqlite chromium
    node tests/evidence/formula/tokens.mjs http://127.0.0.1:3724 /tmp/ratchet-formula.sqlite webkit
    node tests/evidence/formula/ratchet.mjs http://127.0.0.1:3724 /tmp/ratchet-formula.sqlite chromium
    node tests/evidence/formula/ratchet.mjs http://127.0.0.1:3724 /tmp/ratchet-formula.sqlite webkit
    node tests/evidence/formula/ratchet-domain.ts

Run browser scripts serially against this store: they replace the seed between scenarios.
