# Model v2 basics — independent acceptance

Reviewed current main **502e550**, 2026-10-29, task #229. Only isolated SQLite databases with invented content were edited. No production, preview, Brian or invitee rows were read or written for this task. No application changes.

## Desktop results

Chromium, 1280 × 900. The v1 fixture's sections/editorJSON queries are obsolete; the replacement checks use Page documents and Task identities. Scripts and recorded results are in `tests/evidence/ratchet-basics-v2/`.

| Check | Result |
|---|---|
| Morning carry parent and nested child into today, once, preserving identity/nesting (B34) | PASS |
| Continuous prose including Chinese Unicode, save and reload | PASS; keyboard Unicode injection here, native IME checked separately below |
| Tab nests a child and persists its document tree | PASS |
| Tick a task and retain its identity/status | PASS |
| Delete selected prose, Undo once | PASS |
| Cut/paste prose, persist one copy | PASS |
| Backspace at task-title start removes checkbox/task; Undo same id and status (B42) | PASS in paced clean replay; separate five isolated task conversions/Undo also pass |
| Clear fresh task then delete blank row; task removed, Undo same identity (B33) | PASS |
| Abort actual save POST, retain local words, reconnect retry, reload | PASS |
| Copy stable line URL, paste inline reference, reload and jump to original line (A11) | PASS |
| Cut/paste whole completed task | PASS, one task identity and done status |
| Rename section heading | PASS, content retained |
| Delete heading section including prose/task; Undo | PASS, task restored once |
| Pointer-drag bottom section to top through long page | PASS, whole section moves, task identity retained |
| `/page` creates child/card, name, reopen and reload | PASS |
| Two closed tabs' failed saves recover both drafts once (B35) | PASS |
| Frozen tab resumes after another tab recovers its draft (B35) | PASS, no duplicate |
| Unhandled browser page errors in primary replay | None |

The primary replay, extra checks, section checks, create-page check and two-tab checks contain **18 assertion groups, all passing**. The separate five-case B42 test supplements these. Typecheck passes; unit tests: **146 pass, 0 fail, 3 skipped** (credential-dependent). Build passes.

### Harness corrections and limitations

Initial runs are retained as evidence, not silently omitted. A11 initially expected a URL change for an in-page jump; current behavior intentionally jumps and tints without navigation, so the corrected assertion checks the target tint. The create-page title is contenteditable, not an input. Initial rapid caret/key sequences sometimes missed a conversion; the clean replay uses 180 ms after caret movement/Enter, and a separate five-case check uses 200 ms. Reused task IDs across two diagnostic pages correctly kept shared tasks; the final five-case test uses isolated identities. No reproducible product failure remains established by these experiments. Very rapid caret-move/Backspace timing remains a narrower unproven risk, not a verified defect.

This is an adapted current-model replay, not a claim that the obsolete v1 script ran unchanged. Generic external bookmark metadata and every legacy Top 3/review action are not covered; those removed workflows are not current-model acceptance requirements. Cross-device authenticated reconciliation is outside this SQLite-only task.

## Native iOS results

Real Mobile Safari in **iOS 26.4 Simulator**, Ratchet-B49, XCUITest/WebDriverAgent/Appium. Real soft-key taps and real Pinyin candidate taps; JavaScript only positions/reads the caret and records events, never injects Chinese text or composition events.

| Check | Result |
|---|---|
| Existing empty bullet: `wan` → 万, then `he` → 和 | PASS, text 万和 remains on original line/caret identity |
| Native Return creates a new bullet, `wan` → 万 | PASS, candidate stays on the new bullet's identity |
| Empty task: `wan` → 万 | PASS, original task/caret identity retained |
| Editor background mid-word `hao`, return to Safari | PASS, same line/caret and exact 万和hao text retained |
| Tomorrow candidate 万, then tap heading without Return (B68) | PASS, input clears, one Tomorrow row; native composition/input/blur sequence captured |
| Tomorrow tap-away while `he` is still composing | PASS, `he` stays draft, no partial task added |
| Tomorrow confirmed Chinese draft, swipe Safari out, reopen | PASS, native app state 1 (not running), new WebView process, 万万万 restored in input, no added task |
| Tomorrow mid-Pinyin draft, swipe Safari out, reopen | PASS, native app state 1, exact mixed draft he万万万 restored, rows unchanged |
| Empty unticked task, dark mode | Outlined in native screenshot; sent to Jazz, not a release gate |

Physical iPhone, third-party keyboards and standalone Home Screen mode are not claimed. SQLite-local identity is used; account switching was covered by task #228 and is not re-proven here.

Initial switcher gestures did not actually terminate Safari (native state 3); those were rejected as termination evidence. The accepted gesture uses `mobile: dragFromToWithVelocity`, checks native state 1 before relaunch, and checks the restored input/rows. Screenshots and JSON are retained.

## Verdict

**PASS for the scoped model-v2 basics and Simulator Pinyin checks.** No confirmed application failure to send as a fix. Remaining limits: physical hardware, standalone Home Screen mode, third-party keyboards, authenticated cross-device behavior, and the rapid zero-delay synthetic key sequence described above. These are not claimed as passed.
