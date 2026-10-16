# refs delta — summary

Author: OptimusPrime (Lead) · 2026-10-15 · Status: **proposal for Brian**; `specs-v0.2` not yet
edited.

Inputs: Brian's answers to D-A..D-D (#daythread:3cf148c1 msg 7a55cbbf), `refs/`, and four delta
files in this folder (Bumblebee, Jazz, Wheeljack, ratchet). Nothing here has been built, run on
a device, or charged to a provider account. Official-documentation checks are not device tests.

## 1. Does the new context change the conclusion?

The data-correctness groundwork stays (single task identity, capture saved first, atomic apply,
version checks, access rules). Five round-1 conclusions change:

| Area | Round-1 / v0.2 | Now | Evidence |
| --- | --- | --- | --- |
| Validation order | 1.5–2 weeks of concierge trial + prototype before code | Pre-build gate removed. The first thin slice is the experiment; 3-day baseline runs in parallel. Prototype only if real notes leave the layout open. | D-A; O-U08–O-U10 |
| Review | Reminder deferred; review assumed to happen | Reminder + guided review in round 1, usable on iPhone. Primary success signal: review done on ≥5 of 7 days; <3 of 7 switches the default to morning-first. | O-U03; D-B |
| Model input (R7) | Titles + short excerpts by default | Day's note is the root; follow explicit links to full content (deduped, cycle-safe, no backlink crawl). Too large → fail visibly, keep input, nothing sent; no silent truncation or summary. | O-U10; D-C |
| Page layout | Leaning to a separate Today area (A) | Plan rows inside the free page (B) by default; A only if note samples show plan items getting lost. | O-U06; D-C |
| Resurfacing (R8) | Candidate, gated by the concierge test | Thin removable "Related" line (0–2 items/day) in the first slice, with a kill rule. 10–20 saved items sent in full text; switch to a title catalogue (and "may be useful" wording) when the set outgrows capacity. | O-U03 point 2 |

## 2. Source corrections

- Block/paragraph-level references and backlinks were the assistant's design, not Brian's
  request (O-U11 asks for storage plus a reference from the daily note). Granularity is now
  judged on cost and use; page reference + quoted excerpt is the likely first-slice default.
- "Real commitments must never silently drop" was the assistant's reliability proposal
  (Brian answered "make sense"). The open-pool rule stays, justified by recall effort
  (O-U03); the trial also measures backlog burden, Brian's actual worry (O-U07).
- Deferring reminders, e-ink and Calendar was the team's cost choice, not Brian's.

## 3. Team rulings during this check

- Deleting a whole plan row sets the task "not today" with a notice and Undo, no prompt.
  Editing text, deleting an ordinary reference, or bulk-deleting text never sets tasks aside;
  bulk-deleted plan rows stay on today's plan, listed outside the note.
- The review's reflection step is never parsed; task changes go through capture.
- $10/day is enforced by the app per Vancouver day: reserve a conservative cost before each
  call, settle with the provider's actual cost, one paid call in flight, shared across devices.
  OpenRouter's own key limit (resets at UTC midnight) is only a backstop. At the cap nothing is
  sent; writing, task actions and manual review keep working; retry is manual.
- iOS web apps cannot receive the system share sheet; round 1 uses copy link → paste.
- A review counts as done when Brian's own input is saved (`review_saved`); the next-day draft
  (`draft_ready`) is logged separately, and a failed or budget-blocked draft is a system
  failure, not a skipped review.
- First-slice references are page-level: they open the source page; a quote keeps its excerpt
  as text. Stable paragraph anchors are a later feature.
- Model input has two separate lists: full content of everything the day's note links to, and
  the resurfacing set. The resurfacing set is only the 10–20 items Brian brings in for the
  trial, not his whole library; D-C is not read as consent to send unrelated history.

## 4. Decisions for Brian

1. **Start building the thin slice?** Recommended. Needs: installs, a Supabase project, an
   OpenRouter key, and an HTTPS deployment reachable from the iPhone.
2. **Reminder channel.** Recommended: a native iOS repeating reminder linking to the review
   page for the first slice (minutes to set up, no backend); move to Web Push from a home-screen
   web app if the trial shows a need. Email is the fallback.
3. **Material to share** (one-time, ~15 min): 1–2 real daily notes (redacted is fine), a few
   lines on the Notion manual run, and 10–20 saved items you'd like to see again.

## 5. Specs to revise after Brian confirms

00 (scope, success, order of work, sources), 01 (layout default, delete mapping, guided review,
iPhone), 03 (context expansion, budget, resurfacing input), 04 (validation, trial rules, new
review/reminder and delete-mapping cases), 05 (deployment, reminder, budget checks), synthesis
§2/§5/§6. Owners as in each delta file; Ratchet reviews.
