#!/bin/zsh
# A11 browser checks on the three targets (1280, 390, 390 touch), each on its own fresh copy of a database with
# tests/evidence/a11/seed.ts applied, against the built app (run `npm run build` first). Sign-in off, loopback only.
#   tests/evidence/a11/run-all.sh [source.sqlite] [port]
# With no source, each copy starts empty. The source itself is never opened for writing.
set -u
SRC=${1:-}
PORT=${2:-3471}
ROOT=${0:A:h:h:h:h}
WORK=$(mktemp -d /tmp/a11-check.XXXXXX)
cd $ROOT
failed=0
for target in "1280" "390" "390 touch"; do
  DB=$WORK/${target// /-}.sqlite
  if [[ -n $SRC ]]; then sqlite3 $SRC ".backup '$DB'"; fi
  DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=$DB node tests/evidence/a11/seed.ts 2>&1 | grep -v '"level"\|ExperimentalWarning\|trace-warnings'
  DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=$DB npx vite preview --host 127.0.0.1 --port $PORT > $WORK/server.log 2>&1 &
  server=$!
  for i in {1..60}; do curl -s -o /dev/null http://127.0.0.1:$PORT/ && break; sleep 0.25; done
  DB=$DB node tests/evidence/a11/ui-check.mjs http://127.0.0.1:$PORT ${=target} 2>&1 | grep -v 'ExperimentalWarning\|trace-warnings' || failed=1
  kill $server; wait $server 2>/dev/null
done
rm -rf $WORK
exit $failed
