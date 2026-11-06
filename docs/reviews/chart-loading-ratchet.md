# PR171 independent loading review

Task344. **Clear on the reviewed loading and save-before-reload paths.** Browser checks ran against built 7f21e30c. The subsequent 2e3417a2 diff changes the button from Retry to Reload, its comment, and the author script's wording; the reviewed runtime behavior is identical.

## Independent evidence

Production build, own synthetic SQLite workspace containing two charts on an ordinary editable page; no copy of Brian's data.

Both Chromium and WebKit passed:

1. Abort the chart JS chunk: both chart slots show unavailable, one chunk request serves both, and no page error occurs.
2. Type into the page, then abort all POST writes and press the recovery button: no document navigation occurs and the typed words remain in the editor.
3. Restore writes and module access, then press it again: saving succeeds before reload; both charts return and the newly typed words remain after reload.
4. Hold the chart chunk while both placeholders mount, navigate to Today before releasing it, then return using browser history: one import total, both charts draw on return, and no page error occurs. This exercises completion after the first chart instances unmount.

Scripts: `tests/evidence/chart/ratchet-seed.ts`, `ratchet-loading.mjs`, `ratchet-unmount.mjs`. Seed with the existing disposable `seed-table.ts`, then `ratchet-seed.ts`. The scripts target built preview port3737 and the synthetic `chart-review` page. They write only the passed throwaway store.

## Source review

The shared promise prevents parallel imports; rejection is consumed and exposed locally rather than thrown into the whole page. Each mounted instance subscribes with an effect-local live guard. The loaded module is reused on later mounts. Recovery awaits `flushAllEditors()` and reloads only on true, preserving the existing failed-save refusal behavior. Header movement keeps the chart view's own settings and callbacks.

No runtime fixes were made. No independent Worker, Postgres, native phone, real-data template, layout-shift, or render-budget measurement. Those are separate author/Lead gate evidence. This review does not assert that every possible dirty UI surface is an editor flusher; the new path explicitly uses the existing all-editor save contract.
