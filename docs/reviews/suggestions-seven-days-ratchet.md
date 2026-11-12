# Independent baseline: Tomorrow omission and seven-day input

Task346. Brian's request: #daythread message 3d7aca46 (2026-11-12); baseline origin/main 977ba776. This is an investigation/handoff, **not a claim that the reported omission is fixed or its specific cause established**. No runtime source was changed.

## Verified baseline

The model request currently includes today's page, the latest earlier daily page, all eligible open tasks, and today's events. It does not select a seven-day set of recently edited pages.

Four independent synthetic checks: **one passes, three fail against the new requirements**:

- A yesterday page with a “Tomorrow’s Todo” heading, a real task, and a plain-text tomorrow plan reaches the request with all three intact. The existing task has a K ID. If the model returns no suggestion, that task is not forced into the suggestions; it appears only in `moreOpen` unless explicitly planned for today. This distinguishes model omission from missing request data. It does not prove which happened in Brian's actual run.
- An old daily page with a synthetic edit time of yesterday does not reach the request.
- A recently edited ordinary document does not reach the request.
- Saving an ordinary daily page with a specific `at` does not record its `editedAt`. The current timestamp assignments are restricted to database rows. Widening the input filter alone cannot correctly implement update-based selection on ordinary pages.

Evidence: `tests/ratchet-suggestions-seven-days.test.ts`. The three failures document newly requested behavior, not regressions introduced by this investigation.

## What is still needed to establish the real omission

Inspect the actual Nov11 source block's type, task identity/status and current placement, the request snapshot used for Nov12, the model result, and the stored Nov12 draft. If the page/draft was prepared before the source was saved, record that sequence too. `prepareDayDraft` returns early for an already-settled draft, and `set-draft` refuses replacing it; a prompt change by itself does not regenerate today's settled draft. These are possibilities to distinguish, not established causes.

No live account, real note body, paid model call or production mutation was used in my fixtures.

## Acceptance boundaries for the implementation

1. **Update-based membership:** an old page edited recently qualifies; a page whose date is recent but whose edit is outside the chosen interval follows the stated policy. Include ordinary documents and database-row bodies if “all content” is implemented across page types. Do not silently use page date as edit time.
2. **Clock and provenance:** define the seven-day interval and account time zone explicitly; test both edges. A source's original day and its edit time must remain distinguishable. “Tomorrow” in an old dated page is not automatically tomorrow relative to its recent edit.
3. **Coverage and safety:** give recent source text stable provenance, preserve headings/nesting, avoid duplicated synced text, and keep task IDs authoritative. Exclude Trash, templates and stored model drafts as source notes unless explicitly intended. Notes remain data, never instructions.
4. **No silent loss to limits:** if context size needs a bound, make the retained/excluded policy reviewable. A keyword match or first-N characters must not silently drop the explicitly written plan. Test long pages and a relevant line near the end.
5. **Tomorrow intent and existing identities:** compare the actual user's case with the request and resulting suggestions. Do not satisfy it by cloning an existing task as `new_todo`, reviving a completed/cancelled/paused task, or scheduling another future date for today. Test model omission/failure separately from model adherence.
6. **Existing drafts:** define how Brian can regenerate today's omitted plan without overwriting suggestions already applied/skipped. A newly created day passing is insufficient evidence for the already-settled day he reported.
7. **Persistence and rollback:** ordinary-page edit times survive repository round trips and old-build writes; no-op saves should not incorrectly make every page “recent.” Consider task-title changes mirrored onto other pages and synced content updates when defining what counts as a content edit.

These boundaries are recommendations for review; ambiguous choices remain with the Lead and current user direction. Model behavior needs actual controlled evidence beyond a request-shape test.
