# B27 on the iOS Simulator (Roadbuster, Oct 25)

Own simulator `RB-B27` (iPhone 17, iOS 26.4), keyboards `zh_Hans-Pinyin` then `en_US`; Appium 3.8 on 4737 with
`APPIUM_HOME` a copy of Ratchet's install, WebDriverAgent on 8117. Server: a build of feat/b27-at-date on
127.0.0.1:3571, SQLite store from `seed.ts` on a copy of rev 356. Real keyboard taps in Mobile Safari.

    python3 start.py            # session
    python3 native-b27.py <out> # the run

Found here first: BlockNote drops the `@` list while WebKit composes pinyin and nothing reopened it, so ＠明天 stayed
text (Chromium's IME events in `composition-check.mjs` didn't show it). Fixed in 8068cd9. The Chinese keyboard's `@`
key types a half-width `@` (U+0040).

`steps.py` holds the helpers: web content sits 62 pt below the screen top in this Safari layout (measured), so a line
is tapped at its CSS rect + 62. Clear localStorage before a run: the app keeps unsaved drafts there across reloads.
