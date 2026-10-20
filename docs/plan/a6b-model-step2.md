# A6b · the model drafts the day — plan for review

- Author: Roadbuster · 2026-10-20 · status: **plan, not built**. No code, no paid call until Lead, Ratchet and Jazz have reviewed it.
- Inputs:
  - Lead `02141609` (scope, steps), `90935fb5` (empty is normal), `8fa4f515` (Jazz's states accepted);
  - Brian `3097861f`;
  - Ratchet `b64dd79d` (four constraints, §5–§7);
  - Jazz `docs/design/morning-model-states.md` at dbf4fa7 (states and strings, with Bumblebee's wording; additions 0c16159, 5df9e03, date rule a5c5b51);
  - 03 AI contract; A6a `docs/plan/feat-model-step1.md`.

## 1. One call, one object

Draft my day, the review's Prepare tomorrow, Related and the card's "From your notes" all read **the same stored object, `Page.draft`**, which a simulated `generate-draft` fills today. So A6b is **one model call that fills one day's draft**. The model **only chooses**: task ids, material ids and line ids from what was sent, plus a date check for lines. Every visible word comes from his data or from the app. Nothing is written to his page or tasks until he taps `+` (Ratchet 1).

| Field | Shown as | Model returns | App supplies |
| --- | --- | --- | --- |
| `taskIds` (≤ 3) | Tasks group, reason "Drafted for today" (Jazz/Bumblebee); `+` sends to **TODO - Other**, never Top 3 (Lead `c1ba8868`) | ids from the candidates sent | title, reason, destination |
| `materialIds` (≤ 2) | Related | ids from the candidates sent | everything shown |
| `proposals` (new) | "From your notes", dashed `+` | `{ lineId, propose, date | null }` | title = **the line verbatim**, reason "{Mon} · {Section}" |

**Empty is a normal answer** (Lead `90935fb5`): the prompt says so, empty groups aren't drawn, and Jazz's "Nothing to suggest today" line shows. The existing `morning-prompt.ts` lets the model reword the title, so it is cut down to the schema above, not wired as is.

## 2. Steps and trigger (Jazz §1–§2)

- **Trigger: his tap only.** No call on open or reload. There's one draft per day; Retry only after a failure; the run belongs to the day it started for.
- **Retry after a failure is a new paid attempt for the same day and is always allowed**, unless the line says no Retry (paused, budget, too large). "At most one real run per morning" counts successful runs, not attempts.
- **Step 1:** "Draft my day" on the card is **the only real entry** (Lead, after Ratchet `8ba9abb6`). The card also shows on a day with nothing else, while there's no draft (Jazz §2, Lead `8fa4f515`).
  - **The evening review stays on its simulated path in step 1** and makes no request (Lead, after Ratchet `8ba9abb6`). On a day the review wrote a draft, the card shows "Suggested last night" as now, and Draft my day doesn't appear. So a morning has at most one real run.
- **Step 2:** the review's Prepare tomorrow through the same call, with the review text as extra input, read after step 1's success check (§8).
- **Step 3:** adjustments in the review text as update proposals (capture's always-wait path), only if asked.

## 3. Flow

1. **`generate-draft { date, trigger }`**, the existing command:
   - with a real model, it writes `draft = { status: 'drafting', runId, trigger, startedAt }` and returns;
   - it is refused if the day already has a ready draft, or a run that isn't failed;
   - simulated: unchanged, plus one example proposal for Jazz's states. Simulated never calls the network and never touches the ledger.
2. **`draftDay({ date, runId })`**, a server function shaped like `organizeCapture`:
   1. one workspace read builds the context and its manifest (§5);
   2. price, then **reserve**;
   3. call OpenRouter: strict schema, 60 s, `max_tokens` 2000;
   4. **`record-model-result`**: settles the cost and, in the same transaction, runs the server-only `set-model-draft { date, runId, result }`.
3. **Failure** (`key-rejected`, `unavailable`, `paused`, `budget`, `too-large`, `busy`): `draftError` with Jazz's line. His page and tasks are untouched. A real failure never falls back to a simulated draft.
4. **Busy:** one paid call at a time per workspace, shared with capture (Ratchet's ruling, Jazz 0c16159).
   - Draft my day while a capture is with the model → "Model busy · nothing was added · Retry". Nothing is reserved.
   - A capture while drafting → "Model busy · text saved · Retry". His text is saved first.
5. **A run stuck on "drafting" expires 90 s after the tap** (Jazz 0c16159; Ratchet `676b6ad1`; Lead `c1ba8868`). It's a **persisted server transition**, not a client relabel:
   - It's made by the next read of that day (`set-draft-expired`, server-only) and by start-up recovery, which turns runs left `drafting` from a previous process into expired.
   - **Expiry and a result race in one transaction keyed on `runId` + `status: drafting`.** Only one changes the draft. A result that loses still settles its cost but isn't published.
   - On expiry the attempt ends as a failure under A6a's ledger rules:
     - **with a generation id** → its cost is looked up; if it can't be found, the attempt stays `unknown`, and the card shows "Model paused · a cost couldn't be confirmed", with no Retry.
     - **without one** → `estimated` at the reservation, which frees it, and the card shows "Model unavailable · nothing was added · Retry".
   - The old "unknown outcome keeps the reservation and blocks" rule doesn't apply to an expired run without an id, or Retry would never appear.

## 4. Identity and replay (Ratchet 2)

- **What a run is bound to:** `runId` = the `generate-draft` operation id. Each run has a target `date`, a `trigger` (card or review), the request **fingerprint** (`requestHash` of the full body, which includes the manifest), the `model` and the `attemptId`.
- **Double tap or refresh:** the same operation id replays the first receipt. A different operation id while drafting is refused ("already drafting"). Either way, there's no second call and no second charge.
- **`set-model-draft` applies only if** the page's draft still has that `runId` and status `drafting`. Otherwise the result is kept for audit and the cost still settles. That covers Retry beating a late answer, Done or Later during the run (Jazz §1: kept, the card isn't reopened), a midnight crossing, and a deleted day.
- **Each proposal is bound to its source line's fingerprint** at run time: a hash of the line's text, its type and its **date basis** (the day §6 resolves relative words from). Ratchet `8ba9abb6` / `09223ddb`, Lead, Jazz a5c5b51 §4. A subpage moved under another day changes the basis, so the proposal is withdrawn, the same as an edit, with no new model call.
  - The card checks it when it draws:
    - text changed: the row is withdrawn, with no automatic paid re-run. "明天打给牙医" edited to "已经打过牙医" must not become a task.
    - only the section renamed: the app-computed reason updates.
  - **Accepting re-checks the same:** `add-proposal { date, runId, lineId }` refuses if the fingerprint changed, the line is gone, its page is in the trash, or the line already has a task. The row then disappears (Jazz §4).
  - The task title is the line's text as fingerprinted. Nothing is written back into the line.
  - `plan-tasks` keeps its own checks.
- **No duplicate tasks:** a proposal accepted twice (same operation id) replays; a second operation id finds the line already linked and refuses.
- **Where "accepted" is recorded (Ratchet `ae9c7b87` 2):** the source line is never touched, and `Task` has no `sourceBlockId`.
  - **The record:** `add-proposal` writes the new task's row on the drafted day's page with `sourcePageId` / `sourceBlockId` / `sourceFingerprint` in that row's block entry and in `editorBlockMetadata`. This is exactly how `bring-line` records "brought" (`wasBrought`, A8, shipped in 5193991).
  - **"Linked":** a line counts as linked when **any** page's blocks or block metadata hold that `sourcePageId` + `sourceBlockId`. Metadata outlives the row being deleted, as for brought lines, so deleting the task row doesn't bring the proposal back.
    - The check lives in **one named function**, `isLineLinked(ws, pageId, blockId)`. Its comment states the dependency: `save-editor` keeps a deleted block's metadata (Lead, the same condition as A8's `wasBrought`).
    - The test "delete the row, still not offered" deletes the row through the real `save-editor` path.
  - **Undo:** whole-workspace Undo removes the task, the row and its metadata together, so the line is offered again, the same as Bring.
  - **Same day, twice:** the second `add-proposal` finds the link and refuses.
  - **The next day:** the context builder leaves linked lines out of the manifest (§5), so a re-run never re-offers them.
  - `hidden` (Hide for today) lives in that day's draft only.

### 4a. Stored shape of `Page.draft` (Ratchet `ae9c7b87` 1)

Everything lives in the existing `draft` JSON column. The fields the live build (**53c1b83**, layout 4) reads are **always present** in every state:

```ts
draft: {
  simulated: boolean          // old field; false for a real run
  taskIds: string[]           // old field; [] while drafting or failed
  materialIds: string[]       // old field; [] while drafting or failed
  text: string                // old field; '' for a real run (no model prose)
  run?: {                     // new, real runs only
    runId: string; trigger: 'card'; startedAt: string
    status: 'drafting' | 'ready' | 'failed' | 'expired'
    attemptId: string; model: string; requestHash: string
    failure?: 'key-rejected' | 'unavailable' | 'paused' | 'budget' | 'too-large' | 'busy'
    manifest: {               // exactly what was sent (§5), stored with the run
      lines: { lineId: string; pageId: string; blockId: string; fingerprint: string }[]
      sentPages: string[]; omittedPages: string[]
      taskCandidates: string[]; materialCandidates: string[]
    }
    reasons?: Record<string, string>   // taskId → "Drafted for today"
  }
  proposals?: { lineId: string; pageId: string; blockId: string; fingerprint: string; date: string | null }[]
  hidden?: string[]           // lineIds hidden for today
}
```

- A failure also sets the existing `draftError`, which today's build already shows with its own Retry.
- **The ledger still keeps only `requestHash`.** The manifest in the draft is what can be audited, and its hash is part of the request body.
- **Old-build check (in §9):** with a draft in each status, today's build opens the file, edits that day's page and Undoes the edit, with no error screen. A new-build row carrying `sourceBlockId` survives the old build's save. Then the new build reads everything back unchanged.

## 5. Context: an auditable manifest (Ratchet 3, Lead: one hop + previous day page)

The request has labelled parts, and a **manifest** (part of the fingerprint, stored with the attempt) lists exactly what was sent:

- **Facts:** the day drafted, its weekday, timezone, and the date basis "lines are dated by the page they're on".
- **Task candidates:** `planned ∪ handoffTasks ∪ carry ∪` up to 20 open tasks (id, title, dates). Blank, paused, trashed-source and already-planned-today tasks are out.
- **His lines:** text and link lines from the **most recent previous day page**, plus **one hop**: pages behind cards on that page and on the drafted day's page.
  - Each line is `lineId = pageId/blockId`, with the page date or title and the section.
  - **Deduplicated** by `lineId`.
  - Left out: trashed or missing pages, task rows, page cards, empty rows, and lines already linked to a task.
  - Text inside lines is data. "Ignore the rules" written on a page is a line, not an instruction (system prompt + the labels).
- **Material candidates:** resurfacing, labelled **saved material**. They're never proposals (03 信任边界).
- **Length (Bumblebee `e24bfd8c`): whole pages are dropped; text inside a page is never cut.** The budget is 24 KB, about 6k tokens. His data today is a few KB.
  - Always sent: the facts, the task and material candidates, and the previous day page.
  - Then linked pages are added whole until the budget, nearest first: pages behind cards on the drafted day's page, then those on the previous day page, each in card order.
  - The manifest lists the pages left out. Only then does the card show one muted line under the Tasks group: "Read yesterday's page and 2 of 5 linked pages" (Jazz 0c16159, Bumblebee).
  - Only if the must-send part alone is over the budget is the call not made, with "Too much to read in one go · nothing was added" and **no Retry**. The model never sees half a page.
- **Output can only point at what was sent.** Any id not in the manifest is dropped and counted. Source names shown to him come from the app, never from the model.

## 6. Validation

- `taskIds` ⊆ the candidates, ≤ 3.
- `materialIds` ⊆ the candidates, ≤ 2.
- Proposals:
  - `lineId` must be in the manifest's lines;
  - **Dates are checked against the app's own parse** (Ratchet `ae9c7b87` 3).
    - **The parser:** a small deterministic one reads the line for exactly one day: 今天 / 明天 / 后天, 周X / 星期X / 下周X, today / tomorrow / (next) Mon–Sun, M/D, X月X日, YYYY-MM-DD.
    - **The basis:** the date of the page the line is on. For an undated page, the date of the day page it sits under (its `parentId` chain). With no day above it, relative words have **no basis**, and only absolute dates resolve.
    - **Keep the model's date only if** the parse yields exactly one date, it equals the model's, and it's ≥ the drafted day.
    - Otherwise it's set to null and the proposal stays undated: no date word, an ambiguous one ("下周"), no basis, a mismatch, or a past date.
    - "If I have time" lines never keep a date.
  - When in doubt there's no date tag; a date is never guessed (Jazz).
  - Tests: "周五" with the model returning Saturday → no date. A subpage with "明天" moved from under Mon to under Tue → proposal withdrawn. "明天" in an undated linked page with no day parent → no date, never guessed from the drafted day. "明天" in a subpage under Sun Oct 18 → Mon Oct 19.
- **Empty is not failure:** a valid answer with every `propose: false` and no picks is "Nothing to suggest today". An answer whose entries are **all** invalid (ids not sent, wrong shape), or invalid JSON, is `unavailable`, with Retry.

## 7. Cost: the same book (Ratchet 4)

- **Rules:** 10 USD per Vancouver day; atomic reserve before the call; worst case = full request bytes × the highest input rate + 2000 × the highest output rate. No id and no cost → `estimated` at the reservation; an id with no cost → `unknown`, which pauses until reconciled (`scripts/model-reconcile.ts`).
- **The ledger interface without a fake capture:**
  - `ReserveInput` gets `subject: { kind: 'capture' | 'draft', id, revision }` in place of `captureId` / `revision`.
  - Storage stays in the same `model_attempts` columns: a capture stores its id as now; a draft stores `draft:<date>` and revision = run number. **No migration, and no Capture row is created.**
  - `costUnknownCaptureIds` reads only `kind: capture`; `modelStatus` counts both.
  - A test shows a draft attempt never appears as a capture.
- **One call in flight per workspace, shared with capture** (Ratchet). The other one shows "Model busy" (§3) and reserves nothing.
- **Expected cost:** cents per draft on his data. No cost figure in the card (Jazz §3).

## 8. Simulated vs real, and success

- **Real** when `modelInfo().state === 'ready'`. `DAYTHREAD_DRAFT=simulated` keeps drafts simulated while capture stays real. Paused or out of budget shows Jazz's lines; it doesn't silently simulate.
- **Step 1 success** (Bumblebee / Lead `90935fb5`), on his real data after 5 writing days:
  - he uses Draft my day, or adds or hides a proposal, on ≥ 2 mornings;
  - nothing is written without his tap;
  - spend stays far below the cap.
  If he ignores both on 5 mornings, stop and ask Brian before step 2.

## 9. Checks

- **Before code (≤ $0.05, Lead's yes):** the cut-down prompt on his model with probe P1–P5 and his real Oct 18 lines. "肉酱意面 #recipe" and "奥德赛" should not be proposed. **Empty passes; a proposal count isn't a score.**
- **Domain:**
  - ids outside the manifest are dropped; a material is never a proposal; the title equals the line;
  - a stale `runId` isn't applied; the same op id replays; a second op while drafting is refused;
  - a line edited after the run withdraws its proposal from the card and from `add-proposal`; a section rename only updates the reason;
  - `add-proposal` re-checks the source (deleted, trashed, already a task), has Undo, and leaves the line unchanged;
  - the evening review makes no request and no ledger row in step 1;
  - Done or Later during the run doesn't reopen the card;
  - a run started before midnight lands on its own day.
- **Server with the fake provider, and a controllable clock (no real 90 s waits):**
  - double tap; refresh mid-run;
  - timeout, then Retry, then the old answer arriving;
  - 90 s expiry found on a refresh and found at a server restart;
  - expiry, then Retry, then the old answer, which settles without publishing;
  - expiry racing a result: exactly one wins;
  - expiry with and without a generation id (paused vs Retry);
  - `http401`, `http500`, `slow`, `length`, invalid JSON, too large;
  - busy both ways: no reservation, the capture text saved;
  - budget used up (`DAYTHREAD_MODEL_CAP_USD`); no ledger row for simulated.
- **Browser on a copy of his data at 1280 / 390:** Jazz §5 checks 1–7.
- **Rollback:** no migration, so the previous build opens the same file. Per §4a, with a draft in each status (drafting, ready, failed, expired), the live build **53c1b83** (layout 4; 5193991 is layout 3 and can't open it) opens it, edits that day's page and Undoes the edit, with no error screen. A row's `sourceBlockId` survives its save, and the new build reads it all back.
- **Accepted record:** `add-proposal` then Undo re-offers; deleting the row doesn't; the same day twice refuses; the next day's manifest leaves the line out.
- **Paid smoke after review:** one real draft on his data, under a $0.10 cap, with its cost reported.

## 10. Not in this plan

Model-written text anywhere he can see it; writing into the page; Weave; step 3 unless asked.
