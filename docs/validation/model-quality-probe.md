# Model quality probe · capture parsing and morning proposals

Owner: Bumblebee (inputs, expected answers, scoring). Independent re-run: Ratchet. Runner: Roadbuster on `feat/model`.
Requested by the Lead (feat/model task card, point 4). Model: Brian's choice in `.env.local`
(`deepseek/deepseek-v4.1-flash-1017` as of 2026-10-19). Do not change the model to pass this probe.

## Why

Brian picked a small, fast model. The JSON schema probe proves the output parses; this probe checks whether the
answers are **right for the way Brian writes**: mixed Chinese and English, relative dates, tasks inside sentences,
links with notes. If it is weak, Brian sees the examples and decides. We never swap the model for him.

## Fixed context for every call

- `captured_at` = **Mon 2026-10-19 09:00 America/Vancouver**. All relative dates resolve from this moment
  (03 §2), never from the page date or the response time.
- Active page: today's daily page (2026-10-19).
- Existing open tasks in context (for the update cases): `Tax Return` (id t-tax), `Kathy's Study Permit` (id t-permit),
  `Rewind - APPX PR - Provider` (id t-appx).
- Each line below is sent as **one capture**, separately, exactly as written (copy the text between the backticks).

## Part 1 · Capture parsing (15 lines)

Expected fields: **type** (task / event / note / material / update-existing), **date** (task: do or due date;
event: date and time if given; none = no date), **title** (what the item says; key words kept, nothing invented,
original language kept). "—" means the field must be empty.

| # | Input | Type | Date | Title must contain / must not | Notes for the judge |
|---|---|---|---|---|---|
| C1 | `周五前把 TFLOW PR 提了` | task | due Fri 2026-10-23 | "TFLOW PR"; Chinese kept | "前" = due, not do |
| C2 | `Lunch with Kevin next Mon 12:30` | event | Mon 2026-10-26 12:30 | "Lunch with Kevin" | "next Mon" said on a Monday = 10-26; 10-19 is wrong |
| C3 | `明天下午 Kathy 游泳课` | event | Tue 2026-10-20, afternoon (no exact time) | "Kathy" + "游泳课" | must not invent a time like 14:00 |
| C4 | `https://github.com/karpathy/nanochat` | material | — | URL kept exactly | single URL = explicit save (03 §1) |
| C5 | `https://www.youtube.com/watch?v=abc123 这个讲 RAG 的视频周末看` | material + note | — (or Sat 10-24 / Sun 10-25 as a read-by date) | URL kept; note = "这个讲 RAG 的视频周末看" | either reading of "周末" is fine; it stays one material, and the note must not become a separate task |
| C6 | `tax return 搞定了` | update-existing: t-tax → done | — | — | must be a **proposal to confirm**, never applied silently (03 §1); must not create a new "tax return" task |
| C7 | `想到一个点子：daily note 可以按 tag 自动生成周报` | note | — | the idea text | not a task: no verb of commitment |
| C8 | `下周三之前续签 Kathy's study permit，记得带护照复印件` | update-existing: t-permit due Wed 2026-10-28 **or** new task linked to it | due Wed 2026-10-28 | "护照复印件" kept as detail | creating a duplicate "Kathy's Study Permit" without referencing t-permit = wrong |
| C9 | `Cairn cron job prod deploy 11/2` | task | Mon 2026-11-02 | "Cairn cron job" + "prod deploy" | 11/2 = Nov 2 (North American order), not Feb 11 |
| C10 | `月底交房租` | task | due Sat 2026-10-31 | "交房租" | |
| C11 | `call dentist` | task | — | "call dentist" | no date given: must stay undated, not "today" |
| C12 | `读完《Thinking in Systems》第三章` | task | — | full title incl. 《》 | |
| C13 | `APPX PR 改成明天再弄` | update-existing: t-appx do-date Tue 2026-10-20 | Tue 2026-10-20 | — | proposal to confirm; not a new task |
| C14 | `Kevin 推荐的耳机 https://www.sony.com/wh-1000xm6 双十一看看价格` | material + note | — (or 2026-11-11 as a follow-up date) | URL kept; note keeps "双十一看看价格" | shopping link stays material; must not invent a price |
| C15 | `今天：1. 回 Kevin 邮件 2. review APPX PR 3. 订机票` | 3 tasks (preview, not applied) | today 2026-10-19 for all three | three separate titles | multi-line/multi-item → preview first (03 §1); "review APPX PR" may reference t-appx |

## Part 2 · Morning proposals (5 lines)

Context: these lines sit in the **Notes** section of Brian's page for **Fri 2026-10-16**. They are not tasks.
The morning draft for Mon 2026-10-19 should propose only lines that are real to-dos, with the right date.

| # | Line on Fri 10-16 | Should it be proposed today? | Date if proposed | Notes |
|---|---|---|---|---|
| P1 | `周一给 Kevin 回电话` | **yes** | today 2026-10-19 | "周一" written on Friday = 10-19 |
| P2 | `今天天气很好，跑了 5k` | **no** | — | diary line, already happened |
| P3 | `下周看看 Notion 导出的格式` | **yes** (or "this week, no date") | none or 2026-10-19..25 | either is fine; must not be dated 10-16 |
| P4 | `如果有空可以研究一下 TRMNL 的 API` | optional | — | proposing or not are both acceptable; it must not be dated |
| P5 | `已经把 Q3 报告发出去了` | **no** | — | done in the past |

## Scoring sheet

Record one row per item. A field is right only if it matches the table; the "Notes for the judge" column decides
borderline cases.

| # | Type ✓/✗ | Date ✓/✗ | Title ✓/✗ | Line correct (all ✓) | Critical error? | Model output (verbatim) |
|---|---|---|---|---|---|---|
| C1 | | | | | | |
| … | | | | | | |
| P5 | | | | | | |

**Critical errors** (count separately, any one is serious):
1. A wrong date on an item that had a date (C1, C2, C3, C8, C9, C10, C13, C15, P1).
2. Invented content: a time, price, person or task that is not in the input.
3. An existing task changed without a confirmation step (C6, C8, C13), or a duplicate created instead of a reference.
4. Text translated or rewritten into another language.

## Pass rule and what happens next

- **Pass:** at least 16 of 20 lines fully correct (80%) **and** at most 1 critical error. Ship as planned.
- **Weak:** below 16, or 2 or more critical errors. Do not ship the model path as the default. The Lead sends Brian
  the failing lines with the model's output next to the expected answer, the cost per call, and one or two
  alternative models with their price. **Brian chooses.** The simulated provider stays until he does.
- Run each line **3 times** (same prompt, default temperature). A line counts as correct only if at least 2 of 3
  runs are correct; note any line that flips.
- Record per-call cost from OpenRouter so the 10 USD/day cap can be checked against real usage.
- Ratchet re-runs the full set independently, with their own copy of the scoring sheet, before the result goes to Brian.
