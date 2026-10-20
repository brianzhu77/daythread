# A6b · the model drafts the day — plan for review

- Author: Roadbuster · 2026-10-20 · status: **plan, not built**. No code, no paid call until Lead, Ratchet and Jazz have reviewed it.
- Inputs: Lead `02141609` (scope, steps, rules), Brian `3097861f` (capture: yes, not tried yet), Bumblebee / Lead `90935fb5` (success criteria, empty is normal), 03 AI contract (每日草稿, Review, 信任边界), morning-card-build §4 / §8 / §11 step 3, v05 §1, A6a `docs/plan/feat-model-step1.md` (ledger, fake provider, rollback), the existing `src/server/model/morning-prompt.ts` (probe only, never wired).

## 1. One call, one object

Draft my day, the review's Prepare tomorrow, Related and the card's "From your notes" all read **the same stored object, `Page.draft`**. Today a simulated `generate-draft` fills it. So A6b is **one model call that fills one draft** for a day, not four features. The call returns choices and wording only; the app shows them, and nothing is written until Brian taps.

| Field (on the day it's for) | Shown as | Today | A6b |
| --- | --- | --- | --- |
| `taskIds` (≤ 3) | card "Suggested last night" → Top 3; review's Tomorrow list | first 3 candidates | model picks from the candidates sent, one short reason each |
| `materialIds` (≤ 2) | Related (Today strip, review) | first 2 resurfacing materials | model picks from the candidates sent |
| `proposals` (new) | card "From your notes", dashed rows | none | model picks lines from Brian's own writing and words a title |

**"Nothing to propose" is a normal answer** (Lead `90935fb5`). The prompt says so; empty groups aren't drawn; no minimum count anywhere.

## 2. Steps

| Step | Ships | Trigger (never on page open, 01 §3.1) |
| --- | --- | --- |
| **1** | Draft my day with real `taskIds` + `materialIds` + `proposals`; the card's "From your notes" group with + / Not today / Undo | "Draft my day" and "Retry" on the card |
| **2** | Review's Prepare tomorrow uses the same call, with his saved review text as extra input | "Prepare tomorrow" / "Retry" in the review |
| **3** (only if asked) | Explicit adjustments in the review text ("tax return 搞定了") as update proposals, reusing capture's always-wait update path | review save |

Step 1 doesn't depend on capture. Step 2 starts only after step 1's success criteria (§7) are read.

## 3. Call point and flow (same shape as A6a)

1. **`generate-draft`** (existing command): if the model is `ready`, it saves `draft = { status: 'preparing', revision: n+1, simulated: false, … }` and returns at once. If simulated, it stays as today, plus one example proposal so Jazz's states can be reviewed (§11 step 3).
2. **`draftDay({ date, revision })`**, a server function, like `organizeCapture`:
   1. Builds the context (§4) from one workspace read and stops if the draft moved on.
   2. Price and reserve (§6) under subject id `draft:<date>`, with `revision` = draft revision.
   3. Calls OpenRouter: strict JSON schema, 60 s timeout, `max_tokens` 2000.
   4. **`record-model-result`** settles the cost and, in the same transaction, runs the server-only **`set-model-draft`** command. It applies only if the page's draft is still `preparing` at that revision. Otherwise the result is kept for audit, not applied (late or replayed answers).
3. Failure, timeout, or invalid JSON → `draftError` with the kind (`failure` / `budget` / `paused` / `too-large`). His page and tasks are untouched. Retry makes a new revision.

## 4. Context (Lead: one hop + the previous day page)

Labelled sections in one user message, ids with every item, never free text without an origin:

- **Facts:** today and weekday, timezone, the day being drafted.
- **Task candidates:** `planned ∪ handoffTasks ∪ carry ∪` up to 20 open tasks (ids, titles, dates, why each is a candidate). Blank-title tasks are already out (`isBlankTask`).
- **His lines:** text and link lines of the **most recent previous day page** (all sections except task rows), plus **one hop**: pages behind cards on that page and on today's page. Each line carries `lineId = pageId/blockId`, page date or title, and section. Lines already handled (§5) aren't sent.
- **Material candidates:** resurfacing materials (title, URL, his note), labelled **saved material**. Per 03 信任边界, material text is never a source of proposals, and command sentences inside it aren't his.
- **Size:** if the request is over a fixed limit (start 24 KB, about 6k tokens), the call isn't made and the card shows "Too much to read in one go". It's never truncated silently (03 输入上下文). His real data today is far below this.

## 5. Output → app (validated; anything invalid is dropped and counted, never guessed)

- `taskIds`: each must be in the candidates sent; ≤ 3; one `reason` (≤ 60 chars). Unknown ids are dropped.
- `materialIds`: each must be in the candidates sent; ≤ 2.
- `proposals[]`: `{ lineId, title, date | null, reason }`.
  - `lineId` must be one of **his lines** sent (never a material).
  - `title` must pass the existing `groundItem` title check (words from that line), in his language.
  - `date` ≥ today and resolved from the line's own day (the prompt from `morning-prompt.ts`). "If I have time" lines get no date.
  - Lines already turned into a task or dismissed aren't proposed again.
- **Landing:** nothing is applied by the model.
  - `+` on a task row = the existing `plan-tasks`.
  - `+` on a proposal = new command **`add-proposal { date, proposalId }`**. It creates a task in the plan list (Top 3 rule as now), `sourcePageId` = the line's page, and never edits the source line.
  - Not today on a proposal = `dismiss-proposal`.
  - Each tap has the existing Undo strip (whole-workspace Undo).
  - Handled lines are kept in `page.draft.handledLines: { lineId, taskId? }[]` and carried into the next draft for that day, so a re-draft never re-offers them.
- **Storage:** all of this lives in `Page.draft`, which is already a JSON column. **No migration.** Rollback = the previous build. Older builds read `draft` as JSON and ignore the extra keys (Ratchet to confirm with the round trip). Tasks made from proposals are ordinary tasks.

## 6. Cost (A6a rules unchanged)

- 10 USD per Vancouver day; worst-case reservation = request bytes × the highest input rate + 2000 × the highest output rate.
- An `estimated` attempt (no id, no cost) counts at its reservation and doesn't block. An `unknown` one (an id, no cost) pauses calls until it's reconciled. The same ledger, `model_attempts`, keeps `captureId = 'draft:<date>'` and `revision` = the draft revision, so there's no schema change.
- **Decision for Ratchet:** A6a allows one paid call in flight per workspace, so a capture during a draft call would be refused. Proposal: one in flight **per kind** (capture, draft); the cap check still sums every reservation.
- Expected cost per draft: a few cents at most on his data. The receipt shows the real cost the way capture does.

## 7. Simulated vs real, and success

- Real when `modelInfo().state === 'ready'` (key present, not paused, budget left). `DAYTHREAD_DRAFT=simulated` keeps drafts simulated while capture stays real. Otherwise simulated, with the existing "Simulated" tag. Nothing pretends to be the model.
- **Step 1 success** (Bumblebee / Lead `90935fb5`), judged on his real data after 5 writing days:
  - he uses Draft my day, or adds or dismisses a proposal, on ≥ 2 mornings;
  - nothing is written without his tap;
  - spend stays far below the cap.
  If he ignores both for 5 mornings, stop and ask Brian before step 2.

## 8. Checks

- **Before code (≤ $0.05, Lead's yes needed):** run probe Part 2 (P1–P5) plus his real Oct 18 lines through `morning-prompt.ts` on his model. "肉酱意面 #recipe" and "奥德赛" should come back unproposed, or with a believable reason (Lead `90935fb5`).
- **Domain:**
  - ids outside the candidates dropped; material lines never proposed;
  - stale revision / replay / late answer not applied; empty answer → no group;
  - handled lines not re-offered; `add-proposal` + Undo; source line unchanged.
- **Server with the fake provider:** timeout, invalid JSON, `length` stop, 402/429, too-large refusal, a capture and a draft at once (per-kind rule), budget used up.
- **Browser on a copy of his data at 1280 / 390:** Jazz's states (loading, failure, empty, budget used up).
- **Paid smoke after review:** one draft on his data under a $0.10 cap, reported with its cost.

## 9. Not in this plan

Writing into the page from the model; a free-text draft summary (ungrounded prose); Weave; step 3 unless Lead asks.
