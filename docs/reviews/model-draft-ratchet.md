# A6b step 1 independent review — task #80

**Initial candidate 97d1679: not accepted.** Four findings below were independently reproduced. Followup b3dfa2f fixes all four; see final verification below:

1. A proposal with grounded Do Fri Oct23 creates a task planned on the draft day Mon Oct19. The command never reads proposal.date. Actual SQLite reproduction: tests/evidence/ratchet-draft-80/proposal-date.ts/log. Lead/Product clarified: dated proposal is planned on its date, no row today; undated proposal goes to today's Other. Accepted-source metadata must survive even when no future page exists.
2. Invalid date strings in source text (`2026-13-40`, `99/99`) throw RangeError instead of returning null. Date probes log demonstrates the parser exception. Independent invalid-paid-result.ts/log then confirms a fake paid answer with reported cost and generation id throws, leaving draft drafting and ledger reserved with no recorded generation id/cost. Needs actual orchestration regression, not just parser test.
3. Replay while the same run is in flight incorrectly sets it failed/busy. Independent controlled fake-fetch reproduction: first call reserved and gated, second same-run call marks draft failed, release first → stale, one settled charge and no published result. tests/evidence/ratchet-draft-80/replay-running.ts/log. Existing test only replays after completion. Server start receipt replay can launch this same path.

4. Entirely empty day: built application with fake empty answer stores ready but removes the whole card, so Nothing to suggest today is absent (both card and message count zero). Independent empty-day.mjs/log/png. Jazz 8437503d confirms card must stay with Done/Later, including reload.

## Completed checks on the initial candidate

- Independently ran full suite: 234 tests, 230 passed, four TODO, no failures. Thus passing suite did not cover these cases.
- Independently reran author's old-build roundtrip in separate detached 53c1b83 checkout and fresh SQLite work directory: all 17 checks passed, every draft state readable/editable/Undo-compatible, source metadata survives. Harness rerun, not independently authored.
- Source review covers server-only commands, run/manifest validation, shared ledger and expiry. No provider requests or production writes were made by reviewer.

Additional accepted UI followups: preserve original reason/destination for existing handoff/review tasks selected again by model; when nothing new is offered show Nothing to suggest today. Jazz requires live proposals leave Bring-lines list and Hide restores them. These are included in followup verification.

## Final verification: b3dfa2f — PASS

All four initial findings are closed by independently rerunning their reproductions on b3dfa2f. No open blocking finding remains in Step 1's accepted scope.

- Full suite: 238 tests, 234 pass, four TODO, zero failures (`followup-suite.log`). Includes shared ledger, browser command boundary, controlled-clock 90-second expiry, restart recovery, late result cost settlement and manifest validation. These are existing author tests independently rerun, not new reviewer-authored tests.
- Reviewer-authored SQLite/fake-provider reproductions: dated proposal plans only Oct23, no Oct19 placement; same-run concurrent replay is a no-op while the original publishes ready with one settled cost; invalid source date now publishes ready and retains the fake provider's actual cost/generation id (`followup-proposal-date.log`, `followup-replay.log`, `followup-invalid.log`).
- New reviewer-authored `future-marker.ts`: absent future page, acceptance marker present, Undo removes task/marker, second acceptance refused, actual old 53c1b83 save-editor and Undo preserve the marker (`future-marker.log`).
- Actual old-build roundtrip harness rerun on fresh isolated SQLite: 17 checks pass across drafting/ready/failed/expired (`followup-old-roundtrip.log`).
- Built app with fake provider and a seeded copy of the real workspace: all 39 checks in author's `ui-check.mjs` pass, independently rerun. Open/reload makes no call; dated + shows its date; undated + / Undo leaves source untouched; original handoff reason retained; live proposals leave Bring-lines, Hide returns them; editing source withdraws suggestion without a call; empty ready result survives reload with Done/Later; failures/Retry, timeout, Done during request, 390px target and no console/page errors pass (`followup-ui.log`, `followup-shots/`). Screenshots visually inspected at 1280 and 390px.
- Extra reviewer browser check: entirely empty workspace at 390px, empty result → Later closes card and reload keeps it closed (`empty-later.mjs/log`).
- Build succeeds. All provider traffic here used the isolated localhost fake, no paid requests and no production writes. Physical iPhone/Safari and real keyboard behavior are not covered by Chromium viewport checks. Model usefulness requires the agreed real-use trial; this review does not establish it.

Evidence directory: `tests/evidence/ratchet-draft-80/`. Preserve initial failed logs as history; followup-prefixed logs describe the accepted candidate.
