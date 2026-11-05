# Independent PR139 review with body files

PR139 3c4443d7 merged locally with cleared PR134 921c6d4c. No application changes by reviewer.

Cleared this combined change. Build passes. All 33 author chosen-outline checks pass independently in Chromium and WebKit: handle selection draws, moving/cancelling selection clears it, several blocks tint as a run, table Esc selects and Backspace removes, narrow opening remains unchosen.

Additional independent browser test pastes a real PNG and a file, selects each by its handle, checks that the overlay is drawn with an outline and pointer-events none, presses Backspace and verifies removal, then uses one Undo to restore the same file address. Both engines pass on the combined build.

No new full 134-case opening rerun, Worker/Postgres, physical device or native selection test. The recent PR131 boundary suite was independently cleared separately; this patch changes selected-state drawing only.
