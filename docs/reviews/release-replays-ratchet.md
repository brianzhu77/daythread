# Independent post-release replay review

Tree b8835f1b, the deployed merged tree containing PR118, PR125 and PR117. Invented SQLite stores only. Build passed; 26 move-row and repeat unit tests passed.

## PR118 cycle repair

Independently replayed the original command reproduction: moving Root into a database inside its sub-item refuses with `That database is inside this row` and leaves the entire workspace unchanged. The original browser fixture now omits Nested from the destination picker in Chromium and WebKit, with no cycle or page error. Prior own depth-50, Trash, target sub-items on/off, exact 10,000-row Undo, 10,001-row atomic refusal and stale-child atomic refusal scripts pass. This supports the Lead's replay conclusion.

## PR125 header focus and property-add Undo

Read the focus changes and reran column-heads.mjs in both engines. The new cases cover add/insert notices and Undo, focus returning to the header, Cmd+Z reaching the change, clicking outside preserving that target's focus, and hiding the focused column returning focus to Name. Both pass. The broader column resize/reorder tests in that script also pass.

## PR117 repeating row templates

Read the period calculation, stable date-based row ids, workspace run-repeats command and browser wake/idle/visibility path. The timer deliberately waits two idle minutes after opening and skips a background tab. Another visible window taking Undo remains the documented accepted limitation; this review does not claim otherwise.

Browser results follow in the accompanying logs. No native phone, Worker, real Postgres, deployed memory/performance or two physical devices were exercised in this replay.

Repeats browser replay completed successfully in Chromium and WebKit: due-on-open, two tabs making one row, latest-only catch-up and skip notice, every missed period, pause/resume, empty interval editing, deleted rows staying deleted, weekday changes, phone-width day buttons, a moved clock crossing due time while active then idle, Undo retained while active, and a background tab doing nothing until visible. Visibility and time are controlled by the script; this is not a physical device or two visible native windows.

Conclusion: no blocking finding in these post-release checks. PR118's original cycle finding is cleared independently on this tree; PR125 and PR117 replays pass within the stated coverage. The accepted cross-window Undo and unrun native/Worker limits remain.
