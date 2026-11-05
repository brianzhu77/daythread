# PR167 floor and execution cost review

Candidate b411246c. Floor round trip clear for the tested writes. Bulk formula performance remains a release gate, not cleared by in-process tests.

## Actual floor storage round trip

Executed the actual 9417eea2 Postgres repository code against an isolated PGlite database, then current repository code on the same database. Current writes v2 payloads into a page Button, a Button property and an inactive rule. Actual floor save-editor appends ordinary text while preserving the Button block, and an actual floor property rename rewrites the database JSON. Returning current retains all three payload strings byte-for-byte and running the page button creates N=5 as expected. Nothing was created during the old writes.

Important distinction: 9417eea2 predates executable step lists entirely. Its page button renderer is an inert span with label/steps prop schema, and it has no buttons.ts/readSteps function. Separately imported the later v1 reader from 69cda271 and confirmed it reads v2 as no steps. Thus the version guard protects intermediate readers, while actual floor preservation is tested through its real storage/command code. This was PGlite, not real Postgres, Worker or a floor browser session.

Reproduce: node tests/evidence/buttons/ratchet-floor-variables.ts /tmp/ratchet-formula-floor /tmp/ratchet-selected (exact trees 9417eea2 and 69cda271). These are disposable checkouts. No credentials or user data involved.

## Independent cost sample

Synthetic 10,000-row workspace, number N=1. Pick rows and run one property step setting N=2 fixed, or N+1 formula. Each run uses a fresh workspace. One sample per condition, Node on this Mac at load about 3.4; no claim of a stable benchmark or Worker cost:

| Picked | Fixed | N+1 formula |
|---|---:|---:|
|100|22 ms|139 ms|
|1,000|23 ms|961 ms|

All selected first/last rows became 2. The repeated cost is structural: runRowButton invokes runSteps for each picked row; each formula list constructs a fresh workspace/schema view for preflight and a StepReading again. The row cap bounds count but not a suitably small request CPU time. More complex relation/formula reads can cost more than this constant expression.

Recommendation: reuse schema/type compilation and safe read indexes across a bulk command while invalidating data affected by prior steps/rows, or measure and enforce a lower formula-specific command budget. Preserve the accepted semantics that later steps see earlier writes. Lead's real Worker gate should exercise the largest permitted selection with a representative relation/formula, including all-or-none failure near the limit. I have not run that gate and do not claim the current limit is safe there.

## Other verification

Existing button-variable and button tests: 32 passed, including step failure atomicity, retries, variable order, property type conversion and To-dos formula values. Source read StepReading, variablesBefore, runSteps and v2 serialization. No additional numeric correctness defect found in this focused read. No independent browser Pinyin, real phone, new real Postgres, Worker, rollback deployment or whole-app performance test.
