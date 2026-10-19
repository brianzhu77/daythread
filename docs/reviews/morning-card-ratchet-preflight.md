# A8 morning card — acceptance preflight

Task #74. Baseline b63eb4e / live960d5d4. Contract: Lead e602d3b1 steps1–2 only; morning-card-build §10 with Jazz §12 (5f05fc2). No From your notes group, draft.proposals, simulated proposal examples or real-model calls this round. This is a plan, not implementation validation.

## Tasks and card state

- Draft task and unfinished task overlap: one row, draft order wins, exactly one Suggested last night reason. Same IDs after adding. Exclude done, paused, today-planned and already-Top3 tasks. Unfinished rows follow existing source order, uncapped as already accepted.
- Suggested + goes to actual Top3-role section; unfinished + to actual plan/other-role section. Full Top3 falls back correctly. Read real section names in all feedback (Brian: TODO - Top3 / TODO - Other), including renamed sections. Missing plan section: truthful pre-action notice, correct section created, Undo removes it only when unchanged.
- Add all tasks preserves source-specific destinations and never adds plain lines. On a partial storage failure, do not claim unsaved rows were added or silently discard them. Check rapid double-click/replay avoids duplicate placements/tasks.
- Undo strip visible5seconds with correct destination; last row/card closes only after its strip finishes. Undo within valid unchanged state restores exact IDs/content/placement/section state. After a subsequent edit, refuse whole, preserve edits, show Can't undo · edited since inline without misleading retry. Older Undo strips after another action must not revert unrelated changes.
- Not today / Another day / Open task are under menu and retain task semantics. Done/Later do not add or alter items; Done hides today, Later count and reopening are accurate. No qualifying items gives no empty card; lines-only card works. Missing/failed draft states stay truthful; proposals group absent.

## Editor flush — high risk (Lead5f3615d0)

- Type in today's editor, click task + or Bring within0.5seconds: pending text is flushed first, action applies afterwards, no self-conflict, lost words, replaced document or stale editor reset. Repeat Add all, Another day, Not today and Done where they write the same page.
- Inject failed/offline/conflicting flush: card action does not execute, persisted tasks/placements/lines unchanged, local editor draft kept and existing save-failure recovery remains available. Retrying must not duplicate the later card operation.

## Bring to today — parity and identity

- Only nonempty text/link lines from previous daily Notes / Good Stuffs qualify. Reject task rows, page cards and event references in BOTH query and command (Roadbuster140a2fb5). Preserve source page/body/blocks byte-for-byte; create new target block ID with sourcePageId/sourceBlockId.
- Same-named section is chosen; when absent, use Notes. Do not match merely by section kind and silently choose a differently named heading. Check same-named renamed/custom sections and absent Notes fallback against final accepted behavior.
- Execute the same semantic editor-save projection as typing, not old keep-block direct section mutation. Source inline formatting/links and #tag survive the copy; tag index updates. Good Stuffs URL produces another source/save of the same existing material with correct note and IDs, not a duplicate Material. Compare typed and brought fixtures. Plain URLs in Notes follow today's accepted rules; do not accidentally implement deferred A2 URL-to-page behavior.
- Never-opened today's template rows survive. Copy at correct section boundary without swallowing next heading or creating Task from plain prose. Stale/missing source or target-save failure creates neither partial copy nor material/source effect.
- Double-tap/replay/concurrent Bring of same source yields one copy/save per source for today. Different source blocks with identical text remain distinct. After reload and subsequent editor save, source identity survives.
- **Strict dedup without new column** (Roadbuster140a2fb5): deleted copy remains remembered through existing editorBlockMetadata, so not reoffered. Strip Undo restores pre-Bring document AND metadata and makes it offered again. Test deletion, reload, old-build save and return; do not turn pre-Bring unedited metadata into a false “already brought” marker.

## Persistence / rollback gate

Source check: NoteBlock already has sourcePageId/sourceBlockId, editorBlockMetadata is an existing JSON field; save-editor caches old blocks and ordinary projectDocument rows spread prior metadata. Therefore a no-new-field implementation can plausibly roll back to960d5d4 with rebuild only. This is conditional, not yet verified on the future implementation.

At candidate: compare schema/migrations; bring tagged/link line, delete its copy, open same temporary DB with960d5d4, perform a real old editor save, return to candidate. Verify current+undo metadata, source dedup, tag/Material/source consistency, task IDs/placements and independent budget ledger. Old build must open and write without dropping unknown state. Any new column/layout version requires an explicit rollback decision.

## Real-data and visual gate

Use consistent SQLite backup from read-only real source; separate test database, no model credentials, independent cacheDir or built preview. On Brian's Oct18→Oct19 sample at1280 and390, capture Today, previous day, Pages and other principal screens. Inspect actual screenshots plus page errors, console errors and visible error boundaries. Do not rely on a seeded top-level root to stand in for real data again.

Verify collapsed line count/text, qualifying source contents and correct real destination names. Long Chinese titles wrap two lines; +/menu44px targets, no overlap. No editor-input/save error screen. Domain tests use controlled fixtures; real-data screenshots show actual data shape. Real iPhone/IME remains separately unverified unless actually exercised.

Lead3e52b5d8 finalizes strict dedup: implementation must centralize the check in a named domain helper (e.g. broughtSourceIds) with an explicit dependency on retaining deleted-block editorBlockMetadata. The deletion regression must remove the block through real save-editor, not mutate projection directly. No fallback live-copy-only rule or B-list item this round.
