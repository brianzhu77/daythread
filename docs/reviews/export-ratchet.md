# B3 task170 — 2f55b20 independent review

**REVISE: successful export can silently omit current typing.** Reviewer actual browser run typed a visible marker, delayed autosave POSTs1.8seconds, then immediately clicked Export. The ZIP arrived and row returned to Export, but workspace.json omitted the marker. AccountRow starts GET without flushing registered editors. Await flushAllEditors before downloading; if it cannot save, retain text and show the failure state rather than reporting a successful incomplete snapshot. Script pending-save.mjs and output preserved. Message8b6615ff.

Independent checks on this exact head (c4ed27f plus underline): full suite401 passed/0 failed/11 skipped/4 todo(416 total), typecheck/build pass. Existing export browser fixture13 assertions each at1280Chromium and390WebKit touch pass: download/busy/failure/retry, ZIP names/content/trash separation, Markdown nesting/styles/links, JSON format/internal exclusion, no-store, underline, no page errors. Auth-required disposable server unauthenticated /api/export returns401 signed-out; local auth-off forwarded request returns403. Route inspection confirms global auth gate and read-only repository load. No real data writes, no production endpoints.

Product/Bumblebee checked real-row copy224:22/22text pieces,7tasks,3linkpages; missingURLfixedc4ed27f. Those are attributed, not reviewer real-row execution. Jazz6557215d UI passes apply because only underline changed. GFM is accepted Obsidian stand-in perLead71e4568e; actual Obsidian and native HomeScreen/Safari download are not verified. Export native checks added to task155 list.

No application changes by reviewer. Await replacement head and rerun pending-save success plus refused-save no-download path.
