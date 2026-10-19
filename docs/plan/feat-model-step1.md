# feat/model step 1 · capture through the model — plan for review

- Author: Roadbuster · 2026-10-19 · status: **plan, not built**. Nothing here runs a paid call or changes the database until the Lead and Ratchet have reviewed it.
- Inputs: 03 AI contract; probe results `docs/validation/model-quality-probe-run-2026-10-19.md` rev 2 (**Weak**: 6 of 45 calls with a critical error on Brian's model); Jazz `docs/design/capture-receipt-v2.md` (aa967ab, including "Date missing"); Lead rulings (b842c6d3: confirm-first as a switchable default, grounding as a separate safety net, one hop of linked context, persisted budget with a rollback script).
- **Brian's answer is pending** (Lead asked yes / wait, 1deebf03). No step 1 code until he answers. If "yes", the default is `auto` (his earlier C5 choice); otherwise `confirm`. Either way it's one setting, so his answer changes a value, not the code.

## 1. What changes for Brian

- The capture bar sends his text to his model (`OPENROUTER_MODEL`) instead of the simulated stand-in. His text is saved first and is never changed by the model.
- What happens to the result depends on one setting, `captureMode`:
  - `auto` (if Brian says yes): new items that pass the grounding check save at once; anything that fails waits in "Needs a look" with its reason chip; updates to existing tasks always wait (03 §5, unchanged).
  - `confirm`: every item waits in the receipt with Apply / Discard.
- The receipt is Jazz's v2: real dates, type / title / date fixable in one tap, Remove, Undo all.
- No key, a rejected key, the budget reached, or a model error: the text is saved and the receipt says so plainly ("Simulated · no model key", "Model unavailable · text saved", "Today's model budget is used up"). Nothing pretends to be the model.

## 2. Flow (server; the model call is never inside a database transaction)

1. **`capture`** (existing command, client) saves the raw text as a Capture with `status: "organizing"`, `revision: 1`. It returns at once, so the browser never waits on the model to keep his words.
2. **`organizeCapture({ captureId, revision })`**, a new server function (not a command), orchestrates:
   1. Loads the workspace. Stops if the capture is gone, discarded, at another revision, or already has an attempt in flight.
   2. Builds the request: the text, captured-at time, today's page, open tasks, and **one hop** of linked context (the subpages behind cards on today's page, and saved items whose source line is on today's page). The manifest line says "Linked pages: one level".
   3. Price: cached `/models` price for the model, refreshed at most daily. **Unknown or stale price = no call.** Worst case = input size × the highest rate the route can charge + 4000 output tokens × the highest completion rate.
   4. **`reserve-model-attempt`** (command): uses the existing `reserveBudget` on a stored ledger. One paid call in flight per workspace, 10 USD per Vancouver day, an unknown charge blocks further calls (03 E3). The `attemptId` is unique, so a replay is no new reservation.
   5. Calls OpenRouter: 60 s timeout, `max_tokens` 4000, the flat schema with task ids limited to the open tasks sent. A `length` stop counts as a failed answer.
   6. **`record-model-result`** (command), with `attemptId`, the cost or null, the generation id, and the items or a failure kind:
      - Settles the budget. A missing cost stays "unknown" and blocks the next call until reconciled.
      - If the capture's revision changed, it was discarded, or another attempt took over: the result is kept for audit but never applied (03 §6).
      - Otherwise: validates every item (shape, task ids, real dates; anything invalid is dropped, never guessed), runs `groundItem` on each, stores the proposals with their flags, and then applies according to `captureMode`.
3. **Late or lost results.** At timeout the attempt is marked `unknown`. If the answer arrives later, `record-model-result` settles it and still applies nothing to a capture that has moved on. A reply lost between server and browser changes nothing: the result is already stored, and the browser reloads it.
4. **Server restart mid-call.** On start, attempts left `reserved` become `unknown`. Reconciliation looks up OpenRouter's generation id (`/generation?id=`) and settles them. Until then, new paid calls are blocked and the receipt says why.

### Ratchet's four asynchronous cases (dc97bc7d), and where each is handled

| Case | Handling |
| --- | --- |
| The same result recorded twice (duplicate reply, retry) | `record-model-result` is keyed by `attemptId`; a second record with the same input returns the first receipt; a different input for the same attempt is refused |
| A result that arrives after the timeout | The attempt is `unknown` at timeout; the late result settles the cost and is applied only if the capture is still at that revision and no newer attempt exists |
| Brian edits, discards or deletes the capture while the call runs | Revision or status mismatch: the result is stored for audit, never applied; the budget is still settled |
| His original text | Stored by `capture` before any call; no model path writes to `Capture.text`; edits make a new revision |

### Ratchet's plan constraints (81a1eb86), and how the plan meets each

| Constraint | Plan |
| --- | --- |
| A timeout or crash may leave **no generation id**, so automatic `/generation` recovery can't be promised | An `unknown` attempt without a generation id stays blocking. `scripts/model-reconcile.ts <attemptId> <usd>` settles it with the amount from OpenRouter's activity page, or with `--worst-case`, which settles at the reserved upper bound. **Never at zero.** Until then the receipt says "Model paused · a charge needs checking". |
| **Rollback must not lose the ledger** (it would reset today's spend) | The rollback script **keeps** `model_attempts`: the previous build only verifies the tables it knows, which the round trip checks rather than assumes. Migration 2 uses `CREATE TABLE IF NOT EXISTS`, so rolling forward picks the same rows back up. The rollback script also writes the ledger to a JSON file next to the database as a second copy. The round trip asserts that today's spent and unknown attempts are the same after rollback and after rolling forward again. While a store is on the previous build, it makes no paid calls (the previous build has none). |
| **`record-model-result` and `reserve-model-attempt` must be server-only** | Both are left out of `commandSchema`, the schema the browser's `runCommand` validates against, so the browser can't send them. The orchestrator applies them through the repository on the server. A test sends them through `runCommand` and expects a rejection. |
| **Price reservation must cover the whole request** | The worst case uses the UTF-8 byte length of the full request body (messages, schema, context) as an upper bound on input tokens (tokens ≤ bytes), times the highest input rate, plus 4000 × the highest output rate. |
| **A repeated result with different values** must not settle or apply twice | The first record for an `attemptId` wins. A repeat with identical input returns the same receipt; a repeat with different values is refused and logged. Cost is settled once (`settleBudget` already refuses to overwrite). |
| **Invalid items must not silently disappear** | An item the app can't validate isn't dropped from view. The receipt shows "1 part couldn't be read · your text is kept" with the original text, and the capture keeps a `partial` flag. Nothing invalid is applied. |

## 3. Mapping model items to app changes

| Model item | App proposal | Applied as |
| --- | --- | --- |
| task | `create-task` with `plannedOn` (dateRole do) or `deadlineOn` (due) | existing task creation and placement rules; a do-date places it on that day |
| event | `create-event` with date, time or part of day | existing `add-event` domain logic, which today has no caller |
| note | `add-note` | a line in today's Notes |
| material | `create-material` with URL and note | existing `saveMaterial` (one item per URL) |
| update | `update-task` with markDone / new date, `expectedVersion` | always waits for Apply; version-checked |

## 4. Data and storage (SQLite layout 2 → 3)

- **New `model_attempts` table:** id, capture id, revision, day, reserved, actual, state, generation id, model, created/settled times. This is the stored form of `BudgetLedger`.
- **Captures:** new columns `model` (text) and `mode` (text). `simulated` becomes a real boolean instead of the literal `true`. Proposals (already JSON) gain `date`, `dateRole`, `time`, `note`, `flags`.
- **Workspace setting:** `captureMode`, default `confirm`.
- **Migration 2** adds the table (`IF NOT EXISTS`) and columns (migration 0 and 1 stay frozen). **`scripts/sqlite-rollback-model.ts`** goes back 3 → 2: it turns captures still `organizing` into `failed` with their text kept, drops the new capture columns, and **keeps `model_attempts`** plus a JSON copy (see Ratchet's constraints above). Ratchet tests the round trip as for /page, including the previous build opening the result and the ledger surviving.

## 5. Key and fallback

- The server loads `.env.local` explicitly at start (`process.loadEnvFile`, only if the file exists), because `vite preview` doesn't put it into `process.env`. The key is never sent to the browser or logged.
- `modelConfig()` returns null without a key → the receipt and the capture bar show "Simulated · no model key". A 401 or 403 → "Model unavailable · text saved", plus a one-line server log with no secret.

## 6. Grounding (safety net, measured separately)

`src/server/model/grounding.ts`, built but not wired in. It holds an item for a look when its title has no words from his text, a time or URL isn't literally in his text, an update targets a task he didn't name, or (Bumblebee) his text has a date word and the item came back without a date. Flags: `title-not-grounded`, `time-not-in-text`, `url-not-in-text`, `task-not-named`, `date-missing`.

**Preliminary measurement**, offline on the probe's raw outputs, my own run (Ratchet measures it independently in #67, and none of this is a promise to Brian):

| Run | Held | All held items were wrong ones? | Critical errors it does not catch |
| --- | --- | --- | --- |
| 3 | 8 of 51 | yes: C2 "Rewind 14:30", C10 "示例", C9 APPX update, and C15's undated items | none in run 3 |
| 2 | 2 of 47 | yes: C12 invented URL, C15 undated update | — |
| 4 | 11 of 51 | yes: C9 fake URLs, C15 undated items | C8 wrong date present (10-21) |
| 1 | 3 of 48 | yes: C15 undated items | C9 and C10 dates lost on items the model typed as notes |
| GPT-5.6 Luna | 2 of 51 | yes: C15 undated update | C8 wrong date present |

A wrong date that *is* present is left to the receipt, which now shows it (Jazz v2).

## 7. Receipt (Jazz v2, aa967ab)

New commands: `edit-capture-item` (title, type, date), `save-capture-item`, `remove-capture-item`, `undo-capture` (whole capture, refused if anything was edited since). The UI follows Jazz's rows, chips and copy.

## 8. Verification

- **Domain tests, no network:**
  - reserve, settle, unknown, daily cap;
  - stale result after a revision change, discard, or a second attempt;
  - duplicate `record-model-result`;
  - invalid items dropped;
  - grounding flags and `confirm` vs `auto`;
  - the update-always-waits rule.
- **Server tests with a fake provider:** `OPENROUTER_BASE_URL` points at a local fake. Covers timeout then late answer, lost reply, restart with a `reserved` attempt, 401, 402/429, a `length` stop, and invalid JSON.
- **SQLite:** upgrade 2 → 3; rollback script round trip; the previous build opens the rolled-back store in a browser.
- **Browser** (fake provider): capture → receipt at 1280 and 390, both modes, and Jazz's acceptance list 1–5.
- **Paid:** one live smoke call on Brian's model after review, under a step cap of $0.10, reported with its actual cost.

## 9. Not in this step

Step 2 (Draft my day and morning proposals: needs the previous day's page plus the open pool). The full transitive E1 crawl. Choosing the model. P16 (explicit Save on a Notes link).

## 10. Size and risks

- About 1.5–2 days, in three reviewable commits: (a) storage and budget, (b) orchestrator and mapping, (c) receipt UI.
- **Biggest risk:** stuck attempts after a crash blocking all capture. Mitigated by start-up reconciliation and a visible reason.
- **Second risk:** grounding checks words, not facts. It is a net for invented text only; wrong dates still need the receipt.
