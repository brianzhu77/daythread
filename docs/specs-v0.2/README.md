# Daythread — specs v0.2 (draft)

Status: **unapproved draft**, written 2026-10-15 after review round 1. It replaces nothing
yet: the v0.1 drafts in `docs/specs/` and the root `README.md` are unchanged. This README is
the proposed replacement for the root README once Brian accepts v0.2. (README part of task
#7; owner Bumblebee, reviewer Ratchet.)

Daythread is a personal web app built around an editable daily page. Brian records things,
plans the coming days, reviews today, and keeps and references material he has collected by
hand.

## What changed from v0.1, and why

Round 1 (`docs/reviews/round-1/synthesis.md`) found four problems:

1. The core value was tested last.
2. The day's plan had three sources that could disagree.
3. Open tasks could silently drop out of view.
4. The material loop repeated the "saved, never revisited" pattern.

v0.2 applies revisions R1–R11. Each file starts with a change log mapped to them.

## Status of what is written here

| Kind | Meaning in these files |
| --- | --- |
| Goal | Something Brian stated he needs (00 U01–U12). |
| Preference | Something Brian stated he prefers: the stack (TanStack Start + TypeScript, Supabase, OpenRouter + OpenAI GPT). Kept as the default; re-opened only on a real blocker. |
| Design | A team choice (00 D01–D13, invariants I1–I5). Adjustable after evidence. |
| Hypothesis | Untested; each names the check that tests it (04 §V, §T). |

Nothing has been prototyped, built, or tested. Wording such as "must" describes the intended
behaviour, not a verified result.

## Reading order

| File | Question | Owner (v0.2) |
| --- | --- | --- |
| [00 · Scope](00-scope.md) | What round 1 does and defers, invariants, defaults, success measures | Bumblebee |
| [01 · Flows and UX](01-flows-and-ux.md) | How Brian uses it each day; states and copy; interaction defaults | Jazz |
| [02 · Domain and state](02-domain-and-state.md) | Identity, dates, placement, open pool, consistency | Wheeljack |
| [03 · AI contract](03-ai-contract.md) | Model inputs and outputs, allowlists, confirmation, failure | Wheeljack |
| [04 · Acceptance](04-acceptance.md) | Pre-build validation, functional checks, 7-day trial | Bumblebee |
| [05 · Delivery](05-delivery.md) | Order of work, spikes, first slice | Wheeljack |

## The two loops

```text
Action:   capture → item saved → Today (facts + placed + open pool) → done / Not today /
          reschedule → review (confirmed changes + tomorrow's suggestions) → next morning
Material: collect by hand → page → resurfaced or referenced → used in today's work →
          conclusion written
```

## Layout is still open

Where the day's plan sits on the page is decided in the prototype session (04 §V2):

- **Layout A:** a structured Today zone above free Notes.
- **Layout B:** plan rows inside the free body.

Text that depends on the layout is marked [Layout A] / [Layout B] in each file. The rules in
00 D01–D06 and the invariants hold for both.

## Order of work

1. Paper state replay and this v0.2, in parallel with the user-facing validation: baseline,
   prototype session, and the concierge test.
2. Choose the layout, then finish the layout-dependent text.
3. Throwaway spikes only where the chosen layout needs them.
4. One end-to-end slice through the action loop, plus one referenced page.
5. Widen, then run the 7-day app trial.

## Waiting on Brian

These are the four questions in synthesis §4:

- **D-A:** validate before building.
- **D-B:** devices and review habit.
- **D-C:** what may be sent to the model, and the budget.
- **D-D:** Daythread as the only daily note during the trial.

No application code, installs, data projects, or paid model calls happen before D-A and D-C
are answered.

## Current files

```text
daythread/
├── README.md                    # v0.1 index (unchanged)
└── docs/
    ├── specs/                   # v0.1 drafts (unchanged)
    ├── specs-v0.2/              # this revision
    └── reviews/round-1/         # reviews, synthesis, state replay
```
