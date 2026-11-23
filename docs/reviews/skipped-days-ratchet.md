# Updated review — 63ad2607

The independently reproduced immediate jump is repaired. Six independent hold probes pass at 390: short move, tall move and tall plain skip in Chromium/WebKit, each with zero displacement at 60/300/600/900ms. Source delta reviewed; full typecheck passes. Phone age removal, retained disabled Another day line/minimum height, tall-band cap change, desktop wrapping and shared picker positioning inspected.

Author row-check rerun: 49/50. Only Chromium short move's nominal 900ms sample read -38px; earlier three samples and the other five hold cases passed. This may reach the scheduled one-second close after action/assertion overhead; not attributed conclusively. Author notified 43392ad3 to record actual elapsed time. The six independent probes reproduce no early jump. Original runtime blocker cleared; final test timing accounting remains with author. Native Safari/Home Screen picker verification remains Jazz's lane; reviewer has no native or real iPhone evidence.

All unchanged functional evidence below remains valid. Own server 43980 stopped. No runtime source fixes by reviewer.

---

# PR231 independent review — 71c0ca95

NOT CLEAR pending the moved-band hold geometry fix reported by Jazz 2cb3d6c2 and independently reproduced in Chromium/WebKit: the next row jumps up 42px 120ms after choosing a day at 390, during the required one-second hold. Keep the disabled Another day line height until the band and choices close together. Exact data predecessor a2509260 independently cleared; all source delta to 71c0ca95 read.

Contract: Brian chose A (b1bb8ae5); Lead 937ccf73/028d4a5e/78bf7fa0, Jazz sketch v4, reviewer lifecycle conditions e60932f5. Prior skips only; inline row offer, plain one-tap skip; atomic skip/move and Undo; date labels from draft day; label reset on apply/move/planning; old-build compatibility required.

Independent evidence:
- Production build and full typecheck pass. 21 focused tests pass including two reviewer probes (Undo restores earlier skip history; repeated move leaves first move intact).
- Author row-check rerun independently: 40/40 Chromium 390 touch and WebKit 1280 keyboard/mouse.
- Reviewer lifecycle probe in Chromium/WebKit: move stored while sends aborted, band disappears, another client skips item, retry becomes held, named Keep mine/Discard persists after reload and >4s; no actionable stale band, success toast retires. Initial immediate toast assertion ran before closure animation; 700ms closure allowance passes both engines.
- Reviewer pending/batch probe: Chromium and WebKit, both Apply all and Dismiss while the move is stored with sends aborted. IndexedDB contains exactly one move and one batch; batch excludes the moved item. Four scenarios pass.
- On exact old build accd393e: 3/3 compatibility tests pass independently (stored new row-moved shape opens and other draft operations leave it alone). No browser old-server/new-tab rehearsal by reviewer.

Own scripts: tests/ratchet-skipped-data.test.ts; tests/evidence/skipped-days/ratchet-{lifecycle,batch}.mjs. Throwaway store /tmp/ratchet-377.sqlite. Logs /tmp/ratchet-377-{types,build,row-check,lifecycle,batch}.log. No production/account/model/native actions, no runtime source fixes. Native picker on actual iOS remains Jazz's lane; no real iPhone verification.

Own hold probe: tests/evidence/skipped-days/ratchet-hold.mjs; both engines y445→403 (~42px). Own server 43980 stopped after review.
