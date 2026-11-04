# Independent review: column heads, colour and freeze

Candidate: PR119 at `141e0f67`, including PR115. Reviewer: Ratchet, 2026-11-04.

**No confirmed release blocker found in this review.** This is a targeted review, not a substitute for the Lead's Worker/Postgres and resize performance gates.

## Independent evidence

All browser work used an invented SQLite store and a local production build on port 3698; no user data or production writes.

- Build, typecheck and unit suite passed: 709 passed, 0 failed, 5 skipped.
- Reran `column-heads.mjs` in Chromium and WebKit: all passed. This includes resize/reorder cancellation and Undo, frozen boundary crossing, inserts, duplication, phone headers, and sub-item toggle alignment beside a frozen column.
- `tests/evidence/ratchet-columns/probes.mjs`, both engines:
  1. Hold the first resize POST; resize another column before releasing it. Both widths persist, all six columns remain, and reload retains the columns.
  2. Abort POSTs during a resize. The app shows “Not saved”; allow requests and resize a different column. That width saves and the other columns remain intact. This does not claim the failed width automatically retries or persists.
  3. Seed a colour rule and frozen boundary targeting a property, then delete that property or hide its view column. Neither pins an unrelated column. The rule remains accessible and removable, and removing it persists.
  No runtime errors occurred in these probes.
- `large.ts`: duplicate a Text property across 10,000 invented rows. Every value copies; one Undo removes the new property and its values while preserving all originals. Local SQLite duplicate took 91 ms. The raw repository result serializes to 10,320,273 bytes; this is **not** a measurement of the actual wire response or Worker cost.

Logs and reproduction scripts are in `tests/evidence/ratchet-columns/`. Initial stale-target navigation timed out because the harness required an exact accessible name for Layout; using the menu's normal name matcher fixed that harness error. No product change was made.

## Code assessment and limits

View changes use the latest workspace view when dispatched, which agrees with the held-request result. Missing rule properties are skipped; frozen boundaries are resolved against visible columns, so a stale target does not silently pin another column. Duplication copies values and participates in command Undo; relation mirrors are stripped from the duplicate.

Not independently measured here: Worker/real Postgres limits, resize rendering cost, a real iPad, large relation duplication, or every simultaneous menu action. Lead owns the first two gates. These checks do not resolve the separately reported synced-block save races.
