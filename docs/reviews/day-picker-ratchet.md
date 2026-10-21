# Day picker independent review

Candidate eac3c01; Ratchet; 2026-10-21. Initial behaviour and geometry checks passed. Final approval pending the requested dot contrast adjustment (Lead f5c37a18); this is not final release approval.

Fresh read-only VACUUM of the current local database into /private/tmp/ratchet92.sqlite, then official isolated alignment fixtures. Preview port 3403. No production writes or model calls.

- Build and typecheck passed.
- Full independent geometry gate: 257 passed, zero failed, zero missing, at 1280 and 390. Includes row alignment, drawn nested markers, and date-dot position.
- Author's 19 browser assertions executed independently: all passed. Past empty day opens a plain page, merely opening does not add a dot, future day opens preview without creating a page, all days have pointer cursor, expected written/selected/today/future states remain.
- Own 13 additional browser assertions passed: title position does not shift on opening, Escape closes picker, future navigation does not create a page, explicit Create page creates an editable plain template with null draft, picker fits both widths, no page errors. Own script and logs in tests/evidence/ratchet-picker-92.
- Visually inspected settled 390 screenshot: title has padding, chevron points up, popover sits below title, month arrows are neutral, selected day blue, today pale blue, future grey. Dot contrast change is pending; existing dot positions pass.

Screenshots were recaptured after transition completion; initial immediate screenshot captured animation and was replaced. The copy gained Oct 12 and Oct 29 pages solely through these browser checks. Own-check's absent-future fixture assumes the first run; reset the isolated copy for a full rerun.

Next: review only the changed dot CSS and contrast gate on Jazz's next commit. Preserve these passing behaviour checks unless that patch changes navigation or page creation.
