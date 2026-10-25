# Independent B27 native evidence

Ratchet, task #219. iPhone17 / iOS26.4 Simulator, own Ratchet-B49 device, native XCUITest/Appium keyboard taps and candidates. Build app tree 6a20bd3, built preview port3648, isolated SQLite /tmp/ratchet219-native.sqlite. Home icon Ratchet B27 installed from this root; navigator.standalone is true in its snapshots and false in Safari's.

JSON files record the visible text, menu, chips, URL, standalone flag and viewport after each action. Selected PNGs show the actual keyboard/UI. The native Chinese keyboard's symbol key emits half-width @; no claim is made that it emits full-width ＠. Full-width trigger is covered by the earlier browser check.

Scripts are staged local evidence, not a portable CI runner. check.py imports the existing local /tmp/sweep-ios/driver.py (Appium4727, WDA8107), which reads the current session file. The context file chooses Safari or Home; actual run used WEBVIEW_14248.1 / WEBVIEW_21476.1. Do not replay against shared or live data. Focus and keyboard mode are prerequisites; scripts record the executed stages rather than creating the whole Simulator.

Both final native history probes give: chip -> 开会@明天 -> unchanged -> 开会@ -> 开会 -> empty. The line probe IDs are read by the scripts, so earlier fixture lines are not mistaken for leftovers from the tested history. The fixture retains earlier 1a501fb probe lines and excluded failed bulk-key input; these are disposable test content, not defects observed on the final probe.

Native bulk mobile:keys input dropped some characters and was replaced with individual software-key taps for the final English Home test. Automatic capitalization made Dentist uppercase; the initial lowercase assertion was a harness mismatch. Its recorded actual chip/Undo is correct, and continuation verified Redo, keyboard-down strip and the row. iPhone Escape did not dismiss the list and is excluded. desktop-escape.log comes from WebKit1280 with a composition replay and real Playwright keyboard Escape; it preserves the stored Kept words prefix through all three Undos.
