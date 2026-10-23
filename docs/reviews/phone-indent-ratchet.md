# B5 phone indent/outdent — task163

**PASS at a30d3f7** (0dae5c1 plus desktop Tab guard). Independent review by Ratchet, synthetic isolated SQLite only. No application fixes, real data writes, deployment or model calls.

Executed: author's current phone-indent-check at390 touch in Chromium and WebKit, including saved indent/outdent, Undo/Redo, caret/toolbar retained, section-start/heading disabled, and desktop section-start Tab no-op. Both pass. Reviewer-authored independent checks additionally read actual persisted task ids and status: mark the child done, reload, indent/outdent from phone toolbar, reload, same task id and done state remain; no new task. At1280, type a task into Top3's first row, Tab, save: actual section still contains that task and its row has not become a heading's child. Heading Tab keeps focus in editor. Both engines pass, no page errors.

Initial independent script tried using a locator immediately after a status transition; it timed out during that transition. Explicit reload after verifying the status gave stable fixture state before nesting. Those discarded probes are not reported as app defects or passes.

Source: phone buttons prevent pointerdown and mousedown to retain selection; shared canIndent guards ordinary desktop Tab as well as disabled phone button. Shift+Tab and normal permitted nesting remain unchanged. CSS delta only toolbar separators/order. Author reports318/0/0 alignment; reviewer did not rerun that full gate, Lead owns final alignment.

Independent typecheck/build pass; full suite370 pass,0 fail,11 skipped,4 TODO (385 total). Scripts and compact output are tests/evidence/ratchet-phone-163/. Seed refuses existing paths. Author smoke creates its own task rows; independent script requires that fixture and checks actual repository state.

Real iOS keyboard/Pinyin, keyboard-up toolbar positioning and real touch hit rates remain unverified under task155 (Mac native-control grant pending); Playwright WebKit with touch is not a Simulator or physical iPhone test. No new real-iPhone claim should be made.
