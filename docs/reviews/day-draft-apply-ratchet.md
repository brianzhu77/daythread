# Day draft: apply risks and acceptance plan

2026-10-31 · task #247 · Ratchet. Planning review, not implementation acceptance.

Contract: Brian 361325a5; Lead 055b72c0 and 5a15305c; Product 375c709e; design 445dedf.
Read `docs/plan/day-prep-draft.md` (origin/main) and current domain/editor paths. The latest Lead message supersedes older proposal wording: build now, actual day-page anchors, hidden draft page, additions only, one operation/Undo for Apply all, invited users model-off by default.

## Evidence obtained

Four invented-workspace probes pass with `node tests/evidence/ratchet-draft-apply/probes.ts`:

1. Completing a Task elsewhere leaves the target page content key unchanged. Generic `save-editor` with that old key and an existing Task id can rename the Task from proposed text. Page freshness alone does not establish Task freshness.
2. `plan-task` followed by `save-editor` creates two Undo units. Undoing the save removes the note but leaves the Task carried.
3. Copying task words into a fresh task row creates a second Task.
4. Retaining the original page key rejects a later overwrite after manual typing. Replacing that key with the freshly loaded key would remove this protection.

These demonstrate existing command semantics, **not defects in an implemented draft feature**. First probe harness mutated the cached `pageNodes` array; corrected with `structuredClone` before accepting results. No app source changed.

I independently audited the real five-output attachment 0a1e353d-6ed4-414f-9d8c-aac64bc5ac42. The audit uses the reported OPEN TO-DOS set, not yesterday's page, and matches the displayed task titles because this attachment does not expose original task ids. This checks coverage of the supplied experiment, not historical morning truth or the eventual app normalizer.

| Day | Open input | Model placed | Missing planned today | Other unplaced |
| --- | ---: | ---: | ---: | ---: |
| Oct 27 | 3 | 1 | 0 | 2 |
| Oct 28 | 5 | 3 | 0 | 2 |
| Oct 29 | 3 | 2 | 0 | 1 |
| Oct 31 | 3 | 1 | 1 | 1 |
| Nov 1 | 2 | 2 | 0 | 0 |

Thus **four of five** raw outputs leave input tasks unplaced, including Oct 27 (Product counted three). Oct 31 needs one forced planned-today band and one other-open entry. The source attachment is kept out of Git; reproduce counts with `python3 tests/evidence/ratchet-draft-apply/real-output-audit.py /path/to/downloaded-attachment.md`. No new provider calls made. Status/date leakage in historical inputs prevents judging predictive quality; Nov 1 has no observed outcome yet.

## Required apply boundary

- **One atomic command for the selected bands.** Flush/register the editor's pending content first; preserve its current document and IME draft. Combine Task placement, additions/fills and applied-band dispositions into one repository transaction and one Undo record. Reusing `plan-task` internally is fine; dispatching it as a separate operation is not sufficient for Apply all.
- **Validate against current Task state as well as page state.** `workspace.ts` save-editor (279–338) synchronizes row words into Task titles, can create Tasks or resurrect deleted ids, and removes placements with deleted rows. Do not hand raw model block JSON to this general editor command. Model task references resolve only to allowed, owner-scoped current Tasks. Recheck done/cancelled/paused/deleted/replanned/renamed cases at apply; never reverse a later user decision from a stale proposal. New task creation needs an explicit distinct operation, not title matching.
- **Actual target ids, never template ids.** `pageFromTemplate` generates fresh ids. Bind draft to owner, target page/date, generation id, source snapshot and target block ids. Fill only a still-empty compatible block; current accepted rule converts occupied fills to after, deleted anchors to planning end. Validate the resulting location: it must not land inside reflection, raw notes or an unrelated nested section. Stable ids do not make stale content or section intent safe automatically. If safe relocation cannot be established, retain the proposal without writing.
- **No blind replacement or forced freshness.** Apply a bounded addition to the latest flushed document. Keep the generation snapshot for validation; never attach a fresh `expectedContent` to an old full-document proposal. A concurrent save must conflict or be demonstrably merged without dropping either user's words. Preserve headings, quotes, dividers, nested blocks, refs and Task identities.
- **Retry and partial apply are idempotent.** Stable band ids plus app-generated row ids; record consumption in the same transaction. Partial Apply, then Apply all, double taps, reload and response-lost retries cannot apply a band twice. Skip/Dismiss never delete the Task. Undo must restore both placement and band disposition consistently; a late model response cannot bring dismissed/applied bands back.
- **Treat model text as untrusted data.** Validate ids, allowed source refs, supported types, lengths, duplicate/cyclic anchors and account boundaries before storage/apply. User journal instructions cannot become commands. Render text safely. Keep provider key server-side; avoid raw journals or model reasons in routine logs. Reasons may contain private text even though the UI hides them.
- **Hidden storage is a real type boundary.** If `type: draft` is used, audit every page-type consumer: navigation, search/tag/backlink indexing, export/backup policy, subpages, deletion/restore, offline copies and account switch. Readable export excludes drafts per Lead; explicitly decide whether lossless backup includes them. Parent deletion must not leave a replayable orphan draft. Storage in a page alone does not establish atomic Undo.

## Acceptance matrix for the implementation

These are **planned checks**, not passed tests. Reviewer will use a built local copy, invented data plus the authorized experiment attachment; no production writes.

| Group | Actions / fixture | Required result |
| --- | --- | --- |
| Coverage on real output | Feed all five captured outputs through the actual validator/normalizer, using stable source-id mappings | Every eligible planned-today Task in bands; each other eligible open Task in bands or more-open, exactly once. Assert Oct 31 forced addition and Oct 27 two more-open entries. Already-present current-day Tasks need no duplicate placement. |
| Identity and staleness | Generate, then complete/cancel/pause/replan/rename/delete a referenced Task in another tab; generate duplicate/unknown/cross-owner ids | No Task copied, renamed, resurrected or decision reversed by stale Apply. Invalid reference rejected safely; proposal remains recoverable. |
| Typing and conflicts | Type while request pending, immediately before Apply, during save, and in another tab; IME still composing | All user words survive; no partial Chinese task committed. Flush failure stops Apply. Stale document cannot overwrite current content. |
| Anchors and any template | Fresh day ids, repeated labels, nested headings, no headings, no task slots, empty template; move/delete/fill anchor after generation | Fill/after/fallback follow accepted rules without guessing by heading names; no reflection/raw-note text generated; preview matches final placement. |
| Atomicity and Undo | Mixed existing Task + note bands; Apply all; fail one validation or transaction; Undo once | All chosen edits plus dispositions commit together or none do. One Undo restores entire logical apply. Later manual changes are never overwritten by stale Undo. Per-item Apply retains its own truthful Undo unit. |
| Partial lifecycle | Apply one, edit suggestion, Skip another, Apply all, repeat/double tap, reload, Undo, regenerate | No duplication; applied/skipped state persists as specified; unchosen open Tasks remain available. Late generation cannot reset dispositions. |
| Offline and uncertain commit | Offline before model, before Apply, after server commit but before response; Retry same operation | Editable template immediately, same insert-only fallback; pending proposal/typed words retained; retry receipt yields one effect. No success until acknowledged. |
| Owner/date lifetime | Sign out/switch account, next day/midnight/DST, navigate away, parent deletion, late response | No draft/text leakage or wrong-day apply. No invited-user provider call without opt-in. Reopen/resume has deterministic same-day behavior. |
| Events and old UI removal | Existing dated line plus today's event; remove card/Bring/Continue/Tomorrow | Event shown once, no copied dated-line duplicate. Migrate pending Tomorrow text once, including composition, offline and second-tab recovery; no loss or duplicate Task. Task-menu scheduling/reminders still work. |
| Display and scroll | Chromium 1280, WebKit 390, light/dark; request resolves above active caret; Show; keyboard open | No movement while typing; Show anchors visible line; bands/action targets usable, no clipped controls. No why prose. Apply preview equals saved page after reload. |
| Storage boundaries | Draft creation/retry/parent deletion/export/search/offline/account switch on SQLite and throwaway PG | No draft visible as user page or indexed content; correct owner scoping, atomic writes and explicit backup behavior. |
| Hostile output | Journal prompt injection, malformed/oversized output, unsupported type, duplicated ids, unknown anchor, model timeout | No unauthorized writes; safe fallback remains editable; no secret/journal disclosure in errors. |

Use domain assertions for identity/dispositions and repository transaction faults; built browser flows for editor flush and pending/Retry. Block service workers in intercepted-response tests, allow them in actual offline tests. Native Pinyin Simulator for composition and app termination; physical iPhone/Home Screen/third-party keyboards remain separate unverified coverage. No need to gate design on predictive accuracy that the available history cannot establish.
