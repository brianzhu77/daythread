# PR205 independent review

Reviewed runtime: 8fad6a7f, against cbccb51b. Reviewer: Ratchet. Isolated worktree, shipping CI dependencies, built preview on synthetic SQLite only.

## Result: changes required

**G6-5: removing a widget in another tab makes a stale filter edit disappear silently.** Reproduced independently in Chromium and WebKit at 1280.

1. Open Home's Dashboard in two tabs.
2. A enters Edit and removes `To-dos · Open`.
3. B still shows that widget. Remove its `Status is Open` filter chip.
4. The server refuses B with `Saved elsewhere`; B refreshes and the widget disappears. No notice or failure bar appears. Exactly one POST occurs.

`useDashboardRun` suppresses the initial refusal. After refreshing, `WidgetView`'s builder returns null for the missing widget; the second `run` returns without sending or displaying a refusal. The same null path exists if the dashboard/view disappeared. Surface the normal refusal when the refreshed action cannot be rebuilt. Preserve the one-retry limit and add coverage for this null path and a real second refusal.

Reproduction: `node tests/evidence/dashboard/ratchet-stale-remove.mjs http://127.0.0.1:3741`. Requires fresh synthetic `seed.ts` store; it removes and then undoes the same widget in each engine. Before repair both engines report `stale:1, refused:true, gone:true, notice:0, posts:1`.

## Evidence

- Build and typecheck pass using daythread-ci node_modules.
- Executed author's `phone.mjs` against my own built preview: Chromium 18/18 passes, including stale move + filter replay and stale Undo refusal.
- Independent `ratchet-phone.mjs`: Chromium and WebKit, five assertions each pass: tall-content clipping, expansion retained through SPA leave/return, expansion retained through responsive remount, no page horizontal overflow, no page errors.
- Independent stale-widget reproduction fails in both engines as described above.
- Source review of retry queue: initial refusal refresh completes before rebuilding; retries occur only for explicit Saved elsewhere, not ambiguous network failure. New operation IDs therefore do not introduce a replay of an already-applied operation in this path.

## Limits

No independent native iPhone/Simulator, Worker/Postgres, performance, long dashboard-name ellipsis, or wide-table sideways-scroll check. The synthetic Books table fits its phone width, so the sideways-scroll case is explicitly not run. No production data or external model calls.
