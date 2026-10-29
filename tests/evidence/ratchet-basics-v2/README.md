# Ratchet model-v2 basics

Baseline main 502e550; task #229. All fixtures are invented and restricted to `/tmp/ratchet229-*` SQLite copies. No production settings or credentials.

Start with a **new** database, not one already used: operation IDs deliberately make fixture seeding idempotent. Use an isolated worktree, install/reuse dependencies, then:

```
node tests/evidence/ratchet-basics-v2/seed.ts /tmp/ratchet229-desktop.sqlite
DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet229-desktop.sqlite npx vite --host 127.0.0.1 --port 3664
```

In another terminal run `replay.mjs http://127.0.0.1:3664 /tmp/ratchet229-desktop.sqlite`, then `extra.mjs`, `sections-seed.ts`, `sections.mjs`, `create-page.mjs`, and `tabs.mjs` from this directory (all paths relative to repository root). `b42.mjs` is an additional isolated five-case conversion/Undo experiment. Results go to `/tmp/ratchet229-*`; accepted logs/JSON are copied into `results/`.

Native: seed a separate `/tmp/ratchet229-native.sqlite`, build main, then run Vite preview on port 3665 with the same SQLite/auth-off flags. Appium 3 + xcuitest 12.22.5, Xcode, iOS 26.4 Simulator. Own device UDID A24BEFF6-6677-44A5-A2DB-A1C1CCCDCC1D. Appium 4727, WDA 8107; use a fresh derivedDataPath `/tmp/ratchet229-wda` (the stale older prebuilt WDA did not start). Runtime session JSON is `/tmp/ratchet229-session.json`; never commit it. `native.py` is the HTTP helper. `native-runs/` retains executed steps; run from repo root. Web context is selected only after checking the local URL, and stored in `/tmp/ratchet229-webcontext`. The focus helper's first attempted context was an old local tab; it was read only, rejected, and never typed in.

The native run is sequential and stateful, not a single turnkey test. Initial setup/gesture mistakes are described in the review. Candidate XML + screenshots establish real Pinyin; `background.json`, `b68-*.json`, `real-swipe.json` and `midkill.json` record accepted state assertions. The accepted kill gesture uses native drag-with-velocity and verifies `queryAppState == 1`; merely opening the switcher was not accepted. `real-swipe.py` combines that corrected gesture with the performed reopen assertions. Safari's WebView process changed after confirmed termination.

`replay-final.log` and `extra2.log` are rejected diagnostic runs; `replay-paced.log`, `extra-paced.log`, `sections-paced.log`, `create-final.log`, `tabs.log`, and `b42-isolated.json` are final evidence. Physical iPhone and standalone Home Screen mode were not tested.
