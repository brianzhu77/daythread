# Generation cost lookup — independent review

Candidate: feat/model-cost-lookup **9f61922**, base e346bdd. Task #71. **PASS for commit review; not frozen or deployed.** No blocking findings.

Verified independently against local HTTP servers and temporary SQLite databases:

- Invalid total_cost values (null, strings, negative, objects, booleans) remain unknown; numeric zero is accepted. A response with headers but a stalled JSON body times out (80 ms setting, observed83 ms), without treating the failure as zero.
- A new Node server process ran modelInfo and the startup background lookup: initially paused, then ready; the unknown attempt settled at the returned price, and the complete workspace was unchanged.
- Five simultaneous actual HTTP lookups of the same unknown attempt settled exactly once. A subsequent different price could not replace it. Estimated attempts caused no requests. An actual cost over the reservation still paused the model and left workspace content unchanged.
- Before refusing another capture as paused, an unresponsive actual HTTP lookup returned after3034 ms, marked the capture failed and sent no completion POST. When the provider later returned a valid zero price, the next submission settled the old attempt and organized once.
- Full suite:173 tests,169 pass,4 TODO,0 fail. Typecheck passed. Existing authored tests also cover404, malformed JSON, URL/auth header and repeated invalid lookup results. Source inspection confirms the transactional reconcile restricts lookup settlement to unknown, startup recovery runs in the background, and post-failure backoff is bounded by1+3+10 seconds plus three10-second request bounds.

Evidence: tests/evidence/model-cost-lookup-71/{independent,before-refusal}.mjs and logs, suite.log, typecheck.log. Tests used synthetic credentials and loopback only. No paid calls, production writes, or deployment.

Practical limit: background ledger recovery does not itself push fresh model state into an already idle browser; its next normal workspace refresh/action observes the recovery. New submissions remain available and were tested. No real-provider propagation latency was measured. Runtime GET still relies on the configured trusted provider endpoint; no new key reaches client code.
