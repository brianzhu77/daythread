# B31 independent review — 7e8cfc7

Pass. Reviewed the final candidate in an isolated worktree and disposable SQLite imports of revision 362. No production writes. Native tests use Mobile Safari on an iPhone 17 / iOS 26.4 simulator with the actual Simplified Pinyin software keyboard.

## Verified

- Evening completion at 1280 Chromium: ticked task stays behind; two new lines land in Other once, in order; remaining tasks retain Top 3; morning card closes. Checkboxes and menus align within 1 px of first text lines.
- At 00:40, 390 WebKit: header names Today / Sunday, counts still describe Saturday, and Done writes Sunday's page. This repeats the approved after-midnight rule with the following date.
- Offline at 390 WebKit: Return-added line plus text left in the input block Done with two unsaved lines. Reconnection adds each once, and Done then succeeds.
- Leave without Done at 1280 Chromium: new lines remain on the next page once; the morning card offers only the outstanding carry tasks.
- Additional held-request check: Done with unsubmitted input while offline stops with one unsaved line. After reconnection, hold the next line's save, trigger online and visibility retries, then Done: each line exists once. Initial harness read Saturday instead of the target Sunday; corrected and reran with a fresh store. This was a harness error, not a product failure.
- Final candidate in native Safari: software w/a/n then tap 万 leaves 万 in New line, with no task created. A later Return adds exactly one row. A separate w/a/n then software Return confirms the composition as literal wan and keeps it in the input, without submitting. The committed event traces demonstrate actual native composition, not synthetic dispatch.
- Existing review text is passed through unchanged; the same review route serves the sidebar and page entry. No domain code changed. The existing B37/B47 coverage remains green in the independent full suite.
- Independent final suite: 478 passed, 0 failed (11 skipped, 4 todo); typecheck and build pass.

The native input checks also passed on initial ee95174; final 7e8cfc7 was rebuilt and rerun. Final source removes the timing dependence for Done's typed line and shares in-flight saves/ensure-day. Lead owns the merged alignment gate. Home Screen installation, physical iPhone and third-party keyboards remain unverified.

Evidence in tests/evidence/ratchet-b31: browser outcomes, held-request script, and native event traces/drivers. Native drivers use the Appium helper from test/ratchet-pinyin-native (9876f2c) and APPIUM_SESSION_ID / WEBVIEW_CONTEXT.
