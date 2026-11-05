# Independent PR132 retest

Candidate ccd81ed9. The two previously reproduced conversion-chain regressions are fixed: the original domain fixture now retains a comma-bearing Select option on conversion to Multi-select, and takes Red when a fresh Text-derived Multi-select becomes Select. Ten conversion tests passed independently, including renamed options and restoring the retained Text. Build passed.

An independent domain fixture also confirms the accepted older-client limitation: submitting options without `from` while renaming loses the mapping, leaving converted cells empty. Text and back reconstructs the original words as a new option; it does not retain the renamed link. Raw words remain intact. This is a known limitation, not a newly cleared behavior.

No Worker, real Postgres, native device, full downstream Formula/Rollup/export check or browser Board drag was run by this reviewer.

The author's five built-app scenarios were independently rerun through the Type menu in Chromium and WebKit; all passed without page errors. They cover option creation, rename, comma splitting, Date/Checkbox text and Select/Relation loss notices with restoration. The two chain regressions and renamed chains were checked at domain level, not separately through the browser menu.
