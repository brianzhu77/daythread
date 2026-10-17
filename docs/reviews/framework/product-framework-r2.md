# Daythread — Product Framework (r2)

Export of Claude Doc `bd1b8179` at doc rev 68, 2026-10-17, author Bumblebee. Hand-copied from the doc for review; the doc is canonical. The diagram in section 3 is described in text here.

Daythread is a personal app where today's thread is the only page Brian needs to open to record his day. Behind it, all content is pages, and an AI layer turns past days into a knowledge base for review and for predicting what comes up on a later day.

Every rule below carries one of three marks. **Settled** = Brian said it (thread `06469260`, msgs `c377e316`, `e83b0640`, `7c4e0cab`, `08a02686`). **Assumption** = the Lead's working assumption (msg `9ffbe94b`), which Brian may correct. **Open** = waiting for Brian (section 12). Nothing here is built yet beyond the v0.3 daily loop and the Craft-style UI on main.

## 1. Problem and user

The user is Brian, one person, who today keeps a daily note in Notion. Four things cost him effort:

- **Morning copying.** Each morning he copies yesterday's unfinished items by hand.
- **Recall.** Commitments that slip off a day's note get lost; nothing shows what is still open.
- **Saved links are forgotten.** Links go into the note and are rarely revisited.
- **Things recorded once can't be found and refined.** Brian's example: he notes a good recipe one day, finds it again weeks later, cooks it, finds it too bland, and wants to adjust it. Today that knowledge stays buried in one old note. **Settled.**

Daythread succeeds if recording stays in one place and what he records becomes useful later without extra filing.

## 2. Principles

1. **Today's thread is the source of truth.** It is the app's main entry. Brian records everything for the day there and never needs to open another page to record something. **Settled.**
2. **All content lives in pages.** The day thread is one special kind of page. Other types can be added later as page properties. **Settled.**
3. **Your content outweighs inferred content.** Where your pages or threads and the AI layer disagree, yours wins. **Settled.**
4. **The AI writes your content only when a page is first created.** After that, a page of yours is never changed by the AI. **Settled.**
5. **The AI layer is invisible and rebuildable.** You never confirm or remove what it infers. It can be rebuilt from your threads and pages at any time. **Settled.**
6. **Nothing to clear.** No unread counts, no queues that must reach zero. Carried over from v0.3.
7. **Craft is the reference for UX/UI only**, not for product behaviour. **Settled.**

## 3. Three kinds of page

There are three kinds of page. Brian records in one of them, keeps one, and the AI keeps the third. **Settled.**

Diagram (in the doc): left zone "Brian's content · highest weight" holds Day thread (accent) and Your pages, with a "saved link" arrow from Day thread to Your pages. Right zone "AI layer · invisible, rebuildable" holds Indexing (at plan and review; your corrections win) and AI pages (called Weave). Both left boxes → "reads" → Indexing → "writes" → AI pages → "copy to edit" → Your pages.

| Kind | What it is | Created by | Who edits it | Example |
| --- | --- | --- | --- | --- |
| **Day thread** | One page per day; the day's record. Mostly a running record. Starts from a template of sections (plan, events, notes) that Brian edits freely | Opening the day | Brian only | Today: "saw a good recipe: …" |
| **Your pages** | Brian's knowledge base, kept by hand | A saved link (by default), or a copy of an AI page | Brian only, except at creation (section 4) | A link page; "Recipes / Tomato soup" copied and edited |
| **AI pages** | Pages the AI infers from threads and your pages, like Karpathy's LLM Wiki. Called Weave in the app (Settled, msg 08a02686) | Indexing (section 6) | The AI only; Brian copies one to change it | "Tomato soup recipe", built from the day it was noted |

A saved link becomes one of **your pages**; everything else inferred becomes an **AI page**. Brian knows of no other case that should create a page of his yet. **Settled.** Whether tasks, people or meetings become pages: **Assumption**, tasks stay items (section 7).

## 4. Data weight and write permissions

Brian's content always wins. The AI may touch it only once, when a page is created, and in the first version not at all. **Settled.**

| Content | Weight | AI may write | Rebuildable |
| --- | --- | --- | --- |
| Day thread | Highest: the source of truth | Not in the first version: predictions are suggestions Brian adds himself (msg 7c4e0cab) | No; it is the original |
| Your pages | Highest, same as day threads | Only when the page is created. A link page starts empty and Brian fills it by hand; no AI step in the first version (Settled, msg e83b0640) | No |
| AI pages | Lower; never overrides your content | Always; it owns them | Yes, from day threads and your pages |

**Corrections.** If an AI page is wrong, Brian says so where he already writes: in that day's thread or in one of his pages, e.g. "the soup needs more salt". The next indexing run must apply it. He never edits an AI page directly; to change one by hand, he copies it into his own pages. **Settled.**

**After a copy**, the copy is his and the AI never touches it. The original AI page keeps updating on its own. **Settled.**

**In the first version the AI writes none of Brian's content.** Link pages start empty, and predictions are suggestions that Brian adds by tapping; that tap is his action, not an AI write. The indexing job has no write access to threads or your pages. The one-time write at creation remains a principle for later uses only.

## 5. The day

Brian opens the app on today's thread and records the whole day there. **Settled** (this also settles old C1).

1. **Open.** Today's thread is created on first open. It may come with predicted items: yesterday's unfinished to-dos, and items an earlier thread scheduled for today. These are the only predictions in the first version. **Settled.** They appear as a suggestion list in the morning plan. Brian taps the ones he wants, and that tap adds them as his own action; the AI never writes them into the thread. Settled (msg 7c4e0cab). The list and the v0.3 morning hand-off are one set of suggestions, not two. A task appears once even if both sources find it. Adding it keeps the same task (Keep), never a new one. A paused task is not brought back. An item from an earlier thread that is not yet a task appears as a proposal and becomes a task only when Brian adds it. The visual arrangement is for Jazz.
2. **Record.** Plan, events, notes and anything else go into the thread as he goes. The layout keeps today's sections, plan on top and notes below, but only as a starting template: Brian can rename, add, remove and reorder anything. Settled (msg 7c4e0cab).
3. **Plan and review.** Planning the day and the evening review are the two events that trigger indexing (section 6). **Settled.** The v0.3 evening review (today's plan, optional saved-links step, reflection, up to 3 suggestions for tomorrow) carries over unless Brian changes it.

## 6. Indexing

Indexing turns what Brian recorded into AI pages. It runs at plan and at review, never continuously. **Settled.**

- **Reads:** day threads and your pages. **Settled.**
- **Writes:** AI pages only: creates new ones ("Tomato soup recipe") and updates existing ones. Inferred connections between pages stay in this layer and never show in the day thread. **Settled.**
- **Corrections:** a later statement by Brian outweighs an earlier inference, so a correction in a thread changes the AI page on the next run. **Settled.**
- **Rebuild:** because AI pages derive from threads and your pages, a run can be repeated or the whole layer rebuilt without losing anything of Brian's. Lead's instruction; the mechanism is in Wheeljack's `docs/specs-v0.5/pages-model-draft.md`.
- **Between runs:** after Brian edits, AI pages stay visible, marked "may be out of date", until the next run. When he deletes something an AI page relied on, that page is hidden at once. Proposed, pending trial (Lead, msg 6710c2cf).
- **Later, not in the first version:** search and AI chat over all pages. The structure must leave room for both. **Settled.**
- **AI pages ship in the first version, minimally:** indexing runs, Brian can browse AI pages and copy one into his pages. No search, no chat. Settled (msg e83b0640).
- **Budget:** each indexing run is a paid model call and follows the v0.3 budget rules (reserve first, no automatic retry). Size and cost per run are not yet estimated.

## 7. Tasks and Placement

Tasks stay what they are in v0.3: an item with its own identity, status and dates, not a page. **Assumption.** The v0.3 rules carry over unchanged:

- **Placement** ("this task is planned for this day", with its order) decides what is planned for a day and in what order, for Today, Calendar and the hand-off; it is never rebuilt from page text. Deadlines, start dates and status come from the Task, and events from the Event, so Upcoming still shows items that have only a deadline or a start date.
- A task shown on several pages is always the same task. Deadlines are never hidden; red only for a passed deadline.
- Deleting one complete plan row of the current day sets that task to Not today, with Undo; past days' rows and ordinary references are excluded. Deleting text that includes plan rows removes only the text; the tasks stay planned and show as "Planned · not in note".
- Not today pauses carry-over and keeps the deadline.

Open in the spec, to settle in v0.4.1: if a paused task still has a later planned day, does it return to that day's thread when the day comes? Until then it shows in Upcoming with a Not today mark.

## 8. Navigation

Four tabs, Craft's layout: **Today · Tasks · Calendar · Pages**, plus a floating + for capture. On desktop, a sidebar. This is what is on main now.

| Tab | Shows |
| --- | --- |
| **Today** | Today's thread |
| **Tasks** | Today · Upcoming (by do, start, due) · Open · Not today |
| **Calendar** | Days down the screen, each with its thread and that day's planned tasks |
| **Pages** | Your pages as a nested tree (pages inside pages). "A folder of mine" means this tree; no separate folder system. **Assumption.** |

AI pages ship in the first version, so they need a place to browse: a section in Pages or a fifth place. That is a design call for Jazz, not yet made.

## 9. What changes from v0.3 and v0.4

Most of the daily loop stays. The changes are in what pages are and where the AI may act.

| Topic | Before (v0.3 / v0.4) | Now | Status |
| --- | --- | --- | --- |
| First screen | C1 open: Today or a library | Today's thread | Settled |
| What a page is | Daily pages, free pages, link pages (v0.4) | Three kinds: day thread, your pages, AI pages | Settled |
| Saved link | Saved material (v0.3), then a link page (v0.4) | One of your pages; starts empty, Brian fills it by hand | Settled |
| Fetching link content | Ruled out | Still none: no AI step when a link page is created | Settled |
| Where the AI acts | Capture, evening review, Draft my day; never on page open | Plus indexing at plan and review, which writes AI pages only | Settled |
| AI context | Today's page plus what it explicitly references, followed recursively; no implicit or backlink crawl | Indexing reads all threads and your pages | Settled |
| AI edits to existing content | Proposed, then confirmed by Brian | Never on your content; AI pages only | Settled |
| Morning hand-off | Keep or Not today per task, no AI | Predictions shown as a suggestion list he adds from; no AI write | Settled |
| Craft | "Copy Craft for v1" | UX/UI reference only | Settled |
| Saved-link follow-up (To sort, Keep watching, …) and the Related line | Good Stuffs addendum | Not yet discussed against the new model; unchanged for now | To review |
| AI drafts on the day page (Draft my day, review suggestions) | AI drafts could be merged into an existing day page after Brian confirmed | No AI write-back to threads; a suggestion lands only through Brian's own tap. Whether Draft my day survives is to review | Settled; Draft my day to review |

## 10. Scope

The first version is today's thread on top of the three-kind page model, with indexing in place and two kinds of prediction. Reminders and calendar are outside this discussion; the design must stay compatible with them, and they should not affect the core design. **Settled.**

| Stage | Included |
| --- | --- |
| **Built (main)** | v0.3 daily loop; Craft-style UI with Today, Tasks, Calendar, Pages tabs and capture |
| **First version** | Day thread as the source of truth · your pages, with saved links as link pages · indexing at plan and review · predictions of yesterday's unfinished to-dos and items scheduled for today · AI pages, minimal: browse and copy (Settled) |
| **Later** | Search and AI chat over all pages; more prediction types; e-ink (TRMNL) display |
| **Add-ons, outside this discussion** | Reminders and calendar. Brian expects page properties plus extra tables to cover them, and they must not affect the core design. **Settled.** |
| **Out for now** | Sharing and publishing, collaboration, multiple spaces, Craft's AI assistant |

### Compliance constraints

**Built for Brian now, App Store later.** Brian expects to publish on the App Store one day, so the product should avoid legal and compliance risk from the start. **Settled** (msg 08a02686). Three places this already touches (Lead, msg 6c6040a3):

- **Craft's look.** We copy Craft's layout and interaction patterns, never its icons, illustrations, colours, wording or any distinctive look someone could take for Craft. The Craft screenshots stay out of the repo. Before any store submission the visual style must become Daythread's own, so the app is not a look-alike of Craft.
- **The name Weave.** It is the chosen name; no trademark or store check has been done yet. Other products already use the word, so a trademark search on Weave and Daythread is needed before launch. Until then Weave is used only inside the app, never as the app's name or icon.
- **Data and AI.** Sending Brian's notes to the AI provider must be disclosed, he must be able to delete his account and data, and App Store privacy labels must be fillable truthfully. No work now; the data model has to support it.

## 11. Success measures

The trial asks whether Brian records his whole day in one place, and whether what he recorded comes back useful. The first three measures carry over from v0.3; the last three are proposed and need his agreement.

| Measure | Target | Fail signal |
| --- | --- | --- |
| Daily use | Today's thread opened and plan or review done on most trial days | Brian goes back to Notion for the daily note |
| Lost commitments | 0 tasks lost or duplicated across days | Any planned task missing the next morning |
| Burden | "Still open" and "Not today" read as help | The count keeps rising and Brian reports pressure |
| One place to record (proposed) | Brian opens no other page to record something | He keeps notes elsewhere or opens other pages to write |
| Corrections stick (proposed) | A correction written in a thread shows on the AI page after the next run | The same mistake survives a run after he corrected it |
| Your content is untouched (proposed) | 0 AI changes to a thread or page of his after its creation | Any occurrence |

The Good Stuffs measure (≥ 50% of saved links get a follow-up decision within 7 days of becoming eligible) is held until the follow-up model is reviewed against link pages.

## 12. Open decisions and assumptions

Brian has decided every new question: link pages start empty and AI pages ship minimally (msg e83b0640); predictions are a suggestion list and the day thread keeps today's sections as a freely editable template (msg 7c4e0cab); the AI pages are called Weave (msg 08a02686). Two choices from the Craft study still wait for him:

| # | Question | Recommended | Alternative |
| --- | --- | --- | --- |
| C4 | Checkboxes on ordinary pages | (a) Plain checklist line with "Make task" (new proposal) | (b) As now: every checkbox is a task |
| C5 | Capture default | (a) Auto: new items saved directly, changes confirmed once | (b) Task |

**Assumptions Brian may correct:** tasks are items, not pages; "a folder of mine" is the nested page tree.

**Sources:** Brian's answers (thread `06469260`, msgs `c377e316`, `e83b0640`, `7c4e0cab`) and the Lead's summary (msg `9ffbe94b`); v0.3 specs 00–04, Good Stuffs addendum, v0.4 `pages-delta.md`, Craft study `feature-map.md`; [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Field names and storage are Wheeljack's `docs/specs-v0.5/pages-model-draft.md`. Brian's latest explicit instructions take precedence over older specs. Where an older spec has not been revised yet, code that follows it does not mean the new requirement is built.
