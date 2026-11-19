# Toast swipe review — Ratchet

CLEAR: current candidate b524a057 (PR217), base 3dc41565. Historical findings below were reproduced on42163c0a.

## Recheck b524a057

Both findings repaired. Independent basic browser suite12/12 passes in Chromium/WebKit at390/1280, using unchecked-row counts. Independent lifecycle suite14/14 passes: untouched expiry; outside release resumes timer; stacked swipe removes only one; keyboard action; keyboard focus retains timer; leaving by Tab restores expiry; pointercancel restores expiry. Typecheck passes. Author expanded50-case regression rerun passes25 Chromium +25 WebKit. A first WebKit run was interrupted by a Vite program reload (server log18:43:50, after adding a test seed file); the isolated no-file-edit rerun completed25/25. This interruption is not a product finding.

Changes cancel the button press once8px is exceeded in any direction, watch pointer lifecycle on window, and clear pointer-induced focus while preserving keyboard focus. No source fix by reviewer.


## Confirmed button misfire

Independent actual-browser mouse input in Chromium and WebKit, 390 and1280: press Undo, move12px horizontally inside button, release. All four cases undo completion. Unchecked task row count increases by1. Requirement: a press moved beyond8px must never fire the button. In toast-swipe.ts, sideways movement clears drag before installing suppression.

Script tests/evidence/toast-swipe/ratchet.mjs; run with own dev43961, throwaway SQLite seeded40tasks. Eight adjacent vertical12px/up44px cases preserve task state. Logs /tmp/ratchet-toast-browser.log.

Initial checked-row assertion was invalid because Open view removes completed rows after animation. That evidence was explicitly withdrawn (4bee9d47), and re-run with unchecked counts; confirmed result5abc0d75 and6a27f7fb supersede9875ade4.

## Confirmed lost outside release

In both engines at1280, inject a real app toast with1200ms timeout. Untouched control expires after2200ms. Press toast text, move pointer once far outside before capture, release outside, wait2200ms: toast remains. The hook listens pointerup only on toast; before slop capture it loses outside release and leaves pauseAll active. Script ratchet-extra.mjs exercises the actual HeroUI module from app-shell transformed import, not a substitute toast. Reported d396359e.

Extra suite: untouched expiry, stacked removal, keyboard action pass both engines (6pass); outside release fails both (2fail). Author34-case suite independently rerun passes all34.

## Visual

Viewed own real-build390/1280 screenshots and author comparison attachment53d9e4de. Existing notice style retained; no visual issue found in these light-mode examples.

## Limits

No real iPhone or Simulator. Lifecycle and author regression suites completed as above. No source fixes or production data writes.
