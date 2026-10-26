# iPhone toolbar and pinyin: re-check on main, Oct 26

Brian's two iPhone notes of Oct 23 and 24 (B48: the phone toolbar behind the keyboard; B49: the first pinyin candidate
on a new line jumps down a line) were fixed on Oct 24 (main 6d5ee92 and 27ce607) and checked in the iOS Simulator and
the Home Screen app, never on his phone. Since then the model (shot 1), the storage (shot 2) and the whole surface
(one surface, design system v2) changed, so the question was whether the fixes still hold on main 9c5c303.

## What was run

The repo's own checks, on a built server over a fresh copy of the v1 fixture, in the pre-installed Chromium
(no WebKit here; the keyboard is faked from `visualViewport` as the checks do, and the pinyin replay drives the same
DOM sequence Mobile Safari sent in Ratchet's trace):

| Check | Mode | Result |
| --- | --- | --- |
| `scripts/phone-keyboard-check.mjs` (B48) | plain | pass: toolbar bottom 500 against visible bottom 508 on the 1st, 2nd and 3rd focus; 90 px from the bottom with no keyboard; Aa panel and paste menu inside the visible part; 0 page errors |
| same | `IOS_RECTS=1` | pass, same numbers |
| `tests/evidence/b54/keyboard-layout-check.mjs` (B54, B55) | plain and `IOS_RECTS=1` | pass: tab bar hidden with the keyboard up and back after; the caret's line and the line below it 8 px clear of the toolbar; hidden rows skipped; the caret handle on its line |
| `tests/evidence/b49/pinyin-replay.mjs` (B49) | bullet, nested, todo, second | all pass: the word stays on his line with its id and kind, nothing stray, a to-do stays a to-do, the second word joins the first, the save holds the line without a break |

## What changed to run them

The three scripts had stopped working with the current app, not because the fixes had: they looked for the converted
v1 template's block ids (`…:notes:template:0`; the v2 template names rows `…:r3`), the pinyin replay read the legacy
SQLite tables, and all three launched Playwright's own Chromium, which this environment does not have. They now find
the Notes line by its heading, read the v2 store, and take the Chromium path from `CHROMIUM`.

## Still unverified

A physical iPhone and third-party keyboards, as before. The success check from the checklist stands: Brian types on
his phone and the toolbar is above the keyboard every time; a pinyin word on a new line stays on that line.
