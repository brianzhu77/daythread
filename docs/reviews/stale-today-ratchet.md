# B46 independent review

**Pass: ff52607**, task182. This includes the empty-request output change from33f42b5 and the accepted ten-minute rule from34d3c81, with the retained-draft guard removed by Lead0bbca244.

## Executed evidence

- Independently reran the three author scenarios on34d3c81 at1280Chromium/390WebKit: days-away resume updates Today and the explicit old day's relative label; a23:55 input/00:01 return keeps the old day, then11 idle minutes turn it over with editor focus released; a visible tab left overnight turns over without any return event. All passed, no page errors. Final delta removes only the own-draft condition; those empty-draft scenarios remain applicable.
- On final ff52607, independent retained-turnover.mjs covers a failed draft on the day being shown and a failed draft left on another page, at both widths. After a fake-clock jump and return, Today shows the new day, the editor has no focus, and the not-saved line names the old day. Reconnecting saves that old-day marker exactly once and clears the line. All four runs passed. Times are simulated; no native backgrounding claim.
- Independent model-boundary.ts: invented entries for entirely empty manifests are ignored; all-invalid entries for each populated manifest still refuse; an allowed task survives irrelevant empty-list hallucinations; malformed answer structure still refuses. All assertions passed, no paid model calls.
- Full suite431/0, typecheck/build passed on34d3c81. Final guard-only delta built clean; the focused final browser checks above passed. A full suite was not repeated solely for removing the guard.

## Review boundaries

Input listeners cover keys, pointerdown/move, wheel and touchstart. Bare layout scroll is deliberately excluded; it can fire while the screen reflows. A retained draft does not inhibit turnover; only an outstanding leave-save does. Review retains its separate after-midnight rule. The new editor suppresses autofocus on automatic turnover.

The initial33f42b5 old-day draft-remount check passed both widths, but its initial broad screen script was interrupted after the rule changed; it is not represented as a full pass. Actual Home Screen/Safari resume remains task155. Lead owns any data cleanup; none was executed here.

Evidence: tests/evidence/ratchet-stale-today/, plus final-retained.txt, model-boundary.txt and prior-rule-browser.txt. No application code or live data was changed.
