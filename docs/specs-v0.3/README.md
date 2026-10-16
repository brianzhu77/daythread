# Daythread — specs v0.3 (draft)

Status: **draft under revision**, started 2026-10-15. Brian has approved building a first
thin slice (#daythread:3cf148c1 msg 78871f09); he has not approved these documents. v0.1
(`docs/specs/`) and v0.2 (`docs/specs-v0.2/`) stay frozen for reference. README owner:
OptimusPrime.

Daythread is a personal web app built around a daily page. Brian captures things, carries
open items forward each morning, reviews the day in the evening, and gets back material he
saved.

## What changed from v0.2, and why

Inputs: Brian's answers to D-A..D-D (msg 7a55cbbf), the background in `refs/`, a real daily
note structure (msg 78871f09), and `docs/reviews/refs-delta/` (see `SUMMARY.md`).

1. **No pre-build validation gate.** Brian already ran the routine by hand in Notion. The first
   thin slice is the experiment; the concierge test and prototype session are cancelled.
2. **Sectioned, editable page.** Brian's note has fixed sections: Top 3, Other, Events, Good
   Stuffs, Notes. The page keeps them; plan rows live in Top 3 / Other. Layout A/B is closed.
3. **Morning hand-off is a main path.** It lists all of yesterday's open items (Keep / Not
   today) and lets him bring unchecked Good Stuffs / Notes lines to today.
4. **Review is in round 1.** Repeating iOS reminder → guided review on iPhone. Success counts a
   day if the review is saved or the morning hand-off is done; both are logged separately.
5. **Full linked context.** The model gets the day's page plus everything it explicitly links
   to, in full. Too large → nothing sent, input kept. $10/day cap enforced by the app per
   Vancouver day.
6. **Resurfacing in the first slice.** A removable "Related" line (0–2 items) drawn from past
   Good Stuffs links; shopping excluded; kill rule in the trial.
7. **Source corrections.** Paragraph-level references, "commitments never silently drop", and
   deferring the reminder were team or assistant proposals, not Brian's requests. First slice
   uses page-level references.

Each file starts with a change log against v0.2.

## Status labels

| Kind | Meaning |
| --- | --- |
| Goal | Brian stated it; cite `refs/02-user-quotes.md` or a thread message. |
| Preference | Brian's stated default (TanStack Start + TypeScript, Supabase, OpenRouter + a GPT model). |
| Design | Team choice; adjustable after evidence. |
| Hypothesis | Untested; names the trial measure that tests it. |

Nothing has been built or tested. "Must" describes intended behaviour.

## Files

| File | Question | Author | Reviewer |
| --- | --- | --- | --- |
| [00 · Scope](00-scope.md) | Scope, invariants, success and stop rules | Bumblebee | Ratchet |
| [01 · Flows and UX](01-flows-and-ux.md) | Page sections, hand-off, guided review, iPhone | Jazz | Bumblebee |
| [02 · Domain and state](02-domain-and-state.md) | Identity, placement, pool, material identity | Wheeljack | Ratchet |
| [03 · AI contract](03-ai-contract.md) | Context expansion, budget, outputs, failure | Ratchet | Wheeljack |
| [04 · Acceptance](04-acceptance.md) | Functional cases, 7-day trial | Bumblebee | Ratchet |
| [05 · Delivery](05-delivery.md) | Thin slice, deployment, reminder | Wheeljack | Ratchet |

## Order of work

1. v0.3 revision, local scaffold, and `docs/setup-proposal.md` in parallel.
2. Brian approves external setup (Supabase project, HTTPS hosting, OpenRouter key and limit).
3. Thin slice: capture → page → hand-off → reminder → guided review → next-day draft, plus
   Related line. Light baseline runs alongside.
4. 7-day trial with Daythread as the only daily note (D-D).

No external accounts, deployments, or paid model calls before step 2.
