# PR44 independent review

PASS b19b863, 2026-10-31, tested combined with accepted PR42 aca955b and PR43 547bedb. No source fixes by reviewer.

Code review: Bring retains same-name/Notes heading placement; only the missing-heading fallback joins the app group after contiguous real task rows and earlier brought rows. Fresh brought: IDs preserve group identification without reading words. Events prefer their Events heading; otherwise the widget follows that group, including a null afterId at the block-group start. Mid-section-only padding leaves the real Events-heading path unchanged. Widget labels remain display-only.

Independent invented fixtures through domain commands: Bring before carry, a second Bring, Undo/restoration and source-page immutability pass; carried row precedes both brought lines and original paragraph-labelled slots. A no-heading/no-task page places Bring first; built-in Bring uses Notes. Existing tests also exercise the opposite action order.

Production-bundle browser matrix: Chromium1280 and WebKit390, light and dark, four pages each (**16 groups**): custom heading with carry/brought/event group; no heading with brought/event group; built-in Events heading; no heading and no carry or Bring, with Events at the top. In every case the widget lands at the expected DOM position, before original paragraph prompts, without horizontal overflow or page errors. Screenshots inspected. Initial exact heading-text matcher failed on surrounding whitespace; trimming the captured text corrected the harness, with the failed run retained.

Additional edit replay in both engines: event-to-prompt gap19px WebKit /21px Chromium on this neutral fixture (no collision). Editing text below the top-of-page widget saves exactly the original two document blocks, preserves one displayed event and never serializes the Events decoration into the document. No page errors.

Combined verification: unit194 pass,0 fail,3 skipped; typecheck and production build pass; full alignment159 pass,0 fail,0 missing at1280/390 on invented full-coverage day fixtures. PR43's built-in before/after comparison remains valid; Events under its actual heading retain the same placement/classes with no added mid-section padding.

Evidence: tests/evidence/ratchet-bring-events/. No production reads/writes for this review. Physical iPhone, native keyboard and Worker transport remain unverified. All own servers stopped after review.
