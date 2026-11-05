# Independent PR152 floor-block review

Candidate 76c54680. The inert block preservation change is clear within the tested scope. No application changes by reviewer.

Build and all four button-block unit tests pass. The built-app keep.mjs script passes eight checks in each engine: opening, both named/empty labels, inert click with unchanged revision, adjacent typing, opaque steps retained exactly, reload and 390 without overflow.

The block carries label plus opaque steps and no execution handler or creation menu. isEmptyLine and mergeDraft's empty-line check recognize it as nonempty. Template copies get a new id; export of a named button keeps its label. Existing general nontext-block deletion protection applies by content:none rather than a whitelist, so registering this block does not bypass that guard.

The known empty-label export choice remains as Jazz identified: the screen says Button while external HTML/Markdown write an empty label. The existing unit explicitly asserts empty Markdown, so this should be reconciled with the intended export fallback before the creation release. It is not a new execution or storage risk in this inert-floor release.

When the creation feature follows, all step configuration/version information the floor must retain must fit inside the opaque steps field; adding unrelated props is not automatically preserved by this fixed prop schema. The future running command and its atomicity have not been implemented or tested here. No Worker, real Postgres, full regression suite or native device by reviewer. This does not raise the rollback floor by itself; Lead owns the release and floor move.
