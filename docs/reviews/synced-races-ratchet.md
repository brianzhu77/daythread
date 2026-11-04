# Synced blocks: independent race review

2026-11-04 UTC. Candidate `feat/b21-tasks` **3d592fbf**, including `feat/b21-make` **8fd8151e**. Own isolated worktree, built app at localhost:3696, invented SQLite store `/tmp/ratchet296.sqlite`. No production data or writes. Source review and probes were formed before reading the earlier review findings.

**Verdict: two reproduced failures; follow-up fixes required.** These are new paths beyond the passing ordinary save/conflict tests. The feature has already shipped; this report does not claim that Brian encountered either failure.

## 1. Unsync/Delete replaces typing done during the command (high)

`page-editor.tsx:1803–1808`, `endPlace`: it awaits a flush and a server command, then unconditionally applies the resulting page over the live editor. Typing remains enabled while the command is pending.

Repro (`races.mjs`):

1. Seed the two-place synced block with `tests/evidence/b21/seed.ts`.
2. Open Page B, hover Shared one to reveal the label, select **Unsync here** (also reproduces with **Delete**).
3. Hold that command's POST at the network boundary.
4. Type ` TYPED DURING ACTION` at the end of **Below on B**, outside the block.
5. Release the POST. The suffix disappears from the editor and stored page. The page reports `Couldn't save · draft kept` alongside the command's success notice.
6. Reload. The suffix is absent from the editor and stored page, and the local-storage draft entry containing it is now gone.

Both branches reproduced in Chromium and WebKit, including with a completely cleared store per scenario. `races-clean.log` records screen text, stored document, notice, local draft presence and post-reload state. The draft exists briefly, so a person who copies it before reloading might salvage the text; the normal reopen path does not.

Suggested fix: serialize the destructive command with an actual successful editor flush and protect the editor while it is pending, or reconcile the returned structural change against all edits since dispatch. An already-running flush returning immediately must not count as successful. Failure must leave the current draft and document intact; success must not replace later typing. Check the same boundary in the removed-line Undo callback at line 967 as well; that callback has a similar apply-after-await shape but was not independently reproduced in this review.

## 2. Undo during an in-flight bullet save is reversed by the reply (high)

`page-editor.tsx:970` calls `blockUpdates(..., true)` against the current editor, without comparing it with the dispatched snapshot. In `domain/synced.ts:305–309`, current content equal to the old key is treated as unchanged, even when a user explicitly undid the dispatched edit. The reply then restores the undone text, and the editor reports Saved.

Repro (`pending-undo.mjs`, isolated Chromium and WebKit):

1. Open Page B's existing Shared one bullet.
2. Hold the first POST. Type ` SHOULD UNDO`, wait for the save to dispatch.
3. Press ⌘Z. The screen is back to **Shared one**; captured before releasing the request.
4. Release the save and settle. Both screen and shared record now contain **Shared one SHOULD UNDO**; status is **Saved**.

`undo-isolated-chromium.log` and `undo-isolated-webkit.log` record before-reply and after-reply text and the stored record. Ordinary Undo after a completed save passes, so that test does not exercise this race. Recommendation: track whether this block changed after dispatch (including a change back to its base), and only follow a saved block's lines when the current block still matches the dispatched state. Preserve the Undo as an outstanding edit and send it next. A solution must also keep unchanged sibling places following the new shared record.

## Checks and limits

- Own build and typecheck pass. Full unit suite: **410 pass, 0 fail, 5 skipped**.
- Independently reran four author scenarios in Chromium: two places changing concurrently retain both versions; typing during a pending save persists; another place editing before the queued next save retains the conflict copy; Undo after a completed save propagates. All pass (`baseline.log`).
- Fault contexts explicitly block service workers so interception is real. These are save-response races, not service-worker or native keyboard checks.
- First draft of the replay tried to click a hidden label without first hovering its block; corrected that harness error. Earlier exploratory Undo runs reused a seeded store and one overlapped another local probe; those runs are not evidence. Only the explicitly isolated logs establish finding 2.
- No physical iPhone, Home Screen run, or real Postgres race test in this review. Those remain separate validation limits.

Replay from the worktree with its build/server using **your own throwaway** `BASE` and `STORE` environment variables. The scripts seed/reset that store. Do not point them at another agent's port or any real workspace.
