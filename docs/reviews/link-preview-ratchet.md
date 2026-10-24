# B43 post-ship confirmation

Candidate: **ac69ff6**, live as main 23cba50. Reviewer: Ratchet, task #186.

**Pass.** Independently reran the three original reproductions and Lead's 26-case malformed-response sweep on ac69ff6. No production writes or production paste.

## Original findings are fixed

- A 302 with `Location: http://[` now returns no preview and the process continues. The original d573b2b exited Node from its response callback.
- Redirect and refused non-HTML responses are destroyed. The streaming fixture has zero live streams after either return; only the first 64 KiB write was sent before cancellation. The original kept draining more than 1 MiB after return. `fec0::1` is now refused.
- Converting the fetched quote to a bullet while keeping its words preserves the page on paste Undo. The original removed that edited page. The whole preview body is recorded; later formatting/document changes conservatively count as edits.

## Independent verification

- Full suite **463 passed, 0 failed**, 11 skipped, 4 todo. Typecheck and build pass.
- Final fetcher tests cover public/private IPv4 and IPv6, mapped addresses, connection-time checked DNS, refused schemes/credentials/ports/hosts, redirect count and private redirect targets, off switch/no request, charset headers and meta fallback, GBK/GB18030, unknown charset and invalid bytes, timeout and size cap, plain-text metadata and limits.
- Domain tests cover delayed application after Undo/trash/rename/body edit/wrong URL/wrong card, preview Undo, quote edits/formatting/conversion, duplicate application and Good Stuffs title propagation.
- Lead's `sweep.ts`, rerun independently: all 26 cases return values, no escaped error, zero sockets left open. Endless headers/body stop near 4 s. Includes malformed status/header/chunking, resets/lying lengths, oversized headers/title, invalid/bogus/UTF-16 charsets, controls/bidi/entities, redirect loops and forbidden targets.
- Request callbacks now settle through one function that destroys request and response; redirect parsing and response/decode callbacks are guarded. Existing global auth middleware continues to wrap the new server function.

## Limits

- Gzip sent despite `Accept-Encoding: identity` gives no preview, accepted by Lead.
- Vercel outbound behavior remains unverified until a real paste. Real-site results reported by Lead/Product were from their Macs, not Vercel.
- Browser presentation checks were performed by the author and Lead; this confirmation independently concentrates on the changed fetch/error/Undo boundaries. No claim of a separate Ratchet B43 browser pass.

Evidence: `tests/evidence/ratchet-b43/{invalid-redirect,bounds,quote-conversion,sweep}.ts`. The first three originated in this review and are already on the candidate branch; `sweep.ts` is copied from Lead's 55b707e for repeatability. A first rerun accidentally remained on d573b2b after a merge refused to overwrite those untracked originals; it was stopped and excluded. The successful runs above were after verifying the fast-forward to ac69ff6.
