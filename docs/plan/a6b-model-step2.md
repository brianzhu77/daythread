# A6b · the model drafts the day — plan for review

- Author: Roadbuster · 2026-10-20 · status: **plan, not built**. No code, no paid call until Lead, Ratchet and Jazz have reviewed it.
- Inputs:
  - Lead `02141609` (scope, steps), `90935fb5` (empty is normal), `8fa4f515` (Jazz's states accepted);
  - Brian `3097861f`;
  - Ratchet `b64dd79d` (four constraints, §5–§7);
  - Jazz `docs/design/morning-model-states.md` at d8763e6 (states and strings; Bumblebee's wording `9a13d092` goes through Jazz);
  - 03 AI contract; A6a `docs/plan/feat-model-step1.md`.

## 1. One call, one object

Draft my day, the review's Prepare tomorrow, Related and the card's "From your notes" all read **the same stored object, `Page.draft`**, which a simulated `generate-draft` fills today. So A6b is **one model call that fills one day's draft**. The model **only chooses**: task ids, material ids and line ids from what was sent, plus a date check for lines. Every visible word comes from his data or from the app. Nothing is written to his page or tasks until he taps `+` (Ratchet 1).

| Field | Shown as | Model returns | App supplies |
| --- | --- | --- | --- |
| `taskIds` (≤ 3) | Tasks group, reason "Drafted for today" (Jazz/Bumblebee) | ids from the candidates sent | title, reason, destination |
| `materialIds` (≤ 2) | Related | ids from the candidates sent | everything shown |
| `proposals` (new) | "From your notes", dashed `+` | `{ lineId, propose, date | null }` | title = **the line verbatim**, reason "{Mon} · {Section}" |

**Empty is a normal answer** (Lead `90935fb5`): the prompt says so, empty groups aren't drawn, and Jazz's "Nothing to suggest today" line shows. The existing `morning-prompt.ts` lets the model reword the title, so it is cut down to the schema above, not wired as is.

## 2. Steps and trigger (Jazz §1–§2)

- **Trigger: his tap only.** No call on open or reload. There's one draft per day; Retry only after a failure; the run belongs to the day it started for.
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
3. **Failure** (`key-rejected`, `unavailable`, `paused`, `budget`, `too-large`): `draftError` with Jazz's line. His page and tasks are untouched. A real failure never falls back to a simulated draft.

## 4. Identity and replay (Ratchet 2)

- **What a run is bound to:** `runId` = the `generate-draft` operation id. Each run has a target `date`, a `trigger` (card or review), the request **fingerprint** (`requestHash` of the full body, which includes the manifest), the `model` and the `attemptId`.
- **Double tap or refresh:** the same operation id replays the first receipt. A different operation id while drafting is refused ("already drafting"). Either way, there's no second call and no second charge.
- **`set-model-draft` applies only if** the page's draft still has that `runId` and status `drafting`. Otherwise the result is kept for audit and the cost still settles. That covers Retry beating a late answer, Done or Later during the run (Jazz §1: kept, the card isn't reopened), a midnight crossing, and a deleted day.
- **Each proposal is bound to its source line's fingerprint** at run time (a hash of the line's text and type; Ratchet `8ba9abb6`, Lead).
  - The card checks it when it draws:
    - text changed: the row is withdrawn, with no automatic paid re-run. "明天打给牙医" edited to "已经打过牙医" must not become a task.
    - only the section renamed: the app-computed reason updates.
  - **Accepting re-checks the same:** `add-proposal { date, runId, lineId }` refuses if the fingerprint changed, the line is gone, its page is in the trash, or the line already has a task. The row then disappears (Jazz §4).
  - The task title is the line's text as fingerprinted. Nothing is written back into the line.
  - `plan-tasks` keeps its own checks.
- **No duplicate tasks:** a proposal accepted twice (same operation id) replays; a second operation id finds the line already linked and refuses.

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
- **Length:** over 24 KB (about 6k tokens), the call isn't made, and the line reads "Too much to read in one go · nothing was added". **Nothing is truncated.** His data today is a few KB.
- **Output can only point at what was sent.** Any id not in the manifest is dropped and counted. Source names shown to him come from the app, never from the model.

## 6. Validation

- `taskIds` ⊆ the candidates, ≤ 3.
- `materialIds` ⊆ the candidates, ≤ 2.
- Proposals:
  - `lineId` must be in the manifest's lines;
  - `date`, if any, must be a real date ≥ the drafted day; otherwise it's set to null, never guessed. The date tag shows only when the line has a date word (the existing grounding date check on the line text);
  - "If I have time" lines with a date get the date dropped.
- Everything invalid is dropped. If every item is invalid, it's `unavailable`, the same as A6a.

## 7. Cost: the same book (Ratchet 4)

- **Rules:** 10 USD per Vancouver day; atomic reserve before the call; worst case = full request bytes × the highest input rate + 2000 × the highest output rate. No id and no cost → `estimated` at the reservation; an id with no cost → `unknown`, which pauses until reconciled (`scripts/model-reconcile.ts`).
- **The ledger interface without a fake capture:**
  - `ReserveInput` gets `subject: { kind: 'capture' | 'draft', id, revision }` in place of `captureId` / `revision`.
  - Storage stays in the same `model_attempts` columns: a capture stores its id as now; a draft stores `draft:<date>` and revision = run number. **No migration, and no Capture row is created.**
  - `costUnknownCaptureIds` reads only `kind: capture`; `modelStatus` counts both.
  - A test shows a draft attempt never appears as a capture.
- **Decision for Ratchet:** today only one call can be in flight per workspace, so a capture during a draft would be refused. I propose one in flight **per kind**, with the cap check summing every reservation.
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
- **Server with the fake provider:** double tap, refresh mid-run, timeout then Retry then the old answer arriving, `http401`, `http500`, `slow`, `length`, invalid JSON, too large, a capture and a draft at once, budget used up (`DAYTHREAD_MODEL_CAP_USD`), no ledger row for simulated.
- **Browser on a copy of his data at 1280 / 390:** Jazz §5 checks 1–7.
- **Rollback:** no migration, so the previous build opens the same file. A round trip checks that it ignores the extra `draft` keys.
- **Paid smoke after review:** one real draft on his data, under a $0.10 cap, with its cost reported.

## 10. Not in this plan

Model-written text anywhere he can see it; writing into the page; Weave; step 3 unless asked.
