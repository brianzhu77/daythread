# Model quality probe · runner's results · 2026-10-19

- Runner: Roadbuster, branch `feat/model`. Cases, expected answers and pass rule: `docs/validation/model-quality-probe.md` @ `1059f08`, frozen before any call.
- **This is the runner's own scoring.** Bumblebee judges borderline lines; Ratchet re-runs independently. Neither is replaced by this file.
- Model under test: Brian's choice, `deepseek/deepseek-v4.1-flash-1017` (`.env.local`). It was not swapped. Two alternatives were measured for comparison only.
- Raw answers for every call (including failures), cost per call and per-line results: `docs/validation/evidence/model-probe-2026-10-19/<run>/`.
- Runner: `scripts/model-probe.ts`. Before each call it admits the call only if spent + that call's worst case stays under the run cap. A missing cost counts at the worst case.

## Runs

The prompt wording is identical in all runs. Runs 2–4 change only the schema or call settings, which were general fixes, not tuned to these lines.

| Run | What changed | Lines correct (≥2 of 3) | Critical lines | Rule result | Capture calls correct | Failed calls | Median / p90 latency | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | First schema (one object type per kind), max 1200 output tokens | 15/20 | 1 | **fail** | 30/45 (67%) | 2 | n/a | $0.0112 |
| 2 | Flat item schema; task ids limited to the open tasks sent | 19/20 | 0 | pass | 38/45 (84%) | 4 | n/a | $0.0112 |
| 3 | Run 2 + max 4000 output tokens | 19/20 | 1 | pass | 38/45 (84%) | 0 | 2.0 s / 5.6 s | $0.0122 |
| 4 | Run 2 with reasoning switched off | 17/20 | 2 | **fail** | 34/45 (76%) | 0 | 0.8 s / 1.3 s | $0.0040 |
| alt | `openai/gpt-5.6-luna`, run 3 settings | 17/20 | 1 | pass | 37/45 (82%) | 0 | 1.7 s / 3.9 s | $0.0150 |
| alt | `anthropic/claude-haiku-5.5`, run 3 settings | — | — | not measured | — | 22 of 22 rejected (HTTP 400) | — | $0 (not charged) |

OpenRouter's key usage after all runs: **$0.0551 in total**, below the $0.50 cap. The runner's "counted" total is higher because it books every unanswered call at its worst case.

## What failed and why

- **Run 1, schema.** The model picked the wrong item type for a bare URL (task instead of material, C4 0/3), and twice "updated" a task with an empty id. Limiting `taskId` to the real open-task ids and using one flat item shape fixed both (run 2).
- **Runs 1–2, empty answers.** The model reasons before answering. With `max_tokens` 1200 the reasoning alone used the budget (`finish_reason: length`), so the answer came back empty (C8 3/3 in run 2). Run 3 raises the limit to 4000. The client now treats a `length` stop as a failed answer instead of parsing a cut-off one.
- **Run 4, reasoning off.** Faster and cheaper, but the dates get worse ("下周三之前" → 10-21 instead of 10-28, 3/3) and it invents URLs from plain text (C9). Not recommended.

## Run 3 in detail (recommended settings)

19 of 20 lines pass the 2-of-3 rule. The one wrong line is C15: "今天：… review APPX PR …". In all three runs the APPX item was an update with no date, where the sheet expects today.

**What the line rule hides:** 7 of 45 capture calls (16%) were wrong. Several of those were **invented content in a single run**:

- C2 run 2: an event "Rewind" at 14:30 today, none of which was in "Lunch with Kevin next Mon 12:30".
- C10 run 3: the title "示例" ("example") instead of "交房租".
- C9 run 3: an update to the APPX task instead of a new "Cairn cron job prod deploy" task.

In the app each capture is a single call, so Brian would meet something like this in roughly one capture in six. New items apply at once with an editable receipt and Undo (03 §5). Changes to existing tasks always wait for Apply, which is the protection that matters for the C9-type error.

## For the decision (Lead → Brian)

- Under Bumblebee's rule, Brian's model **passes with run 3 settings** (19/20, 1 critical line), at about **$0.00025 per capture**. 10 USD/day is not a practical constraint.
- The per-call view is weaker than the rule suggests: about one capture in six needs a fix, and a few of those fixes are for invented text, not just a wrong date.
- `gpt-5.6-luna` scored lower here (17/20). `claude-haiku-5.5` is cheaper on paper, but it would need a schema adjusted to Anthropic's structured-output limits before it can be measured.
- Morning proposals (P1–P5) were right in every completed run of runs 2–4.

## Not covered

Real use beyond these 20 lines. Ratchet's independent scoring. A latency budget for the phone. Haiku with an adapted schema.
