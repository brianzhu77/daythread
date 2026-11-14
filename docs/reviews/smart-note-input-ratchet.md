# PR214 independent review

Reviewed head e0151ca0 (runtime change 519c59cc), November 14, 2026.

**Clear: no blocking defect found.** The change prevents placing a smart note on an otherwise untouched day from making template words newly readable and falsely invalidating the note. Ordinary untouched-day callers retain their previous comparison. Actual writing on the host day still invalidates the input key.

Independent checks, using the shipping dependency tree:

- 115 focused smart-note and template tests pass, including two new reviewer fixtures: multiple notes/JSON reload/removal retain the input key; custom day templates remain excluded until real writing is added. Ordinary untouchedDay behavior without the optional filter remains unchanged.
- Application and test typecheck and production build pass.
- Chromium at 1280 and WebKit at 390, each with a freshly seeded local SQLite store and local model stub: no Notes changed notice after Save or reload; a real edit produces the notice.
- Both engines: the note's actual Refresh action completes and a subsequent reload remains unchanged. Reviewer script: tests/evidence/smart-note/ratchet-refresh.mjs, run after the author's notes-changed.mjs fixture.

No production data, real model calls or deployment were used. Browser coverage here is local Playwright, not native Safari/standalone. Full regression and release verification remain with the Lead's gate. No runtime changes made by this review.
