# PR51 independent review

PASS `4611bb8` on `e95ed96`. The application diff removes underline styles from draft top-line buttons and adds a desktop hover ink change. Apply all and Show retain the existing primary-button styling; suggestion line underlines are in a separate selector.

Own production build passes. Four built-preview groups pass: Chromium 1280 and touch-enabled WebKit 390, light and dark. Dismiss and Retry have no underline, while the paragraph suggestion remains dashed. Keyboard focus remains visibly outlined. Enter activates Dismiss against the real saved draft, removing its suggestions. Retry activates the existing preparing state through the window UI seam; this is an interaction/style check, not a real provider retry.

Evidence: `tests/evidence/ratchet-draft-line/seed.ts`, `review.mjs`, and `review.log`. Start built preview on 3690 using `DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet254.sqlite`, then run the review script. It resets only the invented store. No production data or writes and no model calls. Physical iPhone is unverified. Broad unit/alignment suites were not repeated for this selector-only change. Own server stopped after review.
