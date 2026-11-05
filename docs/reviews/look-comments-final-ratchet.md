# Independent final retest of icons, covers and Comments

Candidate PR150 dc38bac2 containing PR147 4064bba5, PR145 ab3b39f4 and PR144 2002d1f6. Both previously reported findings are cleared within the tested scope. No application changes by reviewer.

Build and both relevant unit files pass. Each original browser fixture passes independently in Chromium and WebKit:

- Hold koala, reopen the picker and choose tree, release koala while tree remains held: the head stays tree throughout.
- Hold paper, reopen Change and choose stone, release paper while stone remains held: the cover stays stone throughout.
- Send First sent, type replacement NEW WORDS during the held request, release: the original is stored, newer words remain in both the field and session draft.

The author's new/reply/edit held-send scenario also passes in each engine, including reload of the draft, keeping only appended words as a new comment draft, replying again, and the next edit using the updated thread version without refusing its own save.

The normal icon/cover/set baselines (14/14/6 per engine), normal Comments baseline (18 per engine), and independent floor migration/save fixture ran on the previous heads and remain relevant: the fixes change only shared draft generation ownership and the CommentField settlement path. No broad baseline rerun after these fixes. No Worker, real Postgres, real R2 upload or native phone by this reviewer; Lead's gates remain separate evidence. The accepted old-build hard-delete/Undo decoration loss exception remains.
