# Save-on-leave browser gate

Uses synthetic paragraphs and Vancouver-relative days (today minus3,2,1 and today), so sidebar navigation stays available as the calendar moves. No copied personal data is required.

On an isolated worktree of the build under test:

```sh
node tests/evidence/save-on-leave/seed.ts /tmp/ratchet-save-leave-NEW.sqlite
npm run build
DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/ratchet-save-leave-NEW.sqlite npx vite preview --host 127.0.0.1 --port 3541
# In another terminal:
node tests/evidence/save-on-leave/check.mjs http://127.0.0.1:3541 /tmp/ratchet-save-leave-NEW.sqlite
```

Use a new database per run. The script refuses port3000, non-loopback hosts and database paths outside the disposable prefix. It exits nonzero if an assertion reports FAIL. Optional third argument is a Playwright module path for external runners.

Ratchet task167 executed this repaired gate against the live build's **code9dea4ec**, served only on3541 with a newly seeded disposable SQLite database. All12 assertions passed: cut/switch/paste; immediate typing/navigation; rapid multi-page edits; stale leave refusal followed by Load latest; network-failed leave recovery; legacy draft opening; no page errors. This is no production-write claim and no B35 verification. Evidence: ratchet-relative-output.txt.
