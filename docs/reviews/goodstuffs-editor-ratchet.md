# Good Stuffs editor regression — independent acceptance

**PASS on fix/goodstuffs-material 7f0de2d.** Source/scripts/dependency diff between reviewer checkout and candidate is empty. No production writes or production repair runs.

## Defects found and closed

- 8489d2d: a user explicitly selected Don't resurface, then appended prose to the source URL line. The saved Material disappeared. Independently reproduced; 5595bf5 preserves the Material, opt-out and identity, and stores the suffix as source note.
- 8489d2d: standalone titled rich link displayed Recipe but created zero Materials. Independently reproduced; 5595bf5 reads href and creates the item with the display title.
- 5595bf5: a seeded valid Material with independently changed title was re-keyed and retitled on source-line URL edit. This was a fixture scenario, **not** a currently available rename UI operation. 7f0de2d compares the previous line's derived title and preserves both user title and URL. The previous-version comparison is necessary to allow edits to an untouched link's display text.

Evidence: tests/evidence/goodstuffs-66/probe*.{mjs,log}, title-probe.mjs/title-probe.log/title-fixed.log. Initial failing logs are deliberate reproductions, not final pass output.

## Actual independent checks

- Original opt-out and titled-link reproductions rerun on 5595bf5: fixed.
- Independent domain script: half-typed URL completing to an already saved URL leaves one owner with both source block IDs; appended note preserves identity; old titled-link repair creates one correct item without changing page IDs; repeated repair refuses without modifying the complete input snapshot/revision.
- The half-typed collision exception is explicitly accepted by Lead46ed7054/Product874f7384: only an untouched typing snapshot may be removed in favor of the already saved owner. It is not permission to delete acted-on items.
- Chromium **390px, mobile/touch enabled**, isolated loopback3270 + synthetic /tmp/ratchet-gs66.sqlite: typed URL created one item; adding a note kept its ID; actual rich clipboard paste created Recipe with correct href. Aborting POST requests left the complete persisted workspace unchanged, Retry created exactly one final URL item, and refresh retained the same Materials without a save conflict. No page errors. This browser run was on 5595bf5; the final narrow title guard was independently rerun with the seeded title probe on 7f0de2d.
- Final suite with FUTURE_DAYS_CONTRACT=1: **106 tests, 102 pass, zero failures/skips, 4 TODO** (existing browser scaffold placeholders). Typecheck passed. Final build independently reported by Lead/author, not repeated by this reviewer. Domain suite includes exclusions for task rows, sentence links, non-Good-Stuffs, non-http(s), renamed Good Stuffs, repeated URLs, line deletion preserving Material, deterministic client/server projection and various touched-item states.

## Limits and remaining scope

This repairs the existing **Material** path; it does not implement URL→Page, page URL ownership/canonicalization or v0.4 link-page lifecycle. P16 Notes explicit Save remains absent and excluded by Lead7d66df64. No real iPhone/Safari or provider calls. No new performance claims.

Repair script: accepted no-op behavior is no persisted write; no-op is represented by a domain refusal. Lead6c941cdc/46ed7054 explicitly says **do not run the script on Brian's database for this release**, since it contains no relevant URLs. That restriction remains with the deploy owner. The script's generic error handler also prints other exceptions; such output must not be mistaken for successful repair.

Take this report/evidence files only; do not merge the whole reviewer branch. Lead owns deployment under Brian's standing auto-deploy authorization.
