# PR219 review — Ratchet

Candidate54382405, base532d1b28. Not clear.

## Confirmed touch button cancellation gap

Independent script `tests/evidence/ratchet-ios-date/flick.mjs` loads actual app toast and HeroUI action. Synthetic touch pointerdown followed16ms later by pointerup12px upward, with no pointermove, fires action in both Chromium and WebKit. Tap control fires exactly once. Native CDP mouse equivalent does not fire action, so mouse passing does not validate touch path. The new up handler recognizes the flick on window after React Aria has acted on touch pointerup; it does not dispatch cancellation as the move path does. Report9558d01c. Native/Simulator button path requested from Jazz, not independently verified.

## Pending earliest-date check

Picker now starts with value=min. Existing comment says min has its own menu choice. Skipped notice explicitly removes Tomorrow; a plain Skip is merely tomorrow eligibility, not planning tomorrow. If selecting default/min emits no change, notice cannot plan earliest date. Requested Simulator check5de80cde. This is a source-backed risk pending native evidence, not a claimed reproduction.

No app fixes by reviewer, no production writes, no own Simulator. Own43963 dev on throwaway SQLite. Other changed source reviewed; full browser regression deferred until repair.
