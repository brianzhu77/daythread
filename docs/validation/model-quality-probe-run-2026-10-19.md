# Model quality probe · runner's results · 2026-10-19

- Runner: Roadbuster, branch `feat/model`. Cases, expected answers and pass rule: `docs/validation/model-quality-probe.md` @ `1059f08`, frozen before any call.
- **This is the runner's own scoring.** Bumblebee judges borderline lines; Ratchet re-runs independently (task #67). Neither is replaced by this file, and only #67 is the formal result.
- **Correction (revision 2 of this file):** the first version said run 3 "passes the rule". That was wrong. The frozen rule counts every critical error in any single run; it allows at most 1. I counted at most one per line, and my checker missed invented titles and lost dates. Under the rule, **every configuration is Weak**, including the GPT alternative. The table and the run-3 section below are corrected.
- Model under test: Brian's choice, `deepseek/deepseek-v4.1-flash-1017` (`.env.local`). It was not swapped. Two alternatives were measured for comparison only.
- Raw answers for every call (including failures), cost per call and per-line results: `docs/validation/evidence/model-probe-2026-10-19/<run>/`.
- Runner: `scripts/model-probe.ts`. Before each call it admits the call only if spent + that call's worst case stays under the run cap. A missing cost counts at the worst case.

## Runs

The prompt wording is identical in all runs. Runs 2–4 change only the schema or call settings, which were general fixes, not tuned to these lines.

| Run | What changed | Lines correct (≥2 of 3) | Calls with a critical error | Rule result | Capture calls correct | Failed calls | Median / p90 latency | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | First schema (one object type per kind), max 1200 output tokens | 15/20 | 3 | **weak** | 30/45 (67%) | 2 | n/a | $0.0112 |
| 2 | Flat item schema; task ids limited to the open tasks sent | 19/20 | 2 | **weak** | 38/45 (84%) | 4 | n/a | $0.0112 |
| 3 | Run 2 + max 4000 output tokens | 19/20 | 6 | **weak** | 38/45 (84%) | 0 | 2.0 s / 5.6 s | $0.0122 |
| 4 | Run 2 with reasoning switched off | 17/20 | 8 | **weak** | 34/45 (76%) | 0 | 0.8 s / 1.3 s | $0.0040 |
| alt | `openai/gpt-5.6-luna`, run 3 settings | 17/20 | 3 | **weak** | 37/45 (82%) | 0 | 1.7 s / 3.9 s | $0.0150 |
| alt | `anthropic/claude-haiku-5.5`, run 3 settings | — | — | not measured | — | 22 of 22 rejected (HTTP 400) | — | $0 (not charged) |

Critical errors are counted per call (one call can hold several), by `scripts/model-probe-critical.ts <run…>`: a wrong or lost date on a dated case, an invented title / time / URL, a duplicate instead of a reference, an update aimed at a task he didn't name. Calls that returned no answer are not counted as critical; they are failed calls.

OpenRouter's key usage after all runs: **$0.0551 in total**, below the $0.50 cap. The runner's "counted" total is higher because it books every unanswered call at its worst case.

## What failed and why

- **Run 1, schema.** The model picked the wrong item type for a bare URL (task instead of material, C4 0/3), and twice "updated" a task with an empty id. Limiting `taskId` to the real open-task ids and using one flat item shape fixed both (run 2).
- **Runs 1–2, empty answers.** The model reasons before answering. With `max_tokens` 1200 the reasoning alone used the budget (`finish_reason: length`), so the answer came back empty (C8 3/3 in run 2). Run 3 raises the limit to 4000. The client now treats a `length` stop as a failed answer instead of parsing a cut-off one.
- **Run 4, reasoning off.** Faster and cheaper, but the dates get worse ("下周三之前" → 10-21 instead of 10-28, 3/3) and it invents URLs from plain text (C9). Not recommended.

## Run 3 in detail

19 of 20 lines are right by the 2-of-3 rule, but **6 of 45 capture calls hold a critical error**:

- C2 run 2: an invented event "Rewind" at 14:30 today, from "Lunch with Kevin next Mon 12:30" (invented title and time, wrong date).
- C10 run 3: the title "示例" ("example") instead of "交房租".
- C9 run 3: an update to the APPX task instead of a new "Cairn cron job prod deploy" task.
- C15, all 3 runs: "今天" lost on at least one of the three items (the APPX update without a date; in run 1 none were dated).

In the app each capture is a single call, so roughly one capture in six would need a fix, and some of those fixes are for invented text.

## Grounding check (measured separately, not a promise)

Bumblebee's safeguard: an item is applied without asking only if it can be traced to Brian's text (title words from his text, any time or URL literally in it, an update only for a task he named). It's in `src/server/model/grounding.ts`. Measured offline on the raw outputs above, with no new calls:

| Run | Items held for a look | Which |
| --- | --- | --- |
| 3 | 3 of 51 | C2 "Rewind 14:30", C10 "示例", C9 APPX update: the three invented cases, and nothing correct |
| 2 | 1 of 47 | C12 invented URL |
| 4 | 2 of 51 | C9 invented "URLs" |
| 1, GPT-5.6 Luna | 0 | no invented content to catch |

What it does **not** catch: wrong or lost dates (C15, C8 in run 4). It checks shared words, not facts, so it's a safety net for invented text, not proof of correctness. Ratchet measures it independently before anyone relies on it.

## Options (for the Lead to put to Brian after #67)

1. His model, with capture confirm-first: nothing applies until he taps Apply.
2. His model, auto-apply, with the grounding check holding anything not traceable to his words, and a receipt where type, date and title can each be fixed in one tap (Jazz).
3. Another model. None measured here passes the rule either.

## Not covered

Real use beyond these 20 lines. Ratchet's independent scoring. A latency budget for the phone. Haiku with an adapted schema.
