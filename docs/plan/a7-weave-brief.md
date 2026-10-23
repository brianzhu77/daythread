# A7 · Weave pages: product brief

Status: **product brief, draft 1** (Bumblebee, 2026-10-23, for Lead 33949c0f). Jazz writes states from this, the Lead writes the
engineering plan, Ratchet pre-reviews. A7's build waits on the A6b-1 check of Oct 27 (checklist row A7, task #122).

Sources: Brian 06469260 (three kinds of page; Weave like Karpathy's LLM Wiki), c377e316 (recipe example; corrections in his own
thread or pages; inferred pages are not his; indexing at plan and review), e83b0640 (AI pages ship in v1, minimally), 08a02686
(name Weave; future App Store, avoid legal risk), a4fd5686 (Weave option A, a section in Pages). Framework r2 §6. Design
`docs/design/v05-morning-and-weave.md` §2 (rev 2).

## 1. What his data shows (read-only, 2026-10-23)

Read from the Supabase workspace (revision 106) and a copy of the old SQLite file (Oct 13–21).

| | Old app, Oct 13–21 | New app, Oct 22 |
|---|---|---|
| Days with writing | 4 of 9 (Oct 18–21) | 1 |
| Lines that aren't tasks | Oct 18 only: 2 events, 4 notes, 2 page links | 1 note |
| Document pages | 2, both recipes, each holding only `#recipe` | 0 |
| Good Stuffs, saved links, captures | 0 | 0 |
| Morning hand-off done | Oct 19, 20, 21 | Oct 22 |
| Evening review saved | **0 of 9 days** (started on 5) | 0 |
| Real model runs | 1 Draft my day (Oct 21): offered 1 task he already had, 0 new, 0 proposals | 0 |

What follows:

1. **He names things, he doesn't write them up.** Oct 18's notes are short titles: two recipes as page links, one recipe as a
   tagged line, a title (奥德赛), a question to think about, one reflection. Most lines are under 30 characters. A Weave page can't
   be "the recipe": nothing he wrote holds the recipe. A model filling one in would be inventing it.
2. **The review trigger never fires.** He has started the review 5 times and saved it 0 times. Indexing "at review" would not run.
   The morning hand-off is done every day since Oct 19.
3. **He already tags by topic.** `#recipe`, `#kathy` (two events) and a few work tags group lines today in the Tags list.
4. **A6b-1 so far (check runs Oct 22–27, day 1):** no Draft my day runs and no captures on the new app, so nothing to judge yet.
   On the old app, its one real run offered nothing new. Neither result says much while his notes are this short. The Oct 27 read
   stays the decision point.

## 2. What Weave should be in v1

**A Weave page gathers what he wrote about one topic across days, in his words, each line linked to where he wrote it.**
The model chooses the topics, names the pages, sorts his lines under them and writes one summary line at the top. It doesn't
write any other content.

Why this and not wiki-style articles:

- It matches his data: titles and short lines group well, while an article would mostly be made up.
- It keeps his rule that his words outweigh inferences (c377e316): the body *is* his words.
- It keeps App Store risk low (08a02686): no generated health, recipe or advice text presented as fact.
- It goes beyond Tags: one page per topic across days, lines he didn't tag, and links between topics, which Tags can't do.

Example, from his data as it stands: **Recipes** (韩国大酱汤 · 佛卡夏披萨 · 肉酱意面; three `#recipe` lines) gets a page.
`#kathy` (two events, one day), the reflection and the question **don't get a page yet**; they would once they recur on a
second day. So today's data makes **one** Weave page, which is the honest size of v1 for now.

### 2.1 What gets made, from what

- **Reads:** every day page and his own pages, up to and including yesterday. Not today's page, which is still being written.
- **Makes:** topic pages. A topic gets a page when he has written about it on **at least 2 different days**, or he has tagged it
  and it holds at least 3 lines. One topic, one page; the next run updates the same page instead of making a second one.
- **Each line on a page is a line link** to his line (A11), not a copy. That's why A11 comes first:
  - an edit he makes shows on the Weave page straight away;
  - a deleted line disappears from it straight away;
  - the "Line removed" state never shows on a Weave page; the line is just gone.
- **Model-written text** is the page title and the one summary line, both marked as written by Weave.
- **Never:** Weave writes into his pages or day thread, suggests anything on the day thread, or keeps text whose source is gone.

### 2.2 When it runs

- **When he finishes the morning hand-off** (taps Done on the morning card), once per day. That's the "plan" trigger, and it
  happens every day.
- **Also on review save**, if he ever saves one; only one run per day either way.
- **No button and no background runs in v1.** Each run reserves its cost first and isn't retried automatically, as with every
  model call (framework §6). A run that fails leaves the pages as they were and says so once in the Weave list ("Couldn't update
  this morning · will try at the next plan"). Cost is one small call per day: the input is yesterday's lines plus the list of
  existing topics, not every day each time.

### 2.3 What he does with it

- **Browse:** Pages › Weave (option A, Brian a4fd5686), a flat list of topics with the newest update first, each with its line
  count and days ("6 lines · 3 days").
- **Read a page:** his lines grouped by day, newest day first; tap a line to jump to where he wrote it (the A11 jump).
- **Copy to my pages:** makes a normal page in Mine holding the lines as his own text, each with its source link. The Weave page
  then shows "You have a copy ›" (v05 §2.1). The copy is his to edit; Weave never touches it again.
- No editing, search, chat or "hide" in v1 (framework §6).

### 2.4 Corrections

- **The words fix themselves.** Since the body is his lines, editing or deleting a line fixes the page at once.
- **Grouping or naming is fixed in his own words.** If a page is wrong ("that's not a recipe"), he writes so in today's thread or
  the topic's own page, and the next run follows it, because his later statement outweighs the earlier inference (c377e316 3).
  The run must read lines that mention a Weave topic by name as instructions about that topic.
- **Rebuild:** the whole layer can be thrown away and rebuilt from his pages, losing nothing of his (framework §6).

### 2.5 Out of scope for v1

Generated prose beyond the summary line; search; chat; inferred connections shown anywhere outside Weave; a "regenerate" button;
Weave pages linking into the day thread; topic merge or split controls; option B (a fifth tab).

## 3. Proposal: try it on his real data before building

His data is thin, so the open question is whether Weave makes anything he'd open at all. The cheapest test needs no UI:

1. **Offline run (about half a day, Roadbuster or the Lead).** Run the indexing prompt read-only over his real pages as of
   Oct 27, and write the output to a Markdown file in the repo (topics, lines, sources, summary lines, cost).
2. **We check it** (me for value, Ratchet for invented text): any summary claim without a source line fails.
3. **Show Brian the file**, with one question: "Is this what you'd want Weave to make? What's missing?" His answer decides
   whether to build §2 as written, change the topic rule, or wait for more writing.

This turns "is Weave worth building now" into his decision on real output, at little cost, before roughly a week of build.

## 4. Success check (after release)

Read in the usage read 7 days after it goes live:

- **Runs:** at least 5 runs in 7 days with no failure he sees, and every run under the cost reserve.
- **Pages worth having:** at least 3 topics, each with lines from at least 2 days.
- **No invented content:** in a spot check of every summary line, each one is supported by its lines. One unsupported line means
  pulling the summary line before anything else ships.
- **Use:** he opens a Weave page on at least 2 days, or copies one. Zero opens in 7 days means it isn't earning its place.
  Then we ask him before adding anything.

## 5. Open items

- **Topic rule** (2 days or 3 tagged lines): a starting guess, to be tested in the §3 run.
- **Name check:** "Weave" has had no trademark or store check (framework §10). It doesn't block v1, but it's needed before any
  App Store work.
- **Data noise:** the new workspace has 6 open tasks with no day and titles "", "a" or "aa", probably from typing. Indexing
  should skip empty and one-character lines. Whether they should exist at all is a separate question for the Lead.
