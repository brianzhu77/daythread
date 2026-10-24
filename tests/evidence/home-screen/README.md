# Home Screen app (standalone) on the iOS Simulator

Roadbuster, Oct 24, for Lead 7b430438. Brian mostly uses Daythread from his Home Screen. This checks that the
Simulator can run it that way and repeats the B48 (toolbar above the keyboard) and B49 (pinyin first candidate)
checks inside it. It is a test-only branch: no app code.

## Setup

- Own simulator `RB-HomeScreen` (iPhone 17, iOS 26.4), keyboards `zh_Hans-Pinyin` then `en_US` (set with
  `xcrun simctl spawn <udid> defaults write -g AppleKeyboards -array zh_Hans-Pinyin en_US`, then reboot).
- Own Appium 3.8 / xcuitest 12.20 on port 4737, WebDriverAgent on 8117 (Ratchet's install, separate ports and
  derived data), so it never touches the Safari sweep's simulator.
- Server: a fresh build of main cbdc182 on 127.0.0.1:3557, sign-in off, SQLite store made from a read-only copy of
  revision 362. Nothing touches his database.

## Adding it to the Home Screen (works without the Mac grant)

Safari → ⋯ → Share → View More → **Add to Home Screen**, "Open as Web App" on → Add (`add-to-home-screen.png`). The
icon goes on Home Screen page 2; tapping it opens Daythread full screen (`standalone-launch.png`).

- iOS runs it as `com.apple.webapp` (Appium `mobile: activeAppInfo`), with no Safari bar.
- The page reports `navigator.standalone === true`. (`display-mode: standalone` is false: we ship no manifest, only
  `apple-mobile-web-app-capable`.)
- Appium lists its web view (bundle `com.apple.SafariViewService`), so scripts run inside it as in Safari.

`relaunch.py` quits the app and opens it from its icon again; it prints the new web view id.

## B49 in the Home Screen app (`b49.py`)

Native taps only: tap at the end of a line, software Return, w a n, first candidate 万, then h e, 和.

- **Nested bullet under 明天 (`b49-nested.json`): passes.** The bug is present in standalone too: at
  `deleteCompositionText` WebKit drops the new bullet and a new block appears (t=27796, 24ee3ef4 removed, 55bb4780
  added); the B49 fix puts 万 back on 24ee3ef4 at compositionend (t=27805). Final: 24ee3ef4 bullet "万和", depth 1,
  no stray block.
- **New to-do after "TRV for Lu and Kathy" (`b49-todo.json`): passes.** In a to-do row iOS doesn't drop the block at
  all; 万 then 万和 stay on the new task d45124f9.

## B48 in the Home Screen app (`b48.py`)

Three cycles: tap into "万圣节装饰、衣服" (real software keyboard up), measure, then the toolbar's Hide keyboard.

- **First launch: 3 of 3 pass.** Toolbar buttons at y 415–459 pt, the keyboard below them (keys from y 583), every
  toolbar button visible, no overlap with the app's tab bar, `navigator.standalone` true.
- **After a relaunch: 3 of 3 pass on screen** (`b48-relaunch-cycle1.png`, `-cycle3.png`: the toolbar sits just above
  the keyboard's ⌃ ⌄ ✓ bar). The JSON says "not ok" only because after a relaunch iOS stopped exposing the keyboard's
  keys to WebDriverAgent, so the script couldn't read the keyboard's position; the screenshots are the evidence.
- Standalone differs from Safari in one way that matters for B48: with the keyboard up the layout viewport shrinks
  too (`innerHeight` 812 → 709–769), while `visualViewport.height` is 408. B48's rule (keyboard up when
  `innerHeight − visualViewport.height > 100`) still holds.

## Seen once, not reproduced

On the very first B48 cycle (right after the B49 run, `innerHeight` 715) the app's tab bar (Today / Tasks / … / +)
was drawn just above the editor toolbar, overlapping its top edge by a few points. Later cycles and a relaunch
didn't show it again; the screenshot was overwritten before I noticed. Worth watching in Brian's use.

## Limits

- After a relaunch, WebDriverAgent doesn't see the keyboard's keys, so typing must go through a fresh launch from
  Safari's flow or by tapping key coordinates. The first launch after Add to Home Screen exposes them.
- Simulator only: a physical iPhone and third-party keyboards remain unverified.
