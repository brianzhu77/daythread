# B40 browser checks

Run each against a build serving a fresh copy of a workspace that has a day page for 2026-10-22 with the lines
"PAC Lunch", "#daythread feedback" and "paste link to page is good" (Brian's row, revision 224). Use a fresh copy per
script: each one writes test text.

- `node tests/evidence/b40/b40.mjs <chromium|webkit> <width> <port>`: saves failing on Oct 22, then the line and the
  Calendar tab dot on Pages and Tasks, the offline wording, and a background save once back (no page opened).
- `node tests/evidence/b40/b40race.mjs <port> [B]`: (A) a closed tab's text saved by the tab left open, with the
  notice once on opening; (B) opening the page while its background save is on its way: "Opening your page…", one
  copy, no conflict.
- `node tests/evidence/b40/b40more.mjs <port>`: (C) another device changed the page while the draft waited: both
  lines once; (D) two tabs holding one closed tab's draft: saved once.
- `node tests/evidence/b40/b40refuse.mjs <port>`: a refused save (stale expected content): "Couldn't save … · open
  it" after the second refusal, the header stays quiet, and the line clears once saves go through.
