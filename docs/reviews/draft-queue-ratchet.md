# PR46 queued draft write re-check

Ratchet · task #249 · 2026-10-31 · **PASS fd5834f**, combined with PR47 0f17f6c.

Lead's Worker failure invalidated release clearance from the earlier functional pass. Roadbuster reproduced a server-side set-draft write moving revision outside the tab queue while its reply was held. This review covers the new computation-only server and queued client write; Lead's 20-run real-model Worker gate remains separate.

## Source review

`prepareDayDraft` now only loads/computes and returns an action and owner. It has no repository execute/write path. The existing command schema/domain normalizer still checks the returned set-draft when the client queues it. `run` obtains the current revision when its queued job executes, not when generation began. First-ready refusal stays quiet and refreshes the winner; data/Undo commands are otherwise unchanged.

The owner is compared before queueing the result; the action retains its original page id. Sign-out is a full navigation, so existing JS does not carry across it. This is narrower than a generic automatic retry for writes from other devices or cron; that follow-up is explicitly outside this release.

## Independent built-copy checks

Real hook, invented SQLite workspace, no provider call, Chromium 1280 and WebKit 390. `tests/evidence/ratchet-draft-queue/race.mjs` controls the boundary rather than hoping to hit a timing window:

1. **Hold computation response:** fetch the completed prepare response, retain it while typing and autosave settle. Direct database assertion: no hidden draft was written by the server, typed Task is saved. Release reply: observed write order `save → draft`, no save error, both preserved.
2. **Hold queued draft commit response:** let set-draft commit, retain its reply, then type. Assert no save request escapes the queue during the hold. Release reply: observed order `draft → save`, typing saved without stale-revision refusal.
3. **Mismatched owner result:** change only the returned owner's scalar in the serialized response. Typed words still save; no set-draft is sent, no hidden draft created. This exercises the client ownership guard, not actual authenticated account switching.

All six groups pass. The first owner-injection harness assumed plain JSON object properties, but TanStack uses a Seroval graph; corrected injection to its owner scalar before accepting results. Failed harness log retained; no app defect inferred from it.

Two additional navigation cases pass (`navigation.log`): release a pending computation after same-account SPA navigation to Tasks; its late write stays attached to the original day, typed words remain saved. Eight controlled groups pass in total. The first harness used a URL glob excluding the actual `?view=today` query; corrected to pathname-based checking, retaining the initial timeout log.

Typecheck and production build pass. No geometry or domain action changes, so earlier combined alignment, atomic Apply/Undo, identity, migration, captured-output and editable-band results remain applicable. This review does not establish the 20/20 Worker result, true multi-device concurrency, physical iPhone or native keyboard behavior.

All review data invented; no production writes, private journals or model keys used. No reviewer app-source changes.

Gate 2 (independent review) passes. Gate 3 remains Lead's combined Worker / real-model 20-run test, not covered by this local review. Own preview server stopped after checks.
