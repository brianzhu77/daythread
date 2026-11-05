# Independent PR131 combined B88/B89 retest

Candidate 7d86e095 (main 6bb70d5a). Cleared the reproduced boundary failure. Independently reran the full author opening/boundary script: 134 checks pass in each of Chromium and WebKit. Build passes. The original independent blank-above fixture also passes in both engines, with the paragraph restored before the WebKit run.

The previously confirmed blank paragraph immediately above the last database is the primary regression fixture. The accepted contract protects database/card/synced blocks from adjacent-line Backspace/Delete and incidental arrival; explicit handle or table Esc selection remains removable with Undo. Dividers remain unchanged.

Native Safari hardware Backspace remains unverified: the earlier XCUITest rig failed calibration (a known input containing AB did not delete B). This is not a native pass. No physical device or B87 image/file end-of-page test in this review.

## Simulator on-screen delete

On an isolated iPhone 17e iOS 26.4 Simulator in Safari at width 390, actual XCUITest taps on the visible accessibility `delete` key passed both Product-requested cases: at the start of a nonempty line directly below a linked database, no content changed; on an empty line below it, only the line was removed. The database remained live. Caret placement was scripted after native tapping into the editor. Calibration changed AB to A in a temporary input, and Below to Belo inside the editor. This proves the on-screen route, not a hardware Backspace or physical-device/Home Screen result. Event logs attached at window level were empty; no conclusion about which DOM event handled it is claimed.
