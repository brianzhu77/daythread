# B41 offline navigation regression

Use a built disposable loopback server (never port 3000). A store must contain Oct 22. `seed.ts` imports the local scratch JSON copy into a newly named `/tmp/ratchet177-*` SQLite database; it refuses an existing destination.

```
node tests/evidence/ratchet-b41/offline-navigation.mjs http://127.0.0.1:3580 warm
node tests/evidence/ratchet-b41/offline-navigation.mjs http://127.0.0.1:3580 cold
```

Both commands run fresh 1280 Chromium and 390 touch/mobile WebKit contexts. They load Oct 22 online, wait for its editor, go offline and click Pages. Success requires the app shell to remain, either Pages or the agreed in-app offline message, and **zero full document navigations** after the click. JSON output includes failed requests and errors; screenshots go to `/tmp/ratchet177-{mode}-{width}.png`.

`warm` lets idle prefetch succeed if implemented. `cold` aborts the Pages route module even during the initial online interval, testing a connection that disappeared before prefetch could finish. A new context prevents a previous navigation from warming the route module. No text is typed and no model is called.

## Baseline b36e1b4, independently executed

Both modes fail at both widths as expected. Chromium attempts the unloaded Pages module and a document navigation, ending at `chrome-error://chromewebdata/`. WebKit also attempts the module and a full `/pages` navigation; the app shell is gone and the screen reads “Something went wrong!”. This is a baseline reproduction, not a verdict on B41's implementation. Logs are committed alongside this file.
