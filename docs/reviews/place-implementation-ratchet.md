# PR211 independent implementation review

Clear on recheck at cf3ad9be. All five findings below are resolved. Design contract was accepted at 709abc14; these findings concerned implementation.

## Recheck

I reread the delta and independently ran both formerly failing regressions plus the Place/search tests: 25 pass, one real Postgres test skipped. Full app/test typecheck and production build pass. Additional browser cases pass in Chromium and WebKit: 10,001 typed characters become 10,000 and Keep saves all 10,000; typing cancels the location wait display and a late success cannot save; the state line precedes Keep. Script: tests/evidence/place/ratchet-recheck.mjs.

The earlier 41 checks per engine remain evidence for unaffected behavior. I inspected the new signed-out/cross-site fixture but have not executed its authenticated server run. That run and Enter-loading were reported by author, not counted as my executed checks. The future release merge with newer main still needs its own gate/delta review.

## Historical findings, now resolved

1. HTTP-date Retry-After is ignored. A 429 deadline ten minutes ahead becomes a 60-second pause because Number(date) is NaN; a different query at 61 seconds reaches the provider. Support seconds and HTTP-date, then apply the agreed bounds. Failing regression: tests/ratchet-place-boundaries.test.ts.
2. A transient first catalog failure poisons PostgresPlaceLimiter.ready with a rejected promise. A second take still rejects after the database is healthy. Clear ready on initialization failure; remain fail closed for that request. Same fixture proves it with PGlite plus a one-time failing client.
3. The field accepts 10,001 characters without maxlength; Keep then silently does nothing because cleanPlace refuses it. Editor remains open, words retained, no explanation. Product chose a 10,000 field limit. Reproduction: tests/evidence/place/ratchet-long-name.mjs.
4. A delayed location request superseded by typing leaves Finding your location displayed indefinitely. typed invalidates the sequence but not location state. Explicit search also invalidates it without resetting the state. Restore Saved as on cancellation. Late position correctly cannot save. Reproduction: tests/evidence/place/ratchet-location-state.mjs. Product confirmed in G8-4, main 08e56e8c.
5. Typecheck fails in author tests/place.test.ts:132 because its editable argument includes id outside the accepted Pick type.

Findings sent individually to author in the task thread. Jazz separately identified duplicate Undo text and state-line order; those are not my independent visual evidence.

## Executed evidence

- Production build passes using shipping CI dependencies.
- Existing Place/domain and search unit tests: 21 pass, one real Postgres test skipped (DATABASE_TEST_URL not set).
- Existing browser suite independently executed on my fresh synthetic store and local Photon mock: Chromium 41/41, WebKit 41/41.
- Additional server regressions above fail as expected; browser probes reproduce the additional boundaries.
- No external provider requests, real model calls or production data writes. Owned preview and mock stopped after execution.

## Release verification scope

The fixes above have been reread and rechecked. Latest-main release merge still needs delta review. Author has added signed-out/cross-site checks and Enter while loading. I have not rerun full suite, actual rollback floor, real concurrent Postgres, native or deployed Worker search. Lead owns release gates and live public-place checks.
