# A6b pre-code probe · the cut-down draft prompt (2026-10-20)

- Plan: `docs/plan/a6b-model-step2.md` §9 (e2d0a51). Lead yes `feb40fa4`: ≤ $0.05, Brian's approved model, a **copy** of his database read-only, costs looked up by generation id.
- Script: `scripts/model-probe-draft.ts`. The model only returns `{ lineId, propose, date }`; it writes no text.
- Model `deepseek/deepseek-v4.1-flash-1017`, `max_tokens` 2000, 2 runs per case, worst-case pre-check per call against the cap.
- Raw answers, generation ids and costs: `evidence/a6b-probe-2026-10-20/results.json`.

## Results

**Case A: probe Part 2** (lines on Fri 2026-10-16, planning Mon 2026-10-19). The same in both runs, and all match the expected table (`model-quality-probe.md` Part 2):

| # | Line | Expected | Run 1 | Run 2 |
|---|---|---|---|---|
| P1 | 周一给 Kevin 回电话 | yes, 2026-10-19 | yes, 2026-10-19 | yes, 2026-10-19 |
| P2 | 今天天气很好，跑了 5k | no | no | no |
| P3 | 下周看看 Notion 导出的格式 | yes; no date or 10-19..25 | yes, no date | yes, no date |
| P4 | 如果有空可以研究一下 TRMNL 的 API | optional, never dated | yes, no date | yes, no date |
| P5 | 已经把 Q3 报告发出去了 | no | no | no |

**Case B: Brian's real Sun Oct 18 lines plus one hop** (8 lines: 2 events, 4 Notes lines, and the "#recipe" line inside each of the two recipe pages). Both runs proposed **nothing**:

- 肉酱意面 #recipe, 奥德赛: not proposed (Lead `90935fb5`).
- 原生家庭创伤…（是否强关联？）, the "I choose to…" line: not proposed. Both are thoughts.
- DRIVE Basketball Training #kathy, English Lesson #kathy: not proposed (events, past).
- The two "#recipe" page lines: not proposed.

## Cost

4 calls: **$0.0012945** total (0.00025816 + 0.000215728 + 0.00049384 + 0.00032676). The provider's inline cost and `GET /generation` agree on every call. Note: `/generation` returned **404 for about 20 s** after each call, then 200. A6a's automatic lookup for unknown costs runs once at server start, so it isn't affected, but any lookup right after a call must allow for that delay.

## Not covered

Two runs per case is a smoke check, not a rate. Not tested: injection lines, a real "call dentist Friday" in his own data, and context budgets.
