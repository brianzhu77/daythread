# Independent PR134 review

Candidate cdd82377. Changes requested: Load latest can discard a newly chosen image when the block changed type.

## Confirmed defect

1. Save an empty paragraph, so it exists in the tab's starting document.
2. On that paragraph, use `/image` and choose a photo. Hold that tab's save.
3. Another writer changes a different line on the same page.
4. Release the image tab's save; it correctly shows the conflict notice. Choose Load latest.

Actual: the other writer's text remains, but the image becomes an empty paragraph. The saved document has no visible image. Independently reproduced in Chromium using actual menu/upload and a domain-command writer for the competing edit, with an invented SQLite workspace.

The isolated `merge-type.ts` fixture demonstrates the cause: the file-block merge branch copies `now.props` but not the changed type/content. A latest paragraph therefore stays a paragraph with ignored image URL props. The ordinary app serialization then drops those unknown props. Tests for only an existing image's changed caption/URL do not cover this transition.

Evidence: `tests/evidence/ratchet-body-files/merge-type.ts`, `merge-type.log`, `edit.ts`, `merge-type.mjs`, and `merge-browser.log`. The browser fixture uses its separate store `/tmp/ratchet134-race.sqlite` and server on port 3700; the standard script uses port 3699 and a different store.

Build and body-files domain tests passed independently. Full standard browser scripts are running; results will be appended. No production writes, actual R2 bucket, physical device, Take Photo or cross-app native clipboard test performed by this reviewer.
