# Native Pinyin reproduction

Main b162655 reproduces in Mobile Safari, iPhone 17 simulator / iOS 26.4. XCUITest via Appium 3 and xcuitest 12.20.0 runs without the host Accessibility or Screen Recording grant. Only a disposable copy of workspace revision 362 was used.

Focus the end of a nested bullet, tap the software Return key, then software w, a, n, and the first native candidate 万. A clean repeat reproduces: the new bullet ID 03ed7a38-e5f7-4bdc-87aa-49656573d562 is replaced by paragraph 8a426f7b-9ec1-4c0b-a52c-76b74cd233c3 containing 万 and two breaks. Candidate selection emits no Enter. The decisive sequence is insertCompositionText(万), deleteCompositionText (original block removed, replacement created), insertFromComposition(万), compositionend. This is actual OS composition, not dispatched synthetic events.

Evidence: tests/evidence/ratchet-b49/main-native-trace.json. Includes the recorder events and the affected block only. The first exploratory run also reproduced but initially typed English before switching the keyboard; the committed trace is the clean repeat after switching to Simplified Pinyin.

## Repeating

Start an isolated build/store and an Appium Safari session with connectHardwareKeyboard=false and forceSimulatorSoftwareKeyboardPresence=true. Install Simplified Pinyin on that simulator, switch via Next keyboard, and dismiss any keyboard tutorial. Set APPIUM_SESSION_ID, WEBVIEW_CONTEXT, optionally APPIUM_URL and TEST_URL, then run native-repeat.py. It focuses the existing “万圣节装饰、衣服” fixture, taps native software keys and first candidate, and writes /tmp/b49-native-result.json. No sendKeys or synthetic composition is used.

This establishes the failing baseline. A fix has not yet been reviewed. Real hardware, Home Screen app and third-party keyboards remain unverified.

## B48 native keyboard placement

On main b162655 (B48 live code), three native tap/focus → Hide keyboard → tap/focus cycles pass in Mobile Safari. Each cycle shows a real software keyboard and visible editor toolbar, 351 × 50 CSS px, viewport rectangle y318–368 with visual viewport height376 and offsetTop58. Native accessibility places Indent/Hide keyboard at y383–427, visible and above Safari's bottom controls and the keyboard (key area starts y583, candidate area above it). The toolbar clears the visible content edge by 8 px; it is not obscured by the keyboard. Some coordinate taps during Safari scroll settling did not focus the editor, so the driver retries a tap; no focus cycle is counted until the real keyboard and toolbar are both present. The measurements are not evidence that every first coordinate tap focuses.

Evidence: native-toolbar-cycles.json / native-toolbar-cycles.py. This verifies Mobile Safari on the simulator only; Home Screen installation and third-party keyboards remain unverified.
