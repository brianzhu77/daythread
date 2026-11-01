#!/bin/zsh
# run.sh <worktree> <scenario...>: seeds once, then each scenario on a fresh copy of the seed, its own server on 3650.
W=$1; shift; D=${RB_DIR:-/tmp/rb-mid}; mkdir -p $D; S=$W/tests/evidence/day-draft/ask-again.mjs
serve() { pkill -f "vite dev --port 3650"; while lsof -ti tcp:3650 >/dev/null; do sleep 0.5; done
  (cd $W && DAYTHREAD_AUTH=off DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=$1 nohup npx vite dev --port 3650 --strictPort > $D/vite.log 2>&1 &)
  for i in {1..40}; do curl -s -o /dev/null http://127.0.0.1:3650/ && break; sleep 0.5; done }
if [ ! -f $D/seed.sqlite ]; then rm -f $D/s.sqlite*; serve $D/s.sqlite; node $S http://127.0.0.1:3650 seed; pkill -f "vite dev --port 3650"; sleep 1; cp $D/s.sqlite $D/seed.sqlite; fi
for sc in "$@"; do rm -f $D/w.sqlite*; cp $D/seed.sqlite $D/w.sqlite; serve $D/w.sqlite; node $S http://127.0.0.1:3650 $sc; done
pkill -f "vite dev --port 3650"
