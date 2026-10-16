# First-slice domain checks

Owner: Ratchet, task #21. Expected outcomes come from specs-v0.3/04-acceptance.md, not from implementation output. Run with Node 24's native test runner; no browser, cloud project, credentials or model call is needed.

| Suite | Independent case | Acceptance |
| --- | --- | --- |
| identity and scheduling | Keep uses the original Task ID; rescheduling does not change deadline; excluded day does not block a new explicit plan | A09/A10/A15/A21/A32 |
| set aside | Not today pauses carry, clears only the matching planned day, preserves deadline/attention; old historical presentation removal changes no Task | A11/A12/A16/A19/A20 |
| carry and hand-off | 5 yesterday tasks are not capped; older suggestions capped at3; undated/overflow stay findable; done/paused/future plans excluded; partial/skip changes only explicit choices | A13/A14/A23/A24/A32/A33 |
| Bring to today | text copied once with provenance; existing material reused; Task identity reused; a replay differs from a new deliberate copy | A39/P14 |
| capture transaction | mixed proposal creates nothing before Apply; Discard changes nothing; Apply and replay commit once; stale input/entity prevents the entire operation set | A30/A31/X03/X05/X06/X16 |
| material | task link is not a material item; bare URL/save/Good Stuffs is material; same exact URL reuses identity without overwriting notes; recommendation opt-out preserves the item | A06/P14–P18 |
| budget | shared reservation before calls; exhausted/unknown prices deny send; unsettled timeout retains reservation; cross-midnight keeps original day; completed replay does not reserve again | X23/X24/X26 |

The implementation adapter determines which cases can run tonight. An omitted API or unimplemented behavior is reported as unverified, never replaced with a passing mirror implementation. Test failures are reported to Wheeljack; this branch does not edit src/domain.

These tests can establish local domain behavior only. Database transactions/RLS, actual provider accounting, model meaning, iPhone editing, reminder delivery and application end-to-end behavior need separate evidence.

## Initial executable baseline (4253b8f)

Run with `node --test tests/*.test.ts` on Node 24.14.1. Sixteen assertions/cases currently yield 1 pass and 15 failures because the implementation explicitly throws `in progress`. The invalid-budget case passes merely because all inputs throw; it is not evidence of working validation. Re-run after the implementation lands. No assertions have been skipped to make the baseline green.

## Independent run against implementation 0f352f5

`node --test tests/*.test.ts`: 29 cases, 28 pass, 1 fails. Good Stuffs G01–G07 state behavior and mixed Capture stale-version/group confirmation cases were added; visual counts/phone fit and actual provider failure remain unverified.

Confirmed regression: yesterday's five included commitments disappear from `handoffTasks` after presentation-only bulk deletion (expected 5, actual 0). `getDayView` builds `previousIds` from note blocks, so these records instead enter the older carry list, capped at 3. This contradicts the presentation-only deletion invariant and uncapped previous-day handoff. Use included placement/date identity for handoff membership; keep note-block extraction for prose Bring only. The final test in domain.test.ts is the reproduction. No author code modified by the reviewer.
