# PR162 focused numeric review

Candidate 5edbe055. Clear for the requested numeric scope: donutSlices and the cumulative guard. No new defect found.

Independent fixtures pass: mixed positive/zero/blank/negative totals; top-four membership and axis-order greys; shares sum to one; negative values remain explicit; no input mutation; reversed display order preserves grey assignment; Other retains exact summed group values while deduplicating overlapping row IDs and preserving both group names; zero/blank produces no slices; stored cumulative cannot affect a donut; cumulative line Sum carries its total over a blank period while Count includes zero and No value remains separate.

Three independent tests plus the author's 17 chart tests pass (20 total). Run node --test tests/ratchet-chart-162.test.ts tests/chart.test.ts. Source diff from previously reviewed chart 2586db15: the cumulative change is only excluding donut, and the new slice function partitions positive values into named four plus Other, exposing negative points separately.

Synthetic domain execution only. No independent browser, rendering, Worker, Postgres, native, performance, or rollback run in this focused review. Jazz owns the visual review; Lead owns release gates. Those results are not claimed here.
