# Visual geometry acceptance

Effective 2026-10-21, Lead directive 4b3ce971; process source: checklist “How to update”.

Every visual change must include a geometry check before presentation or deployment, on an isolated copy of Brian's data at 1280px and 390px. Jazz checks design; Ratchet independently checks acceptance. Preserve candidate commit, viewport, raw measurements, screenshots and a pass/fail table.

Coverage must include headings, open/done/cancelled task rows, ordinary and nested bullets, page cards with/without preview, link cards, and empty rows. Add clearly labelled fixtures on the copy when real data lacks a state. Include long titles/wrapping, and hover/focus handles where applicable.

Compare the common body text column across peer rows (within 1 CSS pixel). Headings and nested levels use their intended own columns: do not force every level into the body column. Compare each marker/icon/chevron/handle with the centre of its first text line (within 1 CSS pixel), including multiline rows. Use unrounded values for pass/fail; rounding may be used only for display. Report missing coverage rather than implying it passed.

A computed geometry pass must accompany visual inspection; it does not replace it. Inspect at the actual CSS viewport and consistent screenshot scale, including hover/focus, clipping, touch controls, and long Chinese text. A pre-existing failure uncovered by the check must be reported with scope and owner; it cannot be silently counted as a pass.

Use `scripts/align-fixtures.ts` (copy only, with its server stopped) and `scripts/check-alignment.mjs`; FAIL or MISSING means the gate has not passed. The fixture ordering correction is 7b58ba9. The nested-dot measurement uses the marker line rather than raster glyph bounds, a limitation accepted by Lead45344bb0. Keep mutation and fixture setup isolated from the live database. Verify rendering itself does not save or remove content.
