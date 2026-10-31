# PR48 independent review

Ratchet · task #251 · 2026-10-31 · **PASS e1a6d36**.

Reviewed the revision-only resend guard in editor `flush`. It only retries a "Saved elsewhere" refusal after `run` has resynced and the current page's content key still equals the original expected content. It retains the pending action/operation identity, sends at most one automatic retry, and resets the guard after success or a second failure. Actual changed-page content remains protected by expectedContent. No placement, model, domain command or layout changes.

Independently built and ran two isolated browser contexts as two devices, on invented SQLite data, in **Chromium 1280 and WebKit 390**. Eight groups pass (`tests/evidence/ratchet-resend/review.mjs`):

1. Another device creates a day (the midnight ensure-day class of write). The typing tab sends exactly two save requests with the same operation identity. It saves without a transient error in its save line.
2. Another device changes a different page. Exactly one retry; words survive reload.
3. Another device changes the same page. No resend; conflict remains visible and local typed words stay in the editor.
4. Force another revision change immediately before the automatic retry reaches the server. Exactly two requests, then it stops and shows the failure. Explicit Retry saving succeeds as request three.

This exercises the relevant revision effects, not the actual scheduled Worker or a physical second device. Typecheck and production build pass independently. Author's unit result is 214 pass, 0 fail, 3 skipped; not rerun here because the change is editor scheduling and the independent built browser cases cover its trigger and limit. No alignment run needed for this non-layout change.

No defect found, no reviewer app-code change. Worker/Postgres runtime, physical iPhone and native keyboard remain unverified in this review. Own preview server stopped after checks; no production data or writes used.
