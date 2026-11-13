# Smart note: product requirements

- Status: **draft. The three decisions in §11 are settled (Brian, 2026-11-12); the other proposals stand unless he
  corrects them. Not built.**
- Asked by Brian, 2026-11-12: a note whose content is written by the model from a saved prompt and a chosen range of
  the workspace, embedded in a page, refreshed hourly, daily or on demand.
- What is his and what is proposed: §1 and the entry flow in §4 are his. Everything marked **(proposal)** is a call
  made while writing this, open to correction.

## 1. The need

Day pages collect to-dos, raw notes and clips in the order they happened. Work on one feature or project ends up
spread over weeks of them. When he sits down to sort a project out, he opens a new page and wants one section of it
to say "here is what my notes hold about feature X", without re-reading every day.

Today the workspace offers tags, search, `[[` links and "Linked from" for this. All of them return a list of places
to go and read. None of them returns the answer.

## 2. Is it a sound thing to build

**Yes.** It fits the product better than most AI features would:

- `PRODUCT.md` names the success test as "material saved there actually being reused", and says AI is "durable and
  core". This is the reuse mechanism for raw notes.
- It has the same shape as something already in the app: a linked view is a saved query shown in place. A smart note
  is a saved query whose result is prose.
- Most of the parts exist: the server-only model client (`src/server/model/openrouter.ts`), a page-to-text reader
  that gives every line an id (`src/server/model/day-draft.ts`), a record shown in several places
  (`src/domain/synced.ts`), tags, line links, and a scheduled tick on the Worker (`src/server/push/cron.ts`).

**Four things in the ask need adjusting**, or the feature works in a demo and fails in use:

1. **"The whole workspace" cannot mean "send the whole workspace".** The day draft already limits itself to 7 days
   and about 30,000 characters. A workspace of some months will not fit one call at a sane cost. The range needs a
   budget, a rule for what is read first, and a plain statement of what was read and what was left out (§5).
2. **A wall-clock hourly refresh is mostly waste.** Notes do not change every hour, and each run costs money and
   rewords the result. A schedule should mean "check this often, and call the model only if the notes in range
   changed" (§6).
3. **The output must be read-only and must show its sources.** If it can be edited, the next refresh destroys the
   edit. If it cannot be checked against the lines it came from, it cannot be trusted for project decisions. Each
   statement links to its source lines, and one action turns the note into ordinary text to work on (§7).
4. **The result must stay outside everything the app derives from pages.** Tags, events, to-dos and "Linked from"
   are all read from page documents. Model-written text must never create a tag, an event or a link, and must never
   be fed back to a model (§8).

With those four, it also satisfies principle 4 ("the model proposes, the user decides"): the model writes into a
marked, read-only area, and nothing of the user's is changed.

## 3. Goals

- One block answers a standing question about the user's own notes, where they are working.
- The user can see what it read and follow any statement to its source line.
- A saved smart note costs nothing while its sources are unchanged.
- The app stays complete with no model: the last result still shows.

**Not in this version:** semantic search or embeddings; reading the web content behind a clip (only what is on the
bookmark page); writing to pages, to-dos or databases; chat or follow-up questions; a choice of model per note;
sharing.

**Would make it a failure even if it works:** a summary that states something the notes do not say, with no way to
check; a refresh that discards something the user wrote; scheduled notes nobody reads spending money every hour.

## 4. How it works for the user

### Insert

`/` → **Smart note** (Brian). The item opens a short list: the workspace's existing smart notes, and **New**.
Choosing an existing one places the same note here: one definition, one result, shown in each place, as a synced
block is.

### Set up

**New** opens the setup in the shell Buttons and automations already use: a popover-sized panel hung from the line
at 1280, a sheet at 390 **(proposal;** Brian said "a dialog or a side panel", and this keeps the page in view while
the preview is read without a new kind of surface). It holds:

| Field | Default | Notes |
| --- | --- | --- |
| Prompt | empty | Free text, any language |
| Range | Whole workspace (Brian) | §5 |
| Refresh | On demand (Brian, 2026-11-12) | Hourly, Daily, On demand (Brian). §6. Not shown in the first release, which has On demand only |
| Name | From the prompt | What the picker and the block's header show **(proposal)** |

**Preview** runs the prompt against the range and shows the result in the pane, with what it read ("Read 14 pages,
Oct 20 to Nov 12 · 6 older pages left out"). It runs only when asked, since every run is a paid call. The prompt
and range can be changed and previewed again.

**Save** stores the definition with the last preview as its first result and embeds the block. Nothing is stored and
nothing is embedded before Save.

### The block on the page

```text
Checkout redesign: where things stand            Updated 2h ago   ⟳   ⋯
────────────────────────────────────────────────────────────────────────
Decisions
 · Guest checkout is out of the first release ¹
 · Address form moves to one step ² ³
Open questions
 · Who owns the tax rounding change? ⁴
Read 14 pages · Oct 20 to Nov 12
```

- The header shows the name, when it last ran, Refresh, and a menu: Edit (reopens setup), Copy, Turn into text,
  Delete.
- The body is read-only: headings, paragraphs and list items, as plain text. Emphasis and page links inside the
  text are later.
- The small numbers are sources. Each opens the line it came from, as a line link does.
- When the notes in range have changed since the last run, the header says so ("Notes changed") **(proposal).**
  This is a comparison of stored content, with no model call, so an on-demand note still shows when it is stale.
- **Turn into text** replaces the block, in this place only, with ordinary lines holding the same words, each source
  as a line link. This is the way to start working on a summary.
- **Delete** removes this place. A note with no place left is no longer offered in the picker, and Undo brings the
  place back **(proposal).** Its record is kept until a later clean-up, so a cut and paste never loses a note.

### States

| State | What shows |
| --- | --- |
| Running | The previous result stays, with a quiet running mark. Nothing moves under the reader |
| Failed | The previous result stays; "Couldn't refresh · Retry" in the header |
| No model for this account | The last result and its time. No Refresh. `/` does not offer Smart note **(proposal)** |
| Offline | The last result, from the stored workspace |
| Range now empty (page or tag deleted) | The last result and "Its range was deleted", as a broken automation says |
| Paused (§6) | The last result and "Paused", with Resume in the menu |

## 5. Range and what gets read

The range is a filter the user can state, applied by the app. The model never chooses what it is sent.

- **Where:** whole workspace (default), chosen pages with their subpages, a tag, or day pages only.
- **When:** all time (default), or the last 7, 30 or 90 days **(proposal).**
- **Never read:** Trash, templates, drafts, the page's own smart notes and any other smart note's result.
- **Budget (proposal):** one run reads up to a fixed amount of text, to be set from real cost. Inside the range the
  most recently edited pages are read first, and day pages keep their date. When the range is larger than the
  budget, the note says how many pages were left out, so the user can narrow it.
- **Later:** when a range exceeds the budget, choose lines by match to the prompt's terms instead of by recency.
  Embeddings are out of scope until this proves too weak.

A database inside the range is read as its rows' titles and bodies. Reading properties as structured data is later.

## 6. Refresh

- **On demand:** only when the user presses Refresh. The default, as it covers the scenario in §1.
- **Daily:** early morning in the account's time zone, before the day starts **(proposal).**
- **Hourly:** at most once an hour.

Rules for the two schedules **(all proposal):**

- A scheduled run first compares the content in range with what the last run read. **Unchanged means no model call.**
- Each run is given the previous result and told to keep statements that still hold, so the note does not reword
  itself on every refresh.
- A note pauses itself after three failed runs in a row, or when no one has opened a page showing it for 14 days.
  Resume is one action.
- A workspace has a ceiling on scheduled notes and on runs per day, set by the server.
- Each run records its cost, as the model client already returns it.

## 7. Output and sources

- The model answers in a fixed structure (blocks of heading, paragraph or list item, each with the ids of the lines
  it rests on), as the day draft does. The server drops any source id that is not in what was sent, before storing.
- The answer is in the language of the prompt.
- A date in the output is plain text, never an `@date` chip. A `#word` is plain text, never a tag.
- Export writes a smart note as static text with its "Updated" time.

## 8. Data and rules for the build

- **Stored once per workspace,** beside synced records: the definition (name, prompt, range, refresh), the last
  result, when it ran, what it read (a key of the content, and the counts shown), and its paused state. A page's
  document holds only a block with the note's id.
- **Unlike a synced block, the result is never expanded into the page's lines.** Search, tags, events, to-dos,
  "Linked from", the day draft and other smart notes do not see it.
- Saving a definition is a command with Undo. In the first release a refresh is the user's own action and has Undo
  too: it brings the previous result back. A scheduled result (second release) must neither take nor clear the
  user's Undo.
- Implementation plan for the first release: `docs/plan/smart-note.md`. Its "Data model (ERD)" section shows the
  tables touched: no table or column is added.
- The model key stays on the server. A run is allowed only for accounts with AI on (today's allow-list).
- A mocked or missing model is never shown as a model's answer (`PRODUCT.md`, Positioning).

## 9. Approaches considered

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **A. One-time "summarise" command** that inserts ordinary text | Cheapest to build; nothing to refresh, store or schedule. Stale the next day, and it is the user's request minus "dynamic" | Rejected as the feature; kept as **Turn into text** |
| **B. A live block with a saved definition** (this document) | New record kind and a read-only renderer. Matches the ask, and reuses the synced-record and day-draft patterns | **Chosen** |
| **C. A smart page or an "AI" database view** | Larger surface; the result could not sit in one section of a working page, which is the scenario in §1 | Rejected |

## 10. Order of work (Brian, 2026-11-12)

1. **First release:** the `/` item and picker, setup with preview, Save, the read-only block with sources, Refresh
   on demand, "Notes changed", range (where and when) with the budget and the "left out" count, Turn into text.
2. **Second:** Daily and Hourly on the Worker's scheduled tick, the unchanged check, self-pause, limits, cost
   records. The Refresh field exists from the first release, so nothing stored changes.
3. **Later:** choosing lines by match, database properties as input, clip contents.

The schedule comes second because the first release already answers §1, and a schedule is only worth its cost once
a note has proved worth keeping.

## 11. Decided (Brian, 2026-11-12)

1. **Schedules come in the second release.** The first release refreshes on demand and shows "Notes changed". The
   alternative, Daily and Hourly from the start, was declined.
2. **A new smart note defaults to On demand.** The alternative was Daily.
3. **The on-screen name is "Smart note".** "AI note" and "Digest" were the alternatives.

## 12. How we will know it works

- He keeps at least one smart note on a project page for two weeks, and it is still there after.
- He follows sources from it, and uses Turn into text to build on a result.
- He stops paging back through day pages to assemble the same picture by hand.
