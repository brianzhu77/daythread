# B44 offline keep independent review

Candidate: **6597c02**, fix/b44-offline-keep, based on main b358ac8. Reviewer: Ratchet, task #189.

**Pass.** The original offline-keep reproduction now saves both the text and its material after reconnect. The new intent follows editor saves and recovered drafts, including when merging changes the line ID. No production writes or external preview calls.

## Independent evidence

- Full suite **473 passed, 0 failed**, 11 skipped, 4 todo; typecheck and build pass.
- Original `extra.mjs CASE=offlinekeep` passes at 390 WebKit. Author offline and closed-tab cases independently pass at 1280 Chromium and 390 WebKit.
- **Competing edits and ID remapping:** one tab's saves fail after pasting the URL; another tab writes different words into the same original line. Close the failed tab and recover it. At both widths, the URL receives a new line ID, the material source points to that ID exactly once, and the other tab's words remain.
- **Load latest:** the same competing-edit situation with the owner still open, at 390. Reconnect, receive the conflict, choose Load latest: the merged URL is remembered once against its new ID and the other words remain.
- **Two surviving tabs:** while the owner is alive its draft is not taken; after closing it, two tabs on Pages race to save the retained draft. At both widths, the result is one recovered line, one material, one source. The shortened gone-tab lease is a test hook, not a native app lifecycle claim.
- **Undo offline before reconnect:** at both widths, Undo removes the pasted text; reconnect creates neither text nor material later.
- **Leaving the editor:** offline keep, navigate to Pages, reconnect. B40's background save preserves the text and material at both widths.
- **Lost save reply:** at 1280, allow a save carrying `keptPlainLinks` to execute, then discard its response. Recovery leaves one source; deleting that line afterwards removes the material.
- **Bookmark before a successful editor save:** at 390, block editor saves while allowing the page-creation command. Choose Bookmark immediately; resume saves. The card carries the pending material intent. Notice Undo returns the plain link with its material, then history Undo removes the original paste and material. At 1280 the ordinary Bookmark/both-history-Undo scenario also passes.
- **Good Stuffs:** at 390 the kept URL becomes a non-plain deliberate save and survives line deletion. Domain tests cover that exception, missing/changed line refusal, replay/later save, and old `save-plain-link` compatibility for tabs still on b358ac8.
- No page errors in the browser checks.

## Code review

`save-editor` creates a material only for an intent whose actual saved line holds that URL, in the same transaction as projection and cleanup. The intent is stored before the paste transaction can trigger a draft stash. It travels through ordinary flush, leave save, own/gone draft recovery, background/export save and Load latest. `mergeDraft.placed` is the existing placement map exposed to remap the intent; the browser checks above force a changed ID rather than assuming identity survives. Old tabs' separate command remains accepted.

## Scope and limits

This closes the accepted offline-keep gap in b358ac8. The existing B44 native iPhone keyboard and screen-reader highlight limitations remain; this change adds neither UI behavior nor an accessibility fix. These checks use disposable SQLite stores and browser tabs. They do not establish native Home Screen/OS termination behavior or Vercel outbound preview behavior. No layout gate rerun was needed for the metadata/recovery change.

Reproductions: `tests/evidence/ratchet-b44-offline/recovery.mjs`, using the disposable runner `tests/evidence/ratchet-b44/run-author.mjs`. CASE values: merge, loadlatest, race, undo, leave, lostreply, immediate. The original offlinekeep check and author offline/closed-tab modes remain independently runnable. Logs alongside the script preserve the final observations; the 390 competing-edit/closed-owner run was observed directly in tool output rather than saved to a log.
