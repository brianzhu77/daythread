# Model quality probe: independent review, task #67

**Result: Weak.** Neither the original DeepSeek run nor the existing Luna comparison passes the frozen critical-error rule. The independent DeepSeek rerun also fails. These are small synthetic fixtures, not an estimate of Brian's real-world error rate.

## Fixed experiment and actual spend

Candidate 329cf7c; fixture docs/validation/model-quality-probe.md at 1059f08. The independent run used exactly the candidate capture/morning prompt and schema, Brian's deepseek/deepseek-v4.1-flash-1017, default reasoning, max_tokens 4000. Fifteen capture inputs were each called three times; the five morning inputs were batched three times: **48 calls**, no automatic retry, no failed calls. No alternative model calls were made by Ratchet.

Provider-reported costs sum to **$0.012464**, about $0.000260 per request across the mixed fixture. Median 1730ms, p90 6193ms. Ratchet's cap was $0.40, approved by Lead 3328004b; author-reported earlier spend $0.0551 plus this run is about $0.0676. Before each call the review harness checks spent plus worst-case reservation; reservation includes UTF-8 messages/schema plus framing margin and maximum output. Missing cost is booked at worst case. Credentials were loaded server-side from the existing env file and were not printed or copied.

## Scoring correction

A line is correct if at least two of three outputs have the expected type, date and title. Critical errors are separately recorded on **every attempt**, including minority failures. We report calls with critical errors, not a sum that counts three bad fields in one call as three calls. At most one critical error is allowed by the frozen rule; all configurations below exceed it even using the more lenient count of affected cases.

The original runner missed invented titles, wrong-target updates and missing dates. It also ignored dateRole: C13 requires a do-date but all three outputs in each compared set have newDate=2026-10-20 with role=null. This is missing model data, separately from a wrong calendar date. After the experiment Lead d8f14200 accepted an explicit application rule: dated updates without a role become a do-date proposal requiring confirmation. The final counts below accept C13 under that latest rule; this is an application default, not evidence that the model supplied the role. Before that rule, strict raw-field counts were 18/20, 16/20 and 18/20 respectively. The independent title judge rejects the metatext question "Is Brian's request to 'call dentist' a task?" as the task title, even though substring matching accepts it. It is not counted as a critical invented task here, conservatively.

| Frozen setting | Fully correct lines (2/3) | Correct capture calls | Critical calls / affected cases | Result |
|---|---:|---:|---:|---|
| Author DeepSeek run 3 | 19/20 | 38/45 | 6 / 4 | Weak |
| Existing author Luna | 17/20 | 37/45 | 3 / 2 | Weak |
| Independent DeepSeek | 19/20 | 37/45 | 5 / 3 | Weak |

Accepting the latest explicit do-date default restores the author majority counts to 19/20 and 17/20; it does not change any Weak result. Without that application default, the omitted-role field would fail the frozen do-date expectation. Morning P1–P5 were correct in all three attempts of all three sets. The per-capture results are descriptive of these exact samples; do not extrapolate "one in six" as a measured real-use probability.

### Critical output comparisons

| Set / attempt | Input and expected answer | Actual retained item |
|---|---|---|
| Author C2#2 | Lunch with Kevin next Mon 12:30 → Lunch with Kevin, Oct26 12:30 | Rewind, Oct19 14:30 |
| Author C9#3 | Cairn cron job prod deploy 11/2 → new Cairn task, Nov2 | update t-appx, detail Cairn…, newDate Nov2 |
| Author C10#3 | 月底交房租 → 交房租, due Oct31 | 示例, due Oct31 |
| Author C15#1–3 | 今天 + three items → all Oct19 | update t-appx has newDate=null in all three; #1 also loses both new-task dates |
| Luna C8#1 | 下周三之前… → due Oct28 | due Oct21 |
| Luna C15#1/#3 | three items today | update t-appx has newDate=null |
| Independent C9#2 | Cairn…11/2 → new task Nov2 | material with invented example.com URL |
| Independent C10#1 | 月底交房租 → task due Oct31 | material with invented Instagram URL and followUpDate Nov1 |
| Independent C15#1–3 | three items today | update t-appx has newDate=null; #1 also loses new-task dates |

Unrelated fields in the flat raw item sometimes contain invented text/time but are dropped by captureItems. Above scores judge the **retained projection**; raw values are kept in evidence. This is not evidence that runtime schema/semantic validation or confirmation/application behavior is implemented safely.

## Grounding and Date missing: offline measurement

Measured the actual **8577d8e** grounding module on all retained capture items (51 per set), without provider calls. The module includes update.newDate, excludes material/note from Date missing, and exempts markDone updates. Exact source snapshot and per-item reasons are in evidence/scripts.

| Set | Held items | Held calls | Critical calls held | Incorrect calls left wholly unheld | False-held correct calls |
|---|---:|---:|---:|---:|---:|
| Author run3 | 8/51 | 6/45 | 6/6 | C5#1 | 0 |
| Existing Luna | 2/51 | 2/45 | 2/3 | C1#1–3; C8#1; C14#1/#3 | 0 |
| Independent DeepSeek | 8/51 | 6/45 | 5/5 | C8#3; C14#1 | 0 |

C2/C10 invented content is caught; all C15 date losses are caught. C8's **wrong but present** Oct21 date in Luna is not caught. Independent C8#3 loses passport-copy detail but retains the date, so also passes. The dateRole omission in C13 is not caught by this module; Lead subsequently accepted an application do-date default for dated updates; Date unclear is reserved for new tasks. This new mapping has not yet been runtime-tested here. Receipt/UI, runtime validation and the provider outcome remain separate acceptance items.

An initial reviewer experiment applied date cues to all item kinds and falsely held Luna C5#1 (material + 周末看 with an explicitly optional date). That experiment is preserved as grounding-initial-experiment.jsonl and is **not a defect in 8577d8e**, whose material/note exclusion removes this false hold. Initial broad experiment is not the final measurement.

Zero false holds in this small reused set is not evidence of general reliability. A shared date word across a multi-item input can belong to only one item; lexical overlap does not establish the truth of a person, project or date. Do not promise auto-save correctness from these checks.

## Evidence and recommendation

Evidence directory: docs/validation/evidence/ratchet-model-probe-2026-10-19/. calls.jsonl preserves raw independent outputs and actual per-call cost; manual-scoring.json contains each of 60 scored outputs (including batched morning items) for all three sets; grounding-measure.json records actual module holds; results.json is explicitly the **original incomplete automatic checker**, not the final verdict. The reviewer harness differs only in budget bounds and fixed run settings, not model prompts.

Recommendation: present Weak and concrete failure examples to Brian. Retain his selected model unless he chooses otherwise. Confirm-first reduces silent application but adds work; Auto plus tested holds and an editable receipt reduces some risks while leaving wrong-date/detail errors. A user choosing Auto after this evidence is a product decision, not a test pass. Haiku was not independently tested. No production or database changes made in this review.
