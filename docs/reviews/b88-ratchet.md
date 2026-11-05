# B88 independent review and native-key investigation

Candidate e1b9a9ea: changes requested. This head leaves a data-loss path on opening.

Create a page with an empty paragraph immediately above its last database block, and give that database a row. Open at 1280 without clicking, then press Delete. Chromium and WebKit both focus the empty paragraph and move the database and row to Trash. Own blank.ts/blank.mjs and logs reproduce this through repository commands and real browser key input. The target expression finds any empty line in firstSection before considering the non-text end. The original fix's nonempty-line fixtures miss it.

The Lead accepted a combined B88/B89 key rule after this finding (98fb79c1): a key on a line must not remove the adjacent content block; empty lines can go, held keys stop at the block, and explicit handle selection remains the way to remove a block. No author repair is in this review branch.

## Mobile Safari Backspace: not run

Own Ratchet-B4 iOS26.4 Simulator, Appium/XCUITest nativeWebTap, built e1b9a9ea and invented store. Before making any claim about navigation, a temporary DOM input was tapped natively, set to AB, and a native XCTest `mobile: keys` XCUIKeyboardKeyDelete was sent to the app. It returned success but left AB intact, with the input active and caret at 2. Repeated with connectHardwareKeyboard true and forced software keyboard off: same failed calibration. Therefore the intended outside-field key checks were not reached, and no conclusion about Safari Backspace navigation is supported. This is a rig limitation, not evidence that Safari ignores Backspace.

Build passed. No full unit repeat or Worker run. Native actual hardware key, Mac Safari, physical iPhone and Home Screen app were not verified. The Lead explicitly accepted listing this as not run if the Simulator cannot deliver it.
