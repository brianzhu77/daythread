# Review round 1 — brief

Owner: OptimusPrime (Lead). Requested by Brian on 2026-10-15 in #daythread (task #1).

## Status of the material under review

All of `README.md` and `docs/specs/00`–`05` are **unapproved drafts**. Wording such as
"已确定" / "用户已确定" or the folder name `specs` does not make anything final. The spec
files are not a git repo; `BASELINE.sha256` in this folder records the exact versions
reviewed in this round.

## Inputs, and how to classify them

| Kind | Content |
| --- | --- |
| User goal | Reduce daily planning and recall effort; support everyday use of tasks and collected material. |
| Technical preference (not a hard constraint) | TanStack Start + TypeScript, Supabase, OpenRouter + OpenAI GPT models. |
| Current design | Everything else in the specs, including D01–D11 defaults, BlockNote, M0–M5 order. |
| Hypothesis | Any claim about value, effort, or feasibility that has not been tested. |

Tag every finding with one of these kinds.

## Phase 1 — independent review (no reading of other reviewers' files)

| Reviewer | File | Primary focus (cross-role findings welcome) |
| --- | --- | --- |
| Bumblebee | `bumblebee-product.md` | Value, real user problem, scope and cuts, success measures, cheapest way to learn. |
| Jazz | `jazz-design.md` | Daily flows, information structure, start/finish/recover, empty/wait/error/conflict states, editing model. |
| Wheeljack | `wheeljack-engineering.md` | Architecture, data and state, editor/storage mapping, AI feasibility and cost, stack fit. |
| Ratchet | `ratchet-review.md` | Testable requirements, missing states, failure/abuse cases, acceptance method and its priority. |

Rules:

- Write only your own file. Do not edit `README.md`, `docs/specs/*`, or anyone else's file.
- Put your top 5 findings first. For each: issue, kind (goal/preference/design/hypothesis),
  evidence (spec section), impact, recommended revision or alternative with trade-offs,
  and how to verify. Mark severity: blocker / major / minor.
- End with: (a) questions only Brian can decide, (b) the smallest experiment you would
  run, (c) what you would cut from round 1.
- When done, post one short line in the task #1 thread. Do not read others' files until I
  open Phase 2.

## Phase 2 — cross-discussion

I open it once all four files exist. Each reviewer reads the others and appends a
`## Cross-review` section to their own file: agree / disagree with evidence. Lead then
writes `synthesis.md` with recommended revisions, disagreements, a minimal validation
plan, follow-up tasks, and the decisions Brian needs to make.

No application code, dependency installs, Supabase projects, or paid API calls in this
round without a separate go-ahead.
