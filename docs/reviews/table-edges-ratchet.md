# PR215 independent review

Head reviewed: 3901a789c39cb12aa573ff1167bf188cff515594, November 14, 2026.

No blocking defect found in the four-file diff. The scroll-timeline declarations and keyframes are removed throughout src. Each DatabaseTable owns one stable scroll element and table child. Its hook installs one passive scroll listener and observes both boxes, retaining the watcher through inline ref reattachments, replacing it if the element changes, and disconnecting on component unmount. The classes preserve the requested scroll thresholds and CSS states.

Independent checks:

- Production build and application/test typecheck pass with the shipping dependency tree.
- Author's table-edges.mjs: Chromium 9/9. WebKit six consecutive runs of the nine-check suite pass with no crashes (54/54). Each run includes window resizing, mid-drag widget narrowing and Undo widening. This is a repeated edge/resize suite, not a repeat of the author's separate 43-check dashboard suite.
- Additional reviewer WebKit probe: changing only the table content width (no window resize or scroll) adds the fade; scrolling to the end removes it; shrinking the content back to fit clears it. Four client-side route changes retain no detached table or scroller in active ResizeObserver observations. See tests/evidence/databases/ratchet-edge-lifecycle.mjs.

Limitations: native momentum scrolling belongs to Jazz's requested Simulator pass; browser screenshots, 390 budget/typing comparisons, full regression and merged-main release checks belong to the author/design/Lead gates. Those were not independently rerun here. No runtime changes, production writes or deployment performed.
