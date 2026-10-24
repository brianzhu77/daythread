# Phone-polish and B56 independent review

Candidate ee53db8 (8d9bc1d plus B56). Reviewer Ratchet, 2026-10-24. Accept for integration with the B52 limitation below explicitly retained; Lead ad05b071 accepts that limit for this deploy.

## Verified
- B51: independent WebKit rendering on a disposable copy with Sunday morning clock. Without Saturday reviewSaved, the card says “No suggestions from last night · Draft my day”. With reviewSaved it says “Draft my day”, retaining offered tasks. B47's draft branch remains unchanged by inspection.
- Paste placement: actual native clipboard paste and software Paste menu in Mobile Safari, iPhone 17 / iOS 26.4. At visualViewport.offsetTop=60, menu bottom=279 and line box top=286: seven pixels clear, immediately above its line. The range ink and line box have different vertical bounds; an initial overly exact four-pixel line-box assertion was discarded. Screenshot confirms placement. No page errors.
- B56: on native Safari, tick TRV then tap Done once while its notice is present. The review finishes at /. Done rect top=8,bottom=52; notice is at bottom, visibly separated from Done. No page errors. Independent B31 evening WebKit390 replay passes including saved next-day lines. Lowering the keyboard before reaching Done remains necessary; sticky-header attempt was excluded by author.
- Independent suite 478 passed / zero failed (11 skipped, four todo); typecheck and build pass. iOS-coordinate phone-keyboard replay passes. No app code changed in this review.

## B52 remains open
Both Safari and the already-installed Home Screen app report top safe-area inset zero, including a fresh standalone env probe: standalone=true, screen402x874, innerHeight812, top0,bottom34, viewport meta includes viewport-fit=cover. The keyboard-up standalone offset is74; the strip is zero high and a heading overlaps the clock in the screenshot. Keyboard-down strip is also zero. This candidate therefore does not fix that overlap. Its white theme color and viewport-following notice positioning are separate changes. Team has identified the absent standalone status-bar-style tag as a lead; the later black-translucent experiment is attributed to Roadbuster, not independently verified here. Re-adding the app with that future change is separate acceptance.

## Evidence and limits
Compact readings, native screenshots and replay outputs live in tests/evidence/ratchet-phone-polish. Full local drivers/traces: /tmp/b207-ios and /tmp/sweep-ios/b207-*.py. Tests use disposable SQLite copies on3624/3620 only. Initial resumed WDA session dropped its socket; restarting the runner restored native control. A helper initially tapped an inline URL and opened another tab; those attempts are excluded from paste evidence. Physical iPhone and third-party keyboards remain unverified.
