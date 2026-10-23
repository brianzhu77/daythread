# B3 task170 — 420ef4b recheck

**REVISE: gone-tab draft skipped when its page is open in the exporter.** A keeps page editor open; B types on the same page with saves blocked and closes; A exports. Actual browser `closed-same-page.mjs` asserts B really stashed its marker before close, waits past the shortened gone cutoff, then downloads a ZIP missing that marker. `saveKeptDrafts` filters all records by open page id, including gone-tab records that appeared after A mounted. Messagef13b9560. Flush A first, then include eligible other/gone-tab drafts on its page; preserving live-tab isolation still applies.

The previous Pages-reload gap is fixed: reviewer pages-reload.mjs now refuses without download and keeps its identity. Requested live-slot boundary passes; copied-opener actual browser recheck has distinct ids and both markers recover. Author export fixture independently repeated19/19 desktop Chromium and18/18 phone WebKit, including online recovery retry from Pages without visiting the edited page. Full422/0/11skip4todo(437 total), typecheck/build pass. No new source changes by reviewer.

The closed-same-page test's first attempt failed its precondition because the target wasn't scrolled into view; it is excluded. Final reproduction explicitly scrolls, checks actual stash, and uses the same1second quiet cutoff hook as the standing frozen tests. This proves a gone slot according to the app's rule, not native10minute timing. Script/output preserved. No production writes or native claims.

## Prior-head review

# B3 task170 — 33189ff recheck

**REVISE: Pages reload forgets the unsaved-export guard.** The original immediate pending-save defect is fixed: reviewer pending-save.mjs now exports the visible delayed marker. Both desktop and phone standing fixtures pass saving-first/refusal/retry paths. However reviewer390WebKit `pages-reload.mjs` types with saves blocked, navigates Pages, reloads Pages, then exports: sameIdentity=true, retainedDraft=true, downloads=1, row=Export. No save can have reached the server, so the successful export omits this tab's retained text. The `unsavedPages` set is memory-only and is reset on reload. Message2dfbe619.

Independent exact-head420/0/11skip/4todo(435 total), typecheck/build pass. Export fixture16assertions each1280Chromium/390WebKit pass; original pending-save.mjs passes. Copied-opener identity/draft recovery independently passes with distinct ids and both markers recovered; Pages reload identity remains unchanged. An initial copied-opener adaptation clicked an inline page chip and navigated away, so that invalid harness attempt is excluded; final run uses a dedicated synthetic plain-text document.

Lead934743fe/ff82e7c8 and authorf7dc0c6e choose recovery of this tab's retained drafts and gone-tab slots before export, preserving live-tab slots. Replacement-head gate must cover Pages reload/refusal, online retry recovering retained drafts without visiting pages, and no claiming another live tab's draft. `live-slot.mjs` is the new boundary regression. Native Safari/HomeScreen and long-hidden timing remain unverified as previously recorded.

## Prior-head review

# B3 task170 — 2f55b20 independent review

**REVISE: successful export can silently omit current typing.** Reviewer actual browser run typed a visible marker, delayed autosave POSTs1.8seconds, then immediately clicked Export. The ZIP arrived and row returned to Export, but workspace.json omitted the marker. AccountRow starts GET without flushing registered editors. Await flushAllEditors before downloading; if it cannot save, retain text and show the failure state rather than reporting a successful incomplete snapshot. Script pending-save.mjs and output preserved. Message8b6615ff.

Independent checks on this exact head (c4ed27f plus underline): full suite401 passed/0 failed/11 skipped/4 todo(416 total), typecheck/build pass. Existing export browser fixture13 assertions each at1280Chromium and390WebKit touch pass: download/busy/failure/retry, ZIP names/content/trash separation, Markdown nesting/styles/links, JSON format/internal exclusion, no-store, underline, no page errors. Auth-required disposable server unauthenticated /api/export returns401 signed-out; local auth-off forwarded request returns403. Route inspection confirms global auth gate and read-only repository load. No real data writes, no production endpoints.

Product/Bumblebee checked real-row copy224:22/22text pieces,7tasks,3linkpages; missingURLfixedc4ed27f. Those are attributed, not reviewer real-row execution. Jazz6557215d UI passes apply because only underline changed. GFM is accepted Obsidian stand-in perLead71e4568e; actual Obsidian and native HomeScreen/Safari download are not verified. Export native checks added to task155 list.

No application changes by reviewer. Await replacement head and rerun pending-save success plus refused-save no-download path.
