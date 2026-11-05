# Independent PR134 review

Initial candidate cdd82377 had a confirmed Load latest defect. It is fixed and independently retested on 921c6d4c; see the fix retest below.

## Confirmed defect

1. Save an empty paragraph, so it exists in the tab's starting document.
2. On that paragraph, use `/image` and choose a photo. Hold that tab's save.
3. Another writer changes a different line on the same page.
4. Release the image tab's save; it correctly shows the conflict notice. Choose Load latest.

Actual: the other writer's text remains, but the image becomes an empty paragraph. The saved document has no visible image. Independently reproduced in Chromium using actual menu/upload and a domain-command writer for the competing edit, with an invented SQLite workspace.

The isolated `merge-type.ts` fixture demonstrates the cause: the file-block merge branch copies `now.props` but not the changed type/content. A latest paragraph therefore stays a paragraph with ignored image URL props. The ordinary app serialization then drops those unknown props. Tests for only an existing image's changed caption/URL do not cover this transition.

Evidence: `tests/evidence/ratchet-body-files/merge-type.ts`, `merge-type.log`, `edit.ts`, `merge-type.mjs`, and `merge-browser.log`. The browser fixture uses its separate store `/tmp/ratchet134-race.sqlite` and server on port 3700; the standard script uses port 3699 and a different store.

Build and body-files domain tests passed independently. The full Chromium baseline passed all 47 scenarios. No production writes, actual R2 bucket, physical device, Take Photo or cross-app native clipboard test performed by this reviewer.

## Fix retest

On 921c6d4c, the isolated fixture and body-file tests pass. The exact browser conflict flow now keeps both the remote words and the photo, independently in Chromium and WebKit, with assertions on the saved block kind and visible image. Fixed browser logs are named `merge-browser-fixed-*`.

The full Chromium standard run passed all 47 scenarios on cdd82377. Its WebKit baseline was interrupted after the initial scenarios so the final fix could be built; that partial log is explicitly labeled. A fresh complete WebKit run on the fixed build is completing; its result is recorded below. The only application change between those candidates is draft-merge.ts; remaining changes are its test and documentation.

## Final conclusion

Cleared the confirmed finding on 921c6d4c. All 46 full WebKit standard scenarios pass on that fixed build. Together with the 47-scenario Chromium baseline, independent exact conflict-flow retests in both engines, ten passing domain tests and the fixed build, no remaining confirmed blocker was found in this review. The explicit environment limits above remain.
