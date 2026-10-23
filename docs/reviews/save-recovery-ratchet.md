# B35 task166 — 6c7fad1 independent review

**REVISE: copied tab identities can still lose offline text.** Actual Chromium opener inherits the parent's sessionStorage, including `daythread.tab`. Two editors consequently write one localStorage key. Reviewer browser script `tests/evidence/ratchet-save-166/opener-slots.mjs` typed A and B into separate tabs with POST saves blocked, closed both and reopened: only B recovered. This is actual browser input, not a synthetic storage mock. Message66accf58 reports it; copied-id detection must preserve normal reload recovery and ensure concurrent live tabs have different identities. Recheck browser Duplicate Tab as well where available; that browser command was not executed by Ratchet.

## Independent executed evidence

- Full suite401 passed/0 failed/11 skipped/4 todo (416 total), typecheck and production build pass.
- Real-day replay10/10 on a freshly seeded disposable SQLite store: task identity, nesting, ticking, deleting text and a typed-then-cleared task, text/task cut-paste, historical task removal, two separately created tabs recovered, no page errors.
- Author's `b35/tabs-check.mjs` independently repeated:6 assertions pass, including frozen tab recovered and resumed without a duplicate and an ordinary live tab not claimed. Its shortened quiet interval is a test hook; not a ten-minute real background-timer observation.
- Lead62bf2071 lost reply followed immediately by close/reopen: reviewer `lost-close.mjs` passes normal text, trailing spaces, trailing empty line; each marker persists exactly once. Each route actually reaches the server before its response is dropped. Output preserved.
- Reviewer cut-recovery conflict mode: actual cut, blocked save, another repository changes the page, reload and Load latest retains original done task id and cutTaskIds.

## Remaining checks / limits

The requested10+ minute hidden desktop timer check is not verified: headed and headless Playwright both reported document.visibilityState='visible' even after foregrounding another page/minimizing the window, so the attempted harness stopped rather than claiming background coverage. Product94a437ad explicitly accepts the hidden-tab observation gap as nonblocking, with a user-report trigger to revisit the quiet cutoff. No native Safari/iPhone behavior claimed. Final candidate strings and recovery Undo are still pending Jazz/author changes. Saving retry/collision tests must be rerun on the replacement head. No production writes/deployments or app fixes by reviewer.
