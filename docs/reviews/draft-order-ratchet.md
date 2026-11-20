# B102 independent review

87e57d5f against02a9118c: not clear. Finding006442d8.

Independent actual reducer probe tests/ratchet-order-probe.ts: three new task suggestions Alpha/Beta/Gamma sharing an empty task slot with fill, or sharing an absent anchor, applied Gamma→Alpha→Beta, leave Gamma/Alpha/Beta in both cases. Offered order should be Alpha/Beta/Gamma regardless of tap order. Fill locks the first-applied suggestion at the shared anchor id; later placement begins after it. Missing-anchor fallback planningEndIndex skips past the already-applied task run before amongApplied scans, so earlier items cannot precede it. Waiting-band placement shares the same issue.

Existing seven author tests independently pass; they exercise a surviving heading anchor. No source fixes, model calls, production writes or servers by reviewer. Repair handed to Roadbuster.
