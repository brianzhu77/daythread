# Independent A11 step-2 review preparation

Basis: accepted plan 8b808a5 §8; Jazz `line-links-states.md` 057488b §7. Own synthetic fixture and browser assertions, prepared before author step-2 handoff. **No step-2 browser PASS is claimed.** Seed ran successfully against 04990a7 (revision 11); script syntax checked. Final selectors and exact bar/fade geometry must be calibrated against candidate DOM/CSS before execution; a missing chip is a failure, not a skipped assertion.

Run `node tests/evidence/ratchet-a11-step2/seed.ts NEW.sqlite NEW-manifest.json`. It refuses existing paths and never reads real data. Serve that SQLite on an isolated loopback candidate server with model simulated/auth off, then run `node tests/evidence/ratchet-a11-step2/critical-check.mjs http://127.0.0.1:PORT NEW-manifest.json OUTPUT`. The browser checker refuses non-loopback hosts; it does not mutate the workspace. If auth is intentionally on, provide a disposable account's preexisting storage-state file via A11_AUTH_STATE; never copy production cookies.

The fixture has a linked task's original history row still on yesterday, its destination row today, a long ordinary target with enough space above/below for a one-third jump, and a trashed linked page. URL cases each use a fresh browser context, with and without task=. Browser output includes JSON and jump screenshots at 1280, 390 and 390 touch. Nothing in this preparation replaces real-copy size, final auth, alignment or rollback gates.

## Named §8 execution ledger (all pending candidate)

| ui-check name | Independent assertion / evidence to collect |
| --- | --- |
| copy: three entry points | Row menu via Cmd+/, task ⋯, single-row selection toolbar; inspect clipboard MIME + URL, ref ids after paste/reload. No app command substituted for the UI action. |
| copy: clipboard fails | Override clipboard write to reject in isolated context; Couldn't copy visible, copied notice absent, no persisted change. |
| paste: line type / own URL / foreign URL | Real clipboard/paste events; own MIME + URL create one inline chip; foreign host, extra/unknown params and malformed URLs never create chips/cards. Include URL encoding. |
| paste: into a task title | Words pasted as text; no pageRef in saved editor document. |
| chip and jump | critical-check: visible-area third, delayed 450ms read includes 350ms drift correction, no input/editor focus, keyboard Enter and Back. Add same-page second activation/tint evidence; compare before and after delayed layout. |
| chip: Line not found | Delete source through UI, reload linking page; exact missing text, original-page top + notice on tap. |
| chip: cut and paste | Plain-line cut to same/different page gives fresh id and missing chip after reload; task plan move follows task. Inspect ids. |
| URL: fresh view | critical-check: separate contexts for original past-day URL with/without task=; assert destination day and exact task block, then reload. Original history row remains. Add ordinary/custom heading URL. |
| Linked from | Page+line references from same source counted once; move task to new day, old page loses backlink/new page gains it with original ref.at, not move/save revision. Verify after reload and SQLite read. |
| long excerpt at 390 | critical-check: no document horizontal overflow, chip within viewport and one line. Add excerpt ellipsis and where-label priority measured against actual candidate styles. |
| drag keeps the link | Real drag within page; same source id, chip still current words after reload. |
| chip: trashed page | critical-check: words and semantic trash marker, tap opens exact trashed page with Restore, persists on reload. Add SVG bin icon and computed --ink-3 comparison; don't infer these from text alone. |
| copy: not offered | Empty paragraph, template heading, page/link card, two-row selection; menu action absent. Custom heading remains offered. |
| edit and task move | Real source edit and plan move; linking-page reload displays new words/new destination. Retain taskId; completion/reopen/cancel use step-1 storage checks. |

Geometry gate: candidate `scripts/check-alignment.mjs` must require “line link” and find it on 2026-12-31 at both widths, zero missing/fails. Critical checker does not claim baseline alignment. Read current top bar/fade CSS and replace preliminary geometry selector allowlist if necessary; photograph the measured target. Also execute stable-check, actions-check and caret suites on final candidate. Check Tags jump because step 2 intentionally changes it to match line-link jumps.
