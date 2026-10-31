# PR42 independent review

**Final verdict: PASS aca955b.** Initial ff6a944 had clipped failure-state account actions; the revised head resolves them. Copy and alignment evidence below remains applicable.

## Confirmed finding

Extending the supplied account montage to the renderer's real failure markup, reminders failed (`Couldn’t turn on reminders · Turn on reminders`) overflows by 31.78px at150px in both engines/schemes; the new clipping parent hides part of the retry action. The unsaved-export state (`Not exported · latest text not saved yet · Try again`) additionally overflows by1.72px at300px in WebKit. The new nowrap grouping/inline-block width and overflow:hidden do not accommodate these failure suffixes. These are isolated row-width tests, not a claim that the normal sidebar is150px wide. Reported9bc0e0c8; author asked to preserve safe wrapping and separator placement for error states too.

Evidence: failure-montage.mjs, failure-dots.log, screens/failure/. Regular/on state montage passes24 combinations: Chromium/WebKit × light/dark ×150,194,239,260,300,350px. This uses cloned signed-in markup on auth-off invented data; no real account or push operation.

## Passing checks

- Production-build affected-screen replay:44 passes, Chromium1280 and WebKit390, light/dark. Today first-use and Tomorrow explanatory lines removed; empty Pages/Tags/Trash and future-day states retain facts/actions; Search retains its name/placeholder and Nothing matches; slash menu has titles without descriptions. No reported page errors (the author's replay excludes ResizeObserver diagnostics).
- Full alignment211 passed,0 failed,0 missing at1280/390 on3 invented fixture days. Standing rule applies despite unchanged row markup.
- Calendar prompt: Chromium Cancel causes0 ensure-day writes; Create causes1 and opens that day's page. WebKit390 with touch taps and settled opening also passes Cancel/reopen/Create. An initial mobile mouse-click replay clicked Cancel while the opening animation was still entering; the exiting backdrop remained and blocked reopening, even when later waiting for detach. A separate touch replay after a700ms pause closes/reopens correctly. This is recorded as an input/animation timing limitation; no new application defect is established without comparison to the unchanged dialog primitive.
- Typecheck and production build pass. Application diffs remove descriptions and keep error/retry/save/offline/Undo/delete-account warnings. No data or command implementation changes. No additional full domain-suite rerun for this presentation change.

No source fixes by reviewer. Evidence tests/evidence/ratchet-quiet-copy/. Physical iPhone unverified. Await revised account-row head before a final pass.

## Revised account items: aca955b

The message and action are separate AccountItems in export failure/unsaved states, reminder on/failed states, and the Home Screen hint. Reading order and event handlers remain intact. Hidden reminder/hint states still return null; no empty wrapper leaves a separator. No day-row or copy change after the initial review.

Independent rebuilt-bundle montage using the revised renderer markup: **48 passed**, normal and failure states at150–350px, both engines and schemes. The previously failing reminder150px and export300px cases now have zero overflow; no clipped text or line-edge dot. Typecheck and production rebuild pass. Original44-screen and211/0/0 alignment results remain valid, since this correction only changes account children grouping. No material finding remains. Reported clipping9bc0e0c8 is resolved.
