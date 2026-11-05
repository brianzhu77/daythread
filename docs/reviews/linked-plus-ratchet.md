# Independent PR141 review

Candidate bd7ba715. Changes requested: a previous in-flight page save lets the new property run before the linked column save, losing Undo again.

Independently reproduced in Chromium and WebKit: open the linked view, type on the line above it and hold that save, click the view's `+`, then release. Observed request order is `save-editor`, `addProperty`, `save-editor`; the property exists afterwards but the Undo count is zero and the only notice is Saved. `saved: () => flushRef.current()` resolves immediately when `sending.current` is already true, so awaiting it is not waiting for the new column to be saved.

Evidence: tests/evidence/ratchet-linked-plus/inflight.mjs and the two engine logs. All data is invented in an isolated SQLite store. Build passes. No application changes by reviewer.

The saved barrier must wait for the requested view edit to be persisted, and must not report success when the save failed or was refused. A network-failure recovery check is also being run.

The independent Chromium network-failure check also confirms the same ordering bug: abort only save-editor while allowing addProperty; the source property is added while the view is unsaved. Restore the network route and focus the tab; the recovered view save removes the property's Undo. Observed order: failed save-editor, addProperty, failed save-editor, recovered save-editor; Undo changes from one to zero. See failed.mjs and failed.log.
