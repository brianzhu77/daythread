# PR49 independent review

PASS on `df9624f` (base main `5cc7a56`), October 31, 2026. No application changes requested.

## Independent checks

Built the reviewed tree and ran the real saved-draft hook against an invented SQLite workspace, without the window draft stand-in. Ten groups pass: five each in Chromium at 1280 and touch-enabled mobile WebKit at 390.

- Apply, Skip and Apply all complete their actual stored action without focusing the editor.
- More-open toggle and its plus button do not focus the editor; plus actually inserts the existing task.
- Tapping the new suggestion's text focuses that field. Typed words survive actual Apply all; focus stays out of the editor afterward.
- More-open is below a paragraph named Intentional Drop / Slack and its `- ` line, and above the Raw Notes divider. This checks the paragraph form rather than the heading used in the author's fixture.

The source change suppresses the button's mouse focus default on the retained widget host, leaving editable text unaffected. The separate placement field flows through the real hook; fallback placement remains unchanged. Roadbuster independently reviewed the broader placement cases; those conclusions are not counted as my browser checks.

Own typecheck and build pass. Own unit suite: 215 pass, 0 fail, 3 skipped. PR head was rechecked after the browser run and remains df9624f.

## Evidence and limits

`tests/evidence/ratchet-tap/seed.ts`, `review.mjs`, `review.log` and two screenshots reproduce the real-action checks. Start a built preview on 3688 with `DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet252.sqlite`, then run `node tests/evidence/ratchet-tap/review.mjs` from this worktree. The runner resets only that invented store between cases. Screenshot follows the plus action, so the now-empty more-open control has disappeared; placement is asserted before the action.

Mobile WebKit is emulation, not an actual iPhone or native keyboard observation. The tested claim is DOM focus after touch, not direct evidence of the physical keyboard staying hidden. No production data, provider calls or production writes were used. Own preview is stopped after review.
