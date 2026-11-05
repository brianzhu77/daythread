# Independent PR133 + PR130 memory retest

Reviewed PR133 91f66201 merged locally with PR130 3bfff568. No application changes made.

The exact 500 real to-do lines on one day fixture that exhausted Node's 128 MB heap before now passes with `node --max-old-space-size=128 --no-warnings tests/evidence/ratchet-cache/limit.ts`: Planned for 500 and one Undo restore exact pages and task records; 501 remains refused atomically. Local command plus Undo measured 1,139 ms; this is not a performance budget claim.

Both parse-cache tests also pass independently. The code bounds retained document-string characters as well as entry count; eviction changes caching only, with parsing remaining the fallback.

The reproduced memory blocker is cleared for these combined heads. This is a Node stand-in, not an actual Cloudflare Worker or real Postgres run. No browser or render-budget rerun; preceding PR130 browser checks remain as recorded on 3bfff568.
