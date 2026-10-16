# Block editor and page model assessment

Version: 2026-10-16 r1. Author: Wheeljack. Baseline: local main efd6017. Scope: documentation and official-document research only; no packages installed, editor instantiated, code changed or runtime compatibility proven. Product review: Bumblebee. Latest directives: Brian 3596b765; Lead 8b8a4a7c and 856cc725 in #daythread:8d0ab5da.

## Recommendation first

1. **Proceed with Jazz's day-page visual redesign now.** Typography, document width, quiet controls and page-link cards do not require replacing the editor. Do not make the visual branch carry a data migration.
2. **Choose BlockNote as the first candidate for a disposable editor experiment**, not an approved production dependency yet. It supplies the block-oriented UI we need, and its documented custom blocks and change hooks are promising for adapting Task references. Use community/core packages only. If selection/delete/undo control fails the experiment, use Tiptap rather than patching undocumented internals. Lexical is viable but requires more UI assembly for this team.
3. **Keep pages and task commitments outside the editor.** Nesting pages is a graph/tree concern, not nested editor blocks. A saved URL should become a Page with URL metadata; its review state remains separate from its position in the page tree. This meets Brian's new requirement without requiring a general database product.
4. **Retain v0.3 D05 and A19.** A generic document diff cannot determine user intent reliably. Plain cut, bulk delete or drag outside the plan changes presentation only. Only an unambiguous deletion of one entire current plan row invokes Not today. Ambiguous edits fall back to presentation-only with a visible planned-not-in-note receipt. If the experiment cannot distinguish these reliably, recommend explicit Not today and obtain Brian's acceptance of that interaction change.

Rough planning estimate, not measured delivery time: 1–2 engineer-days for the editor decision experiment; 6–10 more engineer-days for a narrow production editor and adapter, including migration and regression; 4–7 additional engineer-days for nested-page/URL-page functionality and its migration. Combined range 11–19 engineer-days, with overlapping adapter/migration work deducted. Design review, real-device testing and user feedback can add elapsed time. Cloud/auth/deploy, automatic fetching, collaboration and a full Notion feature set are excluded. Re-estimate after the experiment.

## Evidence and library comparison

Checked official documentation on 2026-10-16. The effort and suitability judgments below are engineering inferences, not benchmark results.

| Candidate | Verified documented capability | Fit and cost | Decision |
| --- | --- | --- | --- |
| BlockNote | Block UI, slash menu, drag/drop; React custom block specs with props; change events report insert/delete/update/move; before-change callback can cancel transactions | Closest starting UX; custom task/material/page-link blocks still ours. Must prove intent classification, history and theme control. Client-only editor initialization | First experiment |
| Tiptap | Headless editor, custom nodes, drag-handle extension, transaction events and React SSR guidance | Most control of document schema and transaction interpretation; more work assembling slash menu, block affordances and accessible mobile UI | Fallback when BlockNote needs internal hacks |
| Lexical | Immutable editor-state/node tree, React bindings, extensible custom nodes | Strong foundation; assembling block UI, drag handles and slash behavior adds work here. No evidence of a benefit worth switching to a lower-level model today | Keep as alternative; no parallel implementation |

Sources: [BlockNote introduction](https://www.blocknotejs.org/docs), [custom blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks), [change events](https://www.blocknotejs.org/docs/reference/editor/events), [side menu](https://www.blocknotejs.org/docs/react/components/side-menu); [Tiptap overview](https://tiptap.dev/docs/editor/getting-started/overview), [custom nodes](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node), [drag handle](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle), [events](https://tiptap.dev/docs/editor/api/events); [Lexical introduction](https://lexical.dev/docs/intro), [nodes](https://lexical.dev/docs/concepts/nodes).

BlockNote's published pricing says core is MPL-2.0 and usable without a subscription; XL packages have separate GPL/commercial terms. No need for its AI, multicolumn layout or exporters in this scope. Check exact selected package licenses when locking dependencies; do not assume all examples are community features. Tiptap documents MIT open-source core and separate Pro extensions. No paid package is recommended. [BlockNote licensing](https://www.blocknotejs.org/pricing), [Tiptap licensing overview](https://tiptap.dev/docs/editor/getting-started/overview).

Both editors need a deliberate SSR boundary. BlockNote documents client-only rendering; Tiptap documents `immediatelyRender: false`. In TanStack Start, lazy-load the editor after mount while SSR renders the read-only document shell. These are integration proposals; the Next.js examples are not proof of Start compatibility. [BlockNote SSR guidance](https://www.blocknotejs.org/docs/getting-started/nextjs), [Tiptap React SSR](https://tiptap.dev/docs/editor/getting-started/install/react).

## Map current models without losing commitments

Current evidence: `src/domain/types.ts`, `workspace.ts` (`place`, `remove-blocks`, `edit-block`, `keep-block`), and `src/components/day-page.tsx`. Today uses separate section inputs/textareas with append-only entry fields; it is not a continuous block editor. `NoteBlock.text` cannot round-trip rich text, lists or nested blocks. `Placement` already survives deletion of presentation. Task title edits are shared by Task identity.

| Existing object | Proposed representation and ownership |
| --- | --- |
| Page | Stable page ID, kind daily/document, date on daily pages; document payload with schema version. Page service owns identity and metadata |
| Section | Stable section ID and immutable semantic kind, editable title/order. Editor displays heading boundaries; renaming a heading never changes its kind. No inference from title text |
| NoteBlock | Stable presentation ID mapped to editor block ID; retain provenance. Add structured rich content rather than flattening to text; derive plain text for AI/export. New copies receive new block IDs |
| Task | Domain entity; custom task block stores `taskId`, presentation ID and explicit role `plan`/`reference`. Status/dates are projected live, not independently editable JSON fields |
| Placement | Domain entity per task/day; add persistent order for Top3/Other. Editor movement sends an explicit reorder/move-plan command. Deleting editor JSON never directly deletes Placement |
| Event / URL page / reference | Typed entity-reference blocks, not copied entity facts. The editor resolves the target and can display a missing/deleted target |

Prefer one continuous document, not one editor per section: separate editors break cross-section selection and drag. Start with non-nested section boundaries and custom entity rows; page nesting lives elsewhere. Validate whether free BlockNote custom blocks can express the chosen section boundary adequately. If it needs XL layout blocks or brittle tree rules, do not silently introduce them: use a simpler flat-heading adapter or evaluate Tiptap.

The server must validate entity IDs, block uniqueness, schema and allowed semantic changes. One editor transaction maps to one atomic page-edit command with optional domain effects, operation ID, expected page/workspace version and a receipt. Do not send one global Workspace mutation per keystroke: coalesce text changes, keep an unsaved indicator, flush before navigation, and retain a recoverable local buffer on failure. Never replace the editor document on every response, which can destroy selection/IME composition. Whole-workspace CAS is acceptable for the current demo but a poor long-term typing boundary; use page version plus affected Task/Placement versions for the real repository.

## Deletion, movement, copy and undo contract

This section follows Lead 8b8a4a7c and Bumblebee's corrected 485dd1d3; her earlier proposal to pause on any removal was withdrawn.

| Gesture | Document effect | Commitment effect |
| --- | --- | --- |
| Unambiguously select/delete one complete plan block on today's page | Remove that presentation | Not today + conditional Undo + Keep planned, as A19 |
| Delete text within title / join paragraphs / unclear selection | Edit content, or intercept invalid empty task title | No implicit pause; show explicit Not today if the task row should be removed |
| Bulk delete, including exactly one plan block plus prose | Remove selected presentations | Preserve Placement; show Planned · not in note |
| Cut a plan row; drag it outside plan sections | Remove/move presentation, output ordinary reference outside plan | Preserve Placement; no clipboard-based undo inference |
| Reorder inside a plan section | Reorder stable IDs | Same identity and commitment; update order only |
| Move between Other and Top3 | Move arrangement row | Explicit section/order change, preserve dates/status |
| Paste task elsewhere | New presentation/reference ID for same Task | No new Task or Placement; foreign/untrusted identity payload becomes plain text/link unless resolved and validated |
| Delete historical row / ordinary task reference / section heading | Presentation-only operation | No pause; removing a section must not silently reclassify its tasks |

BlockNote's documented events distinguish changed blocks and their sources, but **do not prove that an arbitrary one-block deletion means a deliberate single-row delete**. Cut of one block, selection crossing a heading, paste replacement, IME and programmatic replacement can yield superficially similar diffs. Need pre-edit selection + gesture intent + transaction identity. A task row may use atomic custom rendering with a title edit mode, but custom-block support alone does not prove correct Backspace or mobile selection behavior. Treat those as experiment gates, not verified capabilities.

Use one history authority for document plus domain effects. Editor-native undo cannot restore only text after Not today has persisted. Intercept semantic transactions and route their inverse through checked domain commands; group typing separately. If a remote change invalidates undo, keep the current document, show that undo cannot be applied and reload/offer explicit recovery. Never replay an entire Workspace snapshot over newer edits. The current one-command undo snapshot is a prototype, not the editor's final history design.

## Independent pages, nesting and URL capture

Brian explicitly requested this (3596b765); it is not an inference from visual similarity. The following is a proposed v0.4 model for Bumblebee to review, not an implementation authorization.

- `Page`: id, kind, title, parentPageId nullable, siblingOrder, optional date, properties including sourceUrl, version, deletedAt, document schema/content. A page has one owning parent but can have many references. Daily pages remain addressable by date regardless of tree placement; prohibit duplicate active daily pages per workspace/date.
- Parent moves must reject self-parenting and cycles transactionally, including concurrent moves. No product depth cap; use iterative traversal, lazy tree loading and cycle protection rather than loading unlimited descendants in one request. Page nesting does not automatically expose every descendant to an AI request.
- `PageReference`: sourcePageId, sourceBlockId, targetPageId, relation kind and optional annotation. The visible link in today's thread is an ordinary forward reference. Reverse links are computed/indexed from these facts; show the referencing daily dates. Moving a page does not change references because IDs are stable. Link is not another parent.
- A URL save resolves/creates a Page with `sourceUrl`, initial empty body, title fallback from URL, and adds the reference at the paste/capture location. No fetch occurs; user can edit/paste content manually. Opening an existing URL page must still add the current-day reference rather than merely navigate away. All create/find/reference steps are one idempotent transaction.
- Default URL identity for first migration: trim surrounding whitespace and parse HTTP(S); preserve query and fragment semantics unless an explicit normalization rule is accepted. Do not remove tracking parameters, collapse paths or fetch redirects speculatively. Store raw URL plus canonical dedup key; server uniqueness handles concurrent duplicate saves. Final normalization details must match pages-delta.
- Existing Material becomes a URL-bearing Page plus a `SavedPageReview` record keyed by page ID. Migrate reviewState/nextReviewOn/resurface/decisions/task conversion and independent annotations; do not turn every URL in arbitrary prose into a saved page without an accepted paste rule. Existing page IDs and material IDs need an explicit one-to-one migration map, not title/URL guessing.
- Preserve Done/watch/lower/skip and same-URL reuse semantics while changing their identity key. Backlinks alone do not reset review. Making a task from a saved page creates the same one unscheduled Task and a provenance link; it does not add a plan row.
- Soft-delete pages first. Existing links show a tombstone with restore/open-state recovery; do not silently cascade-delete Tasks or daily commitments. Propose restoring the existing URL page on re-save (retain history) rather than creating another identity, subject to Product review. Subtree deletion should be explicit and previewed; first release can refuse deleting a non-empty parent and require moving children first.

Migration: back up the local file; build a pure versioned converter with ID map, validate orphan/cycle/duplicate URL cases, preserve block IDs/provenance and all Placement records, then atomically swap after counts/invariants pass. Keep a read-only legacy renderer and original backup for rollback; never dual-write two authoritative document formats. Future Supabase tables need their own migration/RLS review; none is created here.

## Smallest next validation and work sequence

**Now, 0 editor code:** Jazz's day-page visual direction; this report; Bumblebee pages-delta. No visual approval is implied by this report.

**Editor experiment, 1–2 engineer-days after authorization:** isolated branch and disposable data; pin candidate versions. Build exactly one document with section headings, one plan Task, one ordinary Task reference and one URL-page link. Test client-only Start hydration, inline Chinese composition, Return/Backspace, slash insertion, cross-section selection, cut/paste, drag within/outside Top3, duplicate paste IDs, and combined undo. Record actual events and selection snapshots. Test desktop keyboard and 390px Chromium; real Safari/iPhone remains a separate device requirement.

**Stop/go:** zero accidental pauses under bulk/cut/drag; unambiguous single-row delete matches A19; atomic undo restores both text and Placement; task IDs never duplicate; edit/save/reload round-trips structure; conflict keeps unsaved buffer and requires explicit retry. If the A19 gesture fails, compare explicit Not today fallback with Tiptap before adopting either. No claim that BlockNote has passed these gates.

**Integration, 6–10 more engineer-days:** structured schema/converter and entity blocks (2–3), transaction adapter/history/conflict buffer (2–4), accessible menus/mobile/styling plus regressions (2–3). Range includes re-running the existing 35 tests and semantic browser scenarios, not merely checking that the editor mounts.

**Pages, +4–7 engineer-days with overlap:** page tree/URL identity/reference APIs and migration (2–3), nested navigation/empty URL page/properties/backlink UI (1–2), movement/deletion/concurrent duplicate and regression checks (1–2). Do not enable arbitrary descendant inclusion in AI or automatic fetch as an incidental editor feature.

Open decisions for Lead/Product: exact URL-paste trigger (standalone paste/capture versus any inline URL), restored deleted URL-page behavior, parent deletion policy, and A19 fallback if selection intent cannot be proven. Recommended defaults above allow progress without treating the current prototype as accepted by Brian.
