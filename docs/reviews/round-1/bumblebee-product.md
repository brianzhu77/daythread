# Daythread round 1 — product review (Bumblebee)

Scope: `README.md` and `docs/specs/00`–`05` at the versions in `BASELINE.sha256`, plus the
discussion history in `~/Documents/Codex/2026-10-13/wo-j/outputs/` (used only to separate
what Brian said from what was proposed to him).

Kinds: **goal** = Brian's stated need · **preference** = stated technical/product preference
· **design** = current spec choice · **hypothesis** = untested claim about value, effort, or
feasibility.

## Summary

The specs are careful about correctness: dates, identity, idempotency, and trust boundaries.
They are weak on the question this round should answer first: **does an AI-prepared daily
page actually reduce Brian's planning and recall effort enough that he moves his daily
routine out of Notion?** Nothing in the plan tests that until M4, after the editor,
references, and data layer are built. The material loop also misses the stated pain:
Brian saves material and never goes back to it. A manual "collect, then remember to
reference" loop reproduces that failure instead of fixing it.

My recommendation: run a cheap pre-build test of the daily loop on real data, rebuild the
first build slice around the action loop, add minimal resurfacing of saved material, and
defer most of the content-editor depth.

## Top 5 findings

### 1. The value hypothesis is tested last — **blocker**

- **Kind:** hypothesis.
- **Issue:** Value depends on one untested belief: that an AI-prepared draft plus a low-effort
  carry-over saves real effort compared with writing the Notion daily note by hand. The build
  order (05 · 交付顺序) puts Pages/Blocks/references (M1) and tasks/dates (M2) before any AI
  (M3) and before the daily draft and review (M4). The trial (M5) is the first point where
  value is observed.
- **Evidence:** 05 M0–M5; 00 "成功的含义"; 04 "5–7 天试用" is the only value check.
- **Impact:** Most of the build cost (editor with custom blocks, backlinks, soft delete,
  versioned conflicts, change log, RLS, export) is spent before learning whether the core loop
  is worth using. If the drafts turn out to be unhelpful, or review becomes a chore, that cost
  is sunk.
- **Recommendation:** Two changes.
  1. Add a **pre-build concierge test** (see "Smallest experiment"): 4–5 days of real use with
     no app, where review text plus open items go to the model and a next-day draft comes back.
  2. If the test passes, build **thin across the action loop first**: capture → task/event →
     today page → done/reschedule/pause → review → tomorrow draft. Use a simple editor
     (paragraphs plus structured task/event rows). Build Pages and references next, as a
     second slice.
- **Trade-off:** The first slice's editor may be replaced later. The specs' own concern
  ("avoid finding out at the end that the editor can't express core interactions") is real.
  It is an engineering-feasibility risk, though, and a 1-day editor spike resolves it more
  cheaply than putting the whole content layer first. @Wheeljack should size that spike.
- **Verify:** The concierge test pass/fail criteria below. For the build, record the date the
  action loop is usable end to end and compare it with the current M4 position.

### 2. The material loop does not address the stated pain — **major**

- **Kind:** goal versus design.
- **Issue:** Brian's stated pain is that he saves articles, videos, and repos to Notion and
  "basically never visits them again" (discovery doc, pain 2). The spec loop is: manually
  collect → page → **user searches and inserts a reference** → use it (00 U07, 01 F04). That
  only works if Brian remembers the material exists at the moment it matters, which is the
  behaviour that already fails. Resurfacing is deferred under "资料重访" (U08).
- **Evidence:** 00 U07/U08; 01 F04; 04 success check "至少有实际资料引用"; discovery doc pain 2.
  Also 04 "试用后决策": "资料从不被引用：调整找回和使用入口". The spec already expects this
  outcome but plans to react to it only after the trial.
- **Impact:** The trial will likely show "saved but never referenced". That says nothing new,
  and the second loop's build cost (backlinks, block-level references, soft-delete
  restore) will not have tested the actual hypothesis.
- **Recommendation:** Add **minimal resurfacing** to round 1. The daily draft and review calls
  already receive the whole workspace (03 "输入上下文"). Let them propose **0–2 existing
  pages or blocks related to today's items, each with a one-line reason**, shown as a
  dismissible suggestion and not inserted into the body. That is no new infrastructure, just
  one more suggestion type validated against real IDs. In return, cut block-level references
  and backlinks to page-level only for round 1 (see Cuts).
- **Trade-off:** Adds prompt and validation work, and the risk of noisy suggestions. "0 is
  fine" plus dismissal limits the noise. Precision is not the goal; the trial question is
  whether anything resurfaced was ever used.
- **Verify:** During the trial, log suggestions shown, opened, and used in an action or
  conclusion. Success signal: at least 3 uses of material Brian did not search for himself.

### 3. Undated and overflow tasks can silently drop out of view — **major**

- **Kind:** design (gap).
- **Issue:** Carry-over candidates come only from "the most recent valid daily plan", capped
  at 3 (02 "接续候选"; D06). Two classes of open tasks have no defined path back:
  - Overflow candidates (4th and later) sit only in that day's expandable review area. The
    next day they are not on the most recent plan, so they never become candidates again.
  - Tasks created with no date ("要给 Alex 发邮件，时间未定", A05) never get a placement, so
    they only appear in search or the future list.

  It is also undefined whether a `suggested` candidate that Brian ignores counts as "on" the
  next day's plan.
- **Evidence:** 02 "接续候选"; 00 D06; 01 F07; 04 A05/A13/A14. Brian's own constraints point
  both ways: no huge backlog to maintain (U06), and not forgetting real commitments
  (discovery doc "重要边界"; 04 trial question 3).
- **Impact:** Brian's real fear, "forgetting a real commitment", is the most likely failure in
  the trial, and the acceptance tests do not catch it: A13/A14 check only one day forward.
- **Recommendation:** Define one explicit resurfacing rule for open, unpaused tasks with no
  future date. Option A (recommended): a "still open" line in the review area, collapsed by
  default, showing count and oldest age, with a one-tap "today" per item. Option B: a
  Sunsama-style limit. After N days without placement, a task moves to a quiet "later" bucket
  with a visible notice. Either way, add a multi-day acceptance case (task created day 1,
  overflowed day 2, still findable on day 5 without searching).
- **Trade-off:** A adds a small visible list, which is a mild form of the backlog Brian
  dislikes. B hides items, which risks the forgetting he fears. A is safer for a first trial
  because it is observable and reversible.
- **Verify:** New acceptance case as above. In the trial, ask daily: "did you go back to
  Notion or memory to find something Daythread should have shown?"

### 4. Success criteria cannot fail, and there is no baseline — **major**

- **Kind:** hypothesis (measurement).
- **Issue:** The value criteria are "willing to use it several days", "goes back to old tools
  less", "at least one reference helped" (00 成功的含义; 04). There is no baseline for current
  planning or recall effort, no threshold, and a fallback of "extend the trial if
  opportunities are insufficient", so no outcome counts as a fail.
- **Evidence:** 00 成功的含义; 04 "5–7 天试用" and "不预设'节省 50% 时间'".
- **Impact:** The trial ends with impressions rather than a decision. The post-trial decision
  table in 04 is good, but it needs measured inputs.
- **Recommendation:** Keep the "no invented 50% target" principle, but fix observable
  thresholds before the trial:
  - **Baseline (3 workdays, before any build):** minutes spent writing or planning the Notion
    daily note, and the number of times Brian searched Notion or his memory for a pending
    item.
  - **Trial pass (7 days):**
    - Daythread is opened to start the day on ≥5/7 days.
    - Review is done on ≥4/7 days, or recovered after a skip without manual backfill.
    - Morning planning time is at or below baseline.
    - Fewer than 2 "went back to Notion to find an item" events per day.
    - Zero lost or duplicated items (hard gate).
    - At least 3 uses of resurfaced material.
  - **Trial fail signals:** Brian keeps a parallel Notion daily note after day 3, or more than
    1 correction per capture on average.
- **Trade-off:** Self-logging costs Brian about 1 minute a day. Keep it to 3 questions, asked
  at review time.
- **Verify:** These are the measures. Agree on them with Brian before the concierge test.

### 5. Review reminder and dual-tool friction may decide the trial on their own — **major**

- **Kind:** goal (reminder), hypothesis (switching).
- **Issue:** (a) Brian asked for the system to remind him to review (discovery doc, pain 1).
  Proactive reminders are deferred (00 首轮明确暂缓), yet the next-day draft depends on review
  happening. The spec already notes that a forgotten review could block the trial. (b) Brian
  will hand-sync between Notion and Daythread (U01). If he keeps both daily notes, the trial
  measures double-entry friction rather than Daythread's value.
- **Evidence:** 00 "主动提醒仍是长期需求…"; 04 trial question 5; U01.
- **Impact:** Either factor can produce a negative result unrelated to the product hypothesis.
- **Recommendation:** Neither needs build work. (a) For the trial, use an existing recurring
  reminder (phone or calendar) with a link to today's review. Record whether it was ignored.
  (b) Set a trial rule: during the trial week Daythread is the only daily note, and Notion
  stays read-only as an archive.
- **Trade-off:** The external reminder does not validate "the system brings me back". That
  stays a later question, as the spec already says.
- **Verify:** Trial log records reminders fired versus reviews done, and any Notion
  daily-note writes during the trial.

## Other findings

| # | Finding | Kind | Severity | Suggestion |
| --- | --- | --- | --- | --- |
| 6 | There is no observation of Brian's actual Notion daily note or review routine. The discovery doc lists this as unresolved ("当前 daily note 的实际格式…"). | hypothesis | major | Get 3–5 recent real daily notes, redacted as Brian wishes. They feed the concierge test, the default page structure, and the test fixtures. |
| 7 | Pausing combines three states (excluded placement, `auto_carry_paused`, cleared `planned_on`). The "pause" button must explain what will happen next, which raises cognitive cost. | design | minor | Show Brian the receipt copy in the concierge test or a paper sketch. @Jazz owns the wording. |
| 8 | Top 3 is a stated want (U08) and is the cheapest form of "today's plan". It is missing from the draft output. | goal | minor | Let the daily draft mark up to 3 included items as Top 3. No new state; it can later feed e-ink. |
| 9 | The reliability scope is sized for multi-device, multi-tab use: conditional undo across later edits (X07), version conflicts on every object, a full change log, and daily-page restore (P12). Single-user value from these is low. | design | minor | Product view: keep no-loss, no-duplicate, and JSON export as hard gates. Undo only the last action. Detect conflicts and warn instead of offering merge UX. Final call with @Wheeljack and @Ratchet. |
| 10 | Several items marked "用户已确定" are preferences (stack, OpenRouter + GPT). The product name is also listed as confirmed. Neither affects the product questions in this round. | preference | minor | No action needed. Keep the preference label in revised specs. |

## (a) Questions only Brian can decide

1. **Pre-build test:** will he spend 4–5 days running the concierge test (about 10
   minutes a day) before any app is built? Recommended: yes. It is the cheapest way to learn
   whether the core loop is worth building.
2. **Resurfacing in round 1:** should round 1 include the AI suggesting 0–2 saved items
   daily, in exchange for cutting block-level references and backlinks? Recommended: yes,
   because it targets his actual pain ("saved, never revisited").
3. **Trial rule:** will Daythread be his only daily note during the trial week?
   Recommended: yes. Otherwise results are confounded by double entry.
4. **Real data:** can he share 3–5 recent daily notes and about 10 saved items as test
   material, and decide what to redact?

Recommended defaults, no decision needed: external reminder for the trial; the baseline and
pass thresholds in Finding 4; the undated-task rule (Option A in Finding 3); Top 3 as draft
markup.

## (b) Smallest experiment — concierge test of the daily loop

- **Question:** Do AI next-day drafts built from Brian's real review and open items reduce
  his planning effort, and does resurfaced material get used?
- **Setup:** No app.
  - Brian keeps his normal Notion routine for 3 workdays and records the baseline (Finding 4).
  - Then for 4–5 days, each evening he pastes his review text, open items, and a list of about
    10 saved items into a fixed prompt using the planned model family. The prompt is written
    from 03 "每日草稿" and asks for a draft with Top 3, carry-over (at most 3 plus a "still
    open" line), and 0–2 related saved items with reasons.
  - The next morning he starts from that draft.
- **Cost:** About 1 hour of team setup (prompt plus a log template). About 10 minutes a day
  for Brian. Model cost is negligible, and it runs on Brian's own account, so it needs his
  go-ahead. No code.
- **Read-out per day (3 questions):** Minutes to start the day. What I had to fix in the
  draft. Did I go back to Notion or memory for something, and what was it. Plus: did I use a
  resurfaced item?
- **Decision:** If drafts need heavy rewriting on most days, or review is skipped on more
  than 2 days, revise the loop before building anything. If the thresholds are met, build
  the action-loop slice from Finding 1.
- **Limits:** This does not test capture parsing, date resurfacing over weeks, or the
  editing experience. Those belong to the build and the 7-day trial.

## (c) What I would cut from round 1

- Block-level references and backlinks. Keep page-level references, and add resurfacing
  suggestions in their place (Finding 2).
- Soft-delete restore flows for Pages and Daily Pages (P06 restore, P12), conditional undo
  across later edits (X07), and conflict merge UX. Keep detection and warnings.
- The "整理这段" (reorganise this section) selected-text AI mode (`selected_text`). It is a
  fourth AI entry point and is not tied to either loop's core question.
- Markdown export (already optional). Keep JSON export.
- The custom editor depth beyond paragraphs, headings, single-level lists, and task/event
  rows, until the editor spike says it is cheap.

Not cut, despite cost: date semantics (planned, attention, deadline), single task identity
across days, saving the capture first, idempotent apply, and RLS ownership. These are the
reliability floor Brian needs to trust the tool.

## Cross-review

Read: `jazz-design.md`, `wheeljack-engineering.md`, `ratchet-review.md` (2026-10-15). Positions
on the Lead's six points, followed by gaps I think the others missed.

### 1. Single source of truth for the day's plan — **conditional agree with Jazz A**

- A structured, live Today zone above free Notes removes the reconciliation work (body vs.
  attention area vs. update prompts). That reconciliation is itself recall load, the thing
  we are trying to reduce. It also removes the plan-merge machinery.
- A and the Wheeljack/Ratchet proposal are compatible. Today-zone rows *are* the "placement"
  blocks; task mentions in Notes are "ordinary references". Editing Notes never changes
  commitment state, and "Not today" is an explicit row action. Combined, that is one rule
  set, not two competing designs.
- **Condition:** U03 is Brian's own wording ("suggested 自由书写页 including today's plan,
  editable"). A changes its shape, so Brian must see it. Before choosing, check his real Notion
  notes: does he interleave plan lines with prose? If he does heavily, A needs inline task
  mentions in Notes to feel natural.
- **Bottom line:** whichever model wins, exactly one list is authoritative for "today", and
  editor deletion never pauses or cancels a task.

### 2. Carry-over — **yes, merge into one rule**

- **Proposed rule.** The **open pool** is every task that is `open`, not paused, and has no
  future `planned_on`. That includes past-planned tasks and tasks that never had a date. It
  is computed from data (Wheeljack's frontier), never from "the most recent page".
  - The Today zone shows up to 3 pool items as "continue?" suggestions. Order them by
    `last_suggested_on` ascending, with never-suggested items first and stable ID as the
    tiebreak, so items rotate instead of the same 3 forever.
  - Below them, one collapsed line: "Still open: N · oldest X days". It expands to the full
    pool, which is the same list as Ratchet's "unscheduled" entry and Jazz's Upcoming → No
    date tab.
  - Paused items are not in the pool. They live under "Not today" and are summarised in
    review.
- **Bottom line (testable invariant):** no open, unpaused task can become invisible without a
  user action. Its count is visible on Today every day.
- Accept Ratchet's 8-undated-tasks × 4-days replay as the acceptance case.

### 3. AI on page open vs. the value test — **no conflict; agree with Jazz**

- My concierge test already generates the draft **at review time in the evening**, not on
  open. The morning page opens instantly from data, as Jazz proposes. On mornings after a
  skipped review, use Jazz's morning hand-off row plus an optional "Suggest a plan" action.
- **Addition to the test:** on 2 of the 4–5 concierge days, Brian gets only the
  deterministic list (facts plus carry-over, no AI wording). That tests directly whether the
  AI adds value beyond rules. If it doesn't, the daily-draft AI mode can shrink to review
  only.

### 4. Material loop — **hold my position, with a fallback**

- The real pain is "saved, never revisited". Wheeljack's "manual references only" leaves
  that unaddressed, because recall stays entirely on Brian. Round 1 needs **at least one
  mechanism that brings saved material back without Brian searching**. Ratchet #5 says the
  same: test whether material is *discovered*, not only referenced.
- **Answers to Wheeljack's concerns:**
  - The suggestions are read-only. They show a link, never change state, and are validated
    against real IDs, so the injection blast radius is a bad link.
  - To control context cost, send material titles plus the first ~300 characters, not full
    text.
- **Fallback if engineering cost or noise is too high:** a deterministic Readwise-style "one
  saved item you haven't opened in 14+ days" line in review. No AI involved.
- **Decided by evidence:** the concierge test includes resurfacing. If Brian uses 0 resurfaced
  items over the test, drop resurfacing from round 1 and keep manual references only.
- **Caveat on my own cut:** U07 is Brian's explicit requirement ("类似 Pages/Blocks… daily
  note 可以引用"). Page-level references satisfy "reference"; block-level is a design choice.
  Jazz's `[[` block search makes block references cheap in the interface, and the remaining
  cost is backlinks and soft-delete. If Brian says paragraph-level references matter to him,
  keep them and cut backlinks instead.

### 5. Confirm changes to existing items, auto-apply new ones — **agree**

- **Conditions:**
  - Confirmation is a single diff card with one "Apply" tap and per-row uncheck (Jazz #4
    receipt), not a confirmation for each field.
  - It applies only to AI-proposed changes. Direct UI controls (Done, Not today, date picker)
    never confirm.
  - A review that produces 5 changes shows one card.
- Log confirmation counts and rejections in the trial, then relax per action type based on
  evidence. No objection to this as the default.

### 6. Validation order

Constraint: Brian's time is the scarce resource. The team's time is not.

| When | What | Who | Brian's time |
| --- | --- | --- | --- |
| Now, in parallel | Paper state replay (Ratchet's 4-day table plus Wheeljack's rescheduling sequences) | Ratchet, Wheeljack | 0. It fixes spec ambiguity first. |
| Now | **One request to Brian:** 3–5 recent daily notes, about 10 saved items, his devices, and permission to send the redacted copy to the model | Lead | About 15 minutes |
| Days 1–3 | Brian's baseline log; meanwhile Jazz builds the A/B prototype from his real items | Brian, Jazz | About 2 minutes a day |
| Day 3 or 4 | Prototype session with 6 scripted tasks | Jazz | About 45 minutes |
| Days 4–8 | Concierge test, including resurfacing and the deterministic-only days. Fold Wheeljack's 20-case set in on the same model if budget is approved. | Bumblebee, Wheeljack | About 10 minutes a day |
| After the A/B decision | Throwaway editor experiment. A shrinks its scope to Notes only. | Wheeljack | 0 |

Nothing cut outright. The editor experiment waits on the A/B decision, because doing it first
risks testing the wrong editor surface.

### Gaps the others missed or under-weighted

- **Device and capture context (major, not a blocker yet).** This is Jazz's question (a)2,
  and Wheeljack raised it too. I'd move it into the first request to Brian. If most capture
  happens on the phone, a desktop-first build fails the capture half of the action loop
  regardless of everything else.
- **Consent for the concierge test.** It sends real notes to OpenRouter under Brian's
  account. Ratchet's privacy point applies here too, before any app exists. Brian decides
  what may be sent; we work from a redacted copy.
- **Review habit.** Jazz's question (a)3 ("existing habit or a new one?") is a better framing
  of my Finding 5. If review is a new habit, the morning hand-off should be the default and
  the trial pass threshold "review ≥4/7" becomes "review or morning hand-off ≥5/7".
