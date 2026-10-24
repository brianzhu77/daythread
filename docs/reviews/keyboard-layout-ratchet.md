# B53/B54/B55 independent acceptance

PASS: candidate 41b7d4c, fix/keyboard-layout. Ratchet, 2026-10-24.

Native Mobile Safari and installed Home Screen app on iPhone17/iOS26.4, using disposable copied SQLite data on3626/3620. Three labelled bullet lines appended to the fixture are setup, not a user observation; all caret and Aa actions in acceptance use native taps with the real software keyboard.

- Safari: caret on first fixture line, viewport offset93. Next visible line bottom310, toolbar top318: exactly8px clear. Handle centre265, caret centre265. Tabs hidden. Last fixture line selected natively, Aa opened: caret bottom202, line box bottom204, panel top210. Offset226. No page errors.
- Home Screen: standalone=true. Next line bottom342, toolbar top350: exactly8px clear. Handle centre297, caret centre297, viewport offset109. Tabs hidden. Last line + Aa: caret bottom214, line box bottom216, panel top242, offset262. No page errors.
- Hiding keyboard restores tab-bar display:flex in both surfaces; viewport height714 Safari /812 standalone. No editing focus remains.
- Independent hidden-row keyboard-layout replay passes in WebKit iOS-rects mode. Independent Aa/toolbar/paste replay passes in WebKit normal mode. Suite478 passed/0 failed, 11 skipped/four todo; typecheck and build pass.

Native records and screenshots are committed under tests/evidence/ratchet-keyboard-layout. Full local Appium helper lives at /tmp/sweep-ios/driver.py; committed acceptance drivers import it and are evidence rather than portable CI scripts. Initial Home Screen relaunch tapped an invisible stale AX node; excluded. Selecting the visible icon on its second Home Screen page restores the real standalone context. Physical iPhone and third-party keyboards remain unverified. No application code changed by reviewer.
