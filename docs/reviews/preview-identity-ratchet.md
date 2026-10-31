# PR38 independent review

PASS at b670a5d (2026-10-31). No source fixes made by reviewer.

One production build served on isolated SQLite ports 3672 (DAYTHREAD_PREVIEW=1) and 3673 (0), without production credentials. Chromium 1280 and WebKit 390, both light and dark: runtime title, manifest, desktop caption and phone note match the mode; no page errors. Both origins persist their own boolean. Blocking every server-function call and invalidating the router verifies both stored values restore the correct identity, including document title. Fault injection blocks service workers so interception cannot silently miss requests.

Separately, with service workers enabled, Chromium at 390 and 1280 warms the same-route HTML and assets, verifies control and cached navigation, goes offline, then opens a new tab. The cached server-rendered page boots with Daythread Preview and its caption, without page errors. This is a cold tab, not a previously running app continuing offline.

Code inspection: server sends only a runtime boolean; browser fallback is origin-local; successful server response takes priority. Cached SSR carries root loader data. Uncached routes use the non-app offline page. Manifest identity is separate for preview while install scope remains origin-local.

Replay: tests/evidence/ratchet-preview/replay.mjs. Eight browser/mode/scheme groups plus two offline groups passed. Screenshots accompany the replay. WebKit service-worker cold offline boot, physical iPhone and Home Screen installation are not verified by this review.
