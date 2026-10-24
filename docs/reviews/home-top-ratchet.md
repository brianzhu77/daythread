# B52b independent acceptance

PASS: 85a9c80, fix/home-screen-top. Ratchet, 2026-10-24. Native iPhone17/iOS26.4 Simulator, fresh Home Screen installation from Today on disposable3630/rev362 copy, named B52b acceptance. Existing zero-inset installation was retained as control; this tests fresh installation, not deletion of Brian's installation or migration of its storage.

## Native standalone
navigator.standalone=true. Fresh launch: screen402x874, innerHeight874, safe strip62px, app-content top padding62px. Today title top86. Native Tasks tab navigation keeps standalone and no native Close/URL/browser controls appear. Tasks title top86; strip and bottom fade both rgb(245,245,250), matching --bg-grouped. Top and bottom screenshots show no white band. Native Today → Review today navigation also stays standalone, Review title top71 and Done top70, clear of the62px strip. Dark clock/battery remain legible over the white or grey strip.

Native tap on the empty Notes bullet raises the real Pinyin keyboard. At visualViewport.offsetTop93, height470, the safe strip measures top0,height62. The edited empty line is at347–371, above toolbar412–462 and below the strip. Hiding keyboard keeps the strip protecting the clock in the scrolled view. Empty native selection ranges report zero rectangles, so line bounds—not that zero range—are the visibility evidence.

## Safari and source checks
Native Safari Today/Tasks/Review all retain top inset0 and padding0; keyboard opens normally, toolbar remains visible, strip stays0 at offset93. Text under Safari's translucent status bar remains the known limit. Manifest link resolves to /manifest.webmanifest, returns200 application/manifest+json, declares root start_url/scope and standalone display. Source inspection confirms its path is already public in the auth gate. This run adds the icon from root and checks actual navigation; adding from a day URL is not independently exercised.

Independent suite478 passed/0 failed (11 skipped/four todo), typecheck and build pass. No app code changed by reviewer. Alignment gate belongs to Lead's merged tree and was not rerun here. Native screenshots/readings and local drivers are under tests/evidence/ratchet-home-top; drivers depend on /tmp/sweep-ios/driver.py and its isolated Appium session. Initial assertion used an incorrect hard-coded grey and was corrected to the existing --bg-grouped token. Native UI field clearing invalidated an AX handle during icon naming; refinding it completed installation.

## Release limits
Physical iPhone and older iOS clock colour remain unverified. Existing installations do not pick up the new standalone status-bar setting until re-added. The optional re-add offer must retain the agreed sign-in/local-unsaved-data cost; this review does not authorize touching Brian's app installation. Desktop/Safari get the grey fade improvement without re-adding. No service worker/offline cache is introduced by the manifest.
