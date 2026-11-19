# PR219 review — Ratchet

Current candidate a12d9d8f, base532d1b28. Historical candidate54382405. Not clear.

## Recheck a12d9d8f

Original upward no-move touch flick repaired, both engines. Expanded equivalent touch sequences still fire action for12px right and12px down in16ms with no move, both engines. Tap controls pass and native CDP mouse upward sequence passes. New capture logic cancels only the allowed closing direction, rather than all displacement beyond8px. Reportb050a9e5; Lead02199650 accepts as remaining blocking repair and freezes this repair to toast-swipe.ts plus test. Later pre-existing flick gaps go to follow-up, not another date-fix hold.

Picker helper independently exercised through actual imported component from a user-click harness, in both engines: min2026-12-01/value2026-11-30 causes no callback on open; earliest accepted once; below-min change rejected; blur/cancel removes input without callback.8/8 pass. This tests browser helper behaviour, not native iOS. Jazz2d7ccacb independently reports Simulator earliest-day success after this repair; reviewer did not operate Simulator.

## Confirmed touch button cancellation gap

Independent script `tests/evidence/ratchet-ios-date/flick.mjs` loads actual app toast and HeroUI action. Synthetic touch pointerdown followed16ms later by pointerup12px upward, with no pointermove, fires action in both Chromium and WebKit. Tap control fires exactly once. Native CDP mouse equivalent does not fire action, so mouse passing does not validate touch path. The new up handler recognizes the flick on window after React Aria has acted on touch pointerup; it does not dispatch cancellation as the move path does. Report9558d01c. Native/Simulator button path requested from Jazz, not independently verified.

## Pending earliest-date check

Picker now starts with value=min. Existing comment says min has its own menu choice. Skipped notice explicitly removes Tomorrow; a plain Skip is merely tomorrow eligibility, not planning tomorrow. If selecting default/min emits no change, notice cannot plan earliest date. Requested Simulator check5de80cde. This is a source-backed risk pending native evidence, not a claimed reproduction.

No app fixes by reviewer, no production writes, no own Simulator. Own43963 dev on throwaway SQLite. Other changed source reviewed; full browser regression deferred until repair.
