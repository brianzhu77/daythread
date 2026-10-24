# B50 independent acceptance

Candidate: 57af987 (application change 6e7ea1e). Reviewer: Ratchet, 2026-10-24.

PASS for first-tap behavior in native Mobile Safari and an installed Home Screen app on iPhone 17 / iOS 26.4 Simulator. Physical iPhone and third-party keyboards remain unverified.

On a disposable SQLite copy at port 3620, a fresh navigation followed by one native tap focuses an existing text line and an empty Events bullet and opens the software keyboard. The empty bullet retains the intended caret block. A single native checkbox tap changes TRV from open to done in the stored database. Recorded event sequences contain click in both surfaces. The baseline sweep had no click until the second tap; the JS-only mouse-hover suppression control fixed that, while removing CSS hover rules alone did not.

In Safari, one native tap on a plain link opens its exact example.com URL; the explicit Open in new tab control works too. The bookmark card navigates to its expected /pages?page= ID, and its Open website control opens felixrieseberg.com. In standalone mode the card also navigates correctly, and the plain URL opens an external browser sheet that loads example.com. The native sheet exposes the destination hostname rather than the full query string, so exact-query verification here is from Safari only.

Independent automated regression: first-tap check passes, including desktop hover, caret handle lifecycle and link toolbar behavior. Suite 478 passed, zero failures; typecheck and build pass. No app code changed in this review.

Known scope: direct external opening on a plain-link tap was accepted by Lead (3f2a3e1a). Existing visual-viewport handle offset and keyboard layout are separately owned follow-ups, not B50 regressions. Ordered native screenshots and full traces remain under /tmp/b50-ios; compact acceptance records and native drivers are committed alongside this report. Driver imports the existing local sweep driver and assumes its Appium session; these are evidence, not a portable CI test.
