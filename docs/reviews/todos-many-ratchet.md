# Independent To-dos bulk edit review

Initial candidate 255664f2: ordinary scenarios pass; combined limit not yet cleared.

Independently reran todos-many.mjs in Chromium and WebKit (21 checks each) and todos-source unit tests. Own domain.ts additionally sets Start and Deadline on two tasks and verifies one Undo restores exact tasks; status on tasks whose source day is trashed completes and Undo restores task state without throwing. Build passed. Code review includes partial refusals and whole-command Undo.

The current command/UI use rowsAtOnce while the schema still uses 200. PR128 raises rowsAtOnce to 10,000. Roadbuster recommends a separate 500 bound after memory measurements. The schema, domain and UI must be reviewed together on the updated head before clearance; this initial record does not approve that combination.

Not run: Worker, real Postgres, physical device, box selection or List/Gallery-specific browser cases. The scripted board drag checks both selected tasks move together with one Undo; it does not assert the exact destination status, so is not proof of precise drop targeting.
