# PR50 independent review

PASS on `349d0cf`, based on main `9ce5ec1`. The application diff is confined to CSS; no data or action changes.

## Evidence obtained independently

Own production build and typecheck pass. A built preview uses invented SQLite records and the real saved-draft hook, without the window stand-in.

Four visual/action groups pass: Chromium 1280 and touch-enabled WebKit 390, each in light and dark.

- All three suggestion kinds have the agreed dashed distinction: task box, bullet dot, and line underline. No fill or bar remains. Suggestion ink differs from normal page ink in both schemes.
- Desktop actions start hidden and become visible on row hover or keyboard focus. Phone actions remain visible.
- Actual Apply all turns all three kinds into ordinary editor rows. Their text remains, suggestion bands disappear, task ink matches normal page ink, and the applied line loses its dashed underline. Screenshots confirm normal solid task boxes and bullet dots.

Ten additional real-action groups pass, five in each browser: Apply, Skip, Apply all, more-open toggle/plus, and editing a new suggestion before Apply all. Buttons keep focus out of the editor, actions take effect, and edited words survive. More-open remains between the paragraph/dash-line planning end and the Raw Notes divider.

Files: `tests/evidence/ratchet-quiet-bands/{seed.ts,visual.mjs,taps.mjs,visual.log,taps.log}` plus before/after screenshots. Start a built preview on 3689 using `DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet253.sqlite`, then run the two scripts sequentially. Each resets only that invented store between cases.

## Limits and harness correction

The first visual run used a proposal block ID to find an applied line; the command assigns an actual inserted ID. The corrected selector finds the applied text, and the complete four-case run passes. That harness failure is not an application defect.

Physical iPhone/native keyboard behavior is unverified; these tests assert focus after mobile WebKit touch events. No production data/writes or model calls were used. The author reports alignment 287/0/0, look 68, tap-focus 21/21 and unit tests 215/0/3; I did not rerun those broad suites for this CSS-only change. The independent checks above cover the changed appearance and real interaction paths. Own preview stopped after review.
