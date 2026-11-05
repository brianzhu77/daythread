# Chart Group by numeric review

Candidate c697c71a. Not clear: grouped Sum lines turn absent values into zero and join across gaps.

Independent fixture: date axis January/March with no February values, Group by Kind, Measure Sum(Pages). chartData's February total is null, correctly, but parts for Novel, Essay and No value are all 0. withSeries valueIn uses numberOf(chartValue(...)) ?? 0. The grouped line path similarly defaults missing values to 0 and draws one continuous path. §3 says Sum with no numbers has no value and its line breaks; only Count draws zero. Preserve null per-series, including Other when all its constituents are absent, and break each series path independently.

Independent checks passed: Count empty periods are zero; a single-select second property partitions Count and Sum over each primary group, including unassigned rows. Author's 18 chart tests pass. Combined 20 pass, one Sum-gap failure. Run node --test tests/ratchet-series.test.ts tests/chart.test.ts.

Product choice, not a newly invented numeric failure: multi-select memberships overlap. Two Novel rows tagged SF and SF+History produce point total Count=2 but series SF=2 and History=1, so a stack reaches 3. This is consistent with each group's rows but is not a partition of the total. Decide how the chart should communicate or avoid that stack/total discrepancy. Also ranking currently uses absolute net series totals, whereas §4 says largest by total; negative series ordering has not been settled in this review.

Scope: source review withSeries, renderer of stacks/lines and Data, synthetic in-memory domain fixtures. No independent browser, Worker, real Postgres, native, performance or rollback run. No user data touched. Series clicks focus rather than opening a separately filtered membership list; opening a point still opens its primary-axis rows, as the source implements.
