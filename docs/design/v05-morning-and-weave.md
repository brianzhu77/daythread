# v0.5 design proposal — morning suggestions and where Weave lives

Status: **draft for review, rev 2** (author Jazz, reviewer Bumblebee). Rev 2 applies Bumblebee's review of c860128 and Wheeljack's r7 check. Nothing here is settled until Bumblebee has reviewed it, and the Weave placement is Brian's choice (Lead, thread `#daythread:06469260`).

Behaviour comes from the archived framework `docs/reviews/framework/product-framework-r2.md` (rev 68, main `4efea70`) and v0.3 `01-flows-and-ux.md` §3.5. This file decides only how things are arranged and look. Where they disagree, they win. Visual tokens are the current Craft v1 ones; their pre-launch replacement is tracked in `craft-v1-prelaunch-replace.md` and doesn't change any layout here.

Prototype: `prototypes/v05-morning-weave/index.html` (static HTML, no app code). Screenshots at 390 px and 1280 px are attached to the review message.

What is what:

- *From the framework / v0.3*: the rules quoted with a section number.
- *Design decision (mine)*: everything marked **Proposal**.
- *Needs Bumblebee or Brian*: §3.

---

## 1. Morning suggestions

### 1.1 What the list has to hold (framework §5.1, v0.3 §3.5)

One set of suggestions, not two. Sources:

| Source | Example | Is it a task already? |
|---|---|---|
| Suggested last night (review draft, Top 3) | "Rewind APPX PR" | yes |
| Unfinished from the most recent previous day | "Fix export bug" (from Thu) | yes |
| Scheduled for today by an earlier thread, written as text only | "Call the dentist" (Mon's Notes: "call dentist Friday") | no, so it shows as a proposal |
| Proposal from an earlier thread, not a task yet | "Book flights for Dec" (a line in Tue's Notes) | no |
| Lines to bring from the previous page (Good Stuffs, Notes) | a saved link | no, and never becomes one by bringing |

A task that already has today's planned date is **not** a suggestion: it is already on today's plan (v0.3 02 §74; shown as "Planned · not in note" when missing from the text). Putting it back into the list would undo a decision Brian already made (Bumblebee review of c860128).

Rules the design must make visible: a task appears **once** even when two sources find it; adding keeps the **same** task; paused tasks never appear; a proposal becomes a task only when Brian adds it; nothing has to be cleared; skipping is normal.

### 1.2 Arrangement — Proposal

One card at the top of today's thread, under the title, in the same place as today's Start the day card. Three groups, in this order:

1. **Tasks** — every suggestion that is already a task, as one list. Sources are merged and de-duplicated; each row carries **one reason line** in muted text, the strongest reason first: "Suggested last night" > "Unfinished · from Thu". A task found by two sources shows only the first reason, so it can't look like two items.
2. **Proposals** — lines from earlier threads that aren't tasks yet, including text that named today ("call dentist Friday", written Mon). Each row shows the line as written, the source ("Mon · Notes"), and a dashed outline instead of a solid one, so it reads as "not a task yet".
3. **From Thu's page** — Good Stuffs and Notes lines to bring. Collapsed to one line ("2 lines from Thu ▸") because they are optional reading, not plans.

Why one Tasks group instead of one group per source: Brian's question in the morning is "what am I doing today", not "where did this come from". Grouping by source made the same task appear in two places in v0.3 sketches; merging with a reason line keeps the "once" rule visible.

### 1.3 Rows and actions — Proposal

- **Add is a `+` button, not a checkbox.** A checkbox on a suggestion looks like "mark done". The row's leading control is a 32 px round `+` (44 px tap area). Tapping it adds the item to the plan at once and the row turns into "Added to Plan · Undo" for a few seconds, then leaves the card. No separate "Add selected" step.
- **Where it goes.** A task goes to the day's plan section (Top 3 for "Suggested last night", otherwise the general plan list), matching v0.3. A proposal is created as a new task there.
- **Top 3 already full.** A "Suggested last night" item goes to the general plan list instead; the Undo row reads "Top 3 is full · added to the plan · Undo".
- **Plan section renamed, moved or deleted** (settled with Bumblebee and Wheeljack against r7). Plan rows keep their own identity and role, so a renamed or moved section is still found by its role, not its title. If no section with the plan role is left, the card says so before anything is added: a muted line under the header, "Adding creates a Plan section at the top". The tap then creates that section and the row in one step; the Undo row reads "Added · Plan section created · Undo", and Undo removes both unless Brian has edited the section since. Nothing else ever brings a deleted section back.
- **Not today** sits in the row's ⋯ menu with **Another day ▾**, as in v0.3. Not shown as a button so the row isn't a wall of choices.
- **Add all tasks** at the end of the Tasks group (replaces "Keep all"). Proposals and lines are never added in bulk.
- **Done** and **Later** stay at the bottom of the card, as in v0.3. **Done** closes the card for today and counts as the hand-off being done (v0.3 04 log). Tasks left untouched stay as they were: open, not paused, not planned, and still listed under Tasks › Open ("Still open"); proposals and lines are simply not offered again today. **Later** collapses the card to a strip line "Suggestions · 4 ▸" that stays reachable for the rest of the day. Neither changes any item.
- **Empty state:** if nothing qualifies, no card. When the last item is added or set aside, the card closes on its own with no "all cleared" message, because nothing here is a count to reach zero. If last night's review didn't produce suggestions, the Tasks group shows a muted line "No suggestions from last night" — see §3 Q3 about Draft my day.

### 1.4 States covered in the prototype

Default (M1) · after adding one, Undo row (M2) · row menu and Later strip (M3) · no plan section left (M4) · Weave copy done (W4). "No card" has nothing to draw.

---

## 2. Where Weave lives — two options for Brian

Weave pages are browse-only in the first version: read one, see where it came from, copy it into your pages (framework §6). No search, no chat. They are written by the AI, so they must never look like Brian's own pages.

### 2.1 Common to both options — Proposal

- **Weave page view.** Read-only. A thin band under the title: "Weave · built from 3 days · updated Thu evening" (indexing runs at plan and at review, framework §6). Under the body, **Sources**: the days and pages it was built from, each a link. One primary action: **Copy to my pages**. The copy goes to the top level of Mine, where Brian can move it; the receipt reads "Copied to your pages · Open". Afterwards the Weave page shows "You have a copy ›" in place of the primary button, so the same page isn't copied twice by accident. No editing cursor anywhere on the page.
- **Out of date** (framework §6, proposed pending trial): the band turns amber and reads "May be out of date · updates at your next plan or review". Content stays readable.
- **Hidden after a source is deleted**: the page simply isn't listed. Opening an old link shows "This Weave page was removed because something it used was deleted."
- **Before the first indexing run**: "Weave fills in after you plan or review a day." No search box or chat placeholder, since neither ships in v1.
- **Visual mark**: Weave pages use a distinct small woven-lines icon and a lightly tinted title band; Brian's pages use the plain page icon. The mark is the same in lists, links and the page itself.

### 2.2 Option A — a section inside Pages (Proposal, my recommendation)

- Phone: the Pages tab gets two pills under its title, **Mine · Weave**. Mine is the nested tree; Weave is a flat list grouped by topic, newest updates first.
- Desktop: the sidebar's Pages group gets a second group **Weave** under it.
- The bottom bar keeps four tabs.
- Mine also offers **New page** at the end of the tree and in each page's ⋯ ("New page inside"); inside any page, typing `/` offers "New page" like Notion (Brian, msg `e526eb12`). Weave has no create action; its pages only come from indexing or are copied out to Mine.

For: copying an AI page into your pages happens within one tab; the four-tab bar and the `+` already fill a 390 px phone; Weave is rarely opened in the first version (it's rebuilt only at plan and review, browse only), so it doesn't earn a top-level place yet; it reads as one library with two owners, which matches "all content lives in pages".
Against: Weave is one tap deeper; it's less discoverable while Brian is learning what it does.

### 2.3 Option B — a fifth place

- Phone: a fifth tab, **Weave**, between Calendar and Pages. The tab capsule gets narrower icons (5 × 56 px instead of 4 × 64 px) next to the `+`.
- Desktop: a top-level **Weave** item in the sidebar, under Pages.

For: Weave is visible every day, which helps Brian notice what the AI has built and judge whether indexing is useful (the point of shipping it in v1); it's a clear boundary between "mine" and "AI-built".
Against: five tabs plus `+` is crowded at 390 px and gets tight at 375 px; a tab that is mostly empty in the first weeks; copying to your pages crosses tabs.

### 2.4 Side by side

| | A · section in Pages | B · fifth place |
|---|---|---|
| Taps to open a Weave page (phone) | 3 (Pages → Weave → page) | 2 (Weave → page) |
| Bottom bar | 4 tabs + `+`, unchanged | 5 tabs + `+`, tighter |
| Noticing new Weave pages | low; a small dot on the Weave pill after a run | high; a tab |
| Mine vs AI boundary | inside one screen, marked by icon and band | separate screens and the mark |
| Change if Weave grows later (search, chat) | can be promoted to B | already there |
| Reversible | yes | yes |

Recommendation: **A** for the first version, because Weave is browse-only and rarely opened, and A can be promoted to B once search or chat arrive. Brian picks.

---

## 3. Open questions

For Bumblebee (behaviour, not visual):

Resolved in review (Bumblebee, Wheeljack, rev 2 of this file):

1. Destination after the template is edited: by plan role; create a Plan section only on Brian's tap, announced beforehand (§1.3).
2. Tasks already planned for today are not suggestions; text-only mentions are proposals (§1.1).
3. **Draft my day** stays hidden until it's decided (framework §9).

For Brian (through the Lead): **Weave placement A or B** (§2.4).
