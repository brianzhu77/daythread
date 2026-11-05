# Independent PR132 review

Candidate b585021b. Changes requested: retained Text representations break subsequent Select/Multi-select conversions.

Run `node --no-warnings tests/evidence/ratchet-conversions/roundtrip.ts`. The fixture uses actual domain commands on invented workspace data; no production data.

1. Text `Red, Blue` → Select creates one option named `Red, Blue`. Select → Multi-select then reads empty, instead of retaining that one selection.
2. In a fresh property, Text `Red, Blue` → Multi-select creates Red and Blue. Multi-select → Select then reads empty, instead of selecting the first option as existing array representations do.

Both commands report one value showing empty. Raw words are retained, so these are conversion/read regressions, not permanent deletion. Interpretation depends on retained raw representation rather than the preceding property type. A complete fix must preserve comma-bearing Select values and first-selection behavior for Text-derived Multi-select values, including renamed options.

Build passed. Eight author conversion unit tests passed independently; they do not cover these chains. No browser, Worker, real Postgres, native device, or complete downstream Formula/Rollup/export run in this review pass. Old-client option metadata loss was already accepted as a known limitation by Product; this finding uses only new commands, without old clients.
