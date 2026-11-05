# Independent Formula date review

Candidate b1f4dbbf: no blocking finding. Read the narrow cleanGroup change accepting computed properties; rendering still decides whether their result is a date. Independently ran all 230 formula tests and formula-dates.mjs in Chromium and WebKit. Both engines pass Formula-only Calendar and Timeline selection, drawing rows on dates, read-only drag, Timeline new-row behaviour, no add on Calendar days, Rollup latest, and the 390 week-list path. Build passed.

No Worker, real Postgres, physical device, old-build roundtrip, alignment or performance run. Browser script is the author's, executed independently. The command accepts computed properties without statically knowing their output type; a non-date result falls back to choosing a date, as the design specifies.
