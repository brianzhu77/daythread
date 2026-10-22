#!/bin/zsh
# run.sh <name> <worktree> <port>
name=$1; wt=$2; port=$3; PW=/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs; out=/tmp/rb-pay/$name; mkdir -p $out
ev=/Users/dogrod/Developer/daythread-payload/tests/evidence
run() { # label script
  rm -f $out/w.sqlite*; cp /tmp/rb-pay/pristine.sqlite $out/w.sqlite
  (cd $wt && DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=$out/w.sqlite npx vite preview --host 127.0.0.1 --port $port --strictPort > $out/preview-$1.log 2>&1 &)
  for i in {1..40}; do curl -s -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.5; done
  node $2 http://127.0.0.1:$port $out/w.sqlite $PW > $out/$1.txt 2>&1; echo "$1 exit $? · $(grep -c '^ok' $out/$1.txt) ok · $(grep -c '^FAIL' $out/$1.txt) FAIL"
  pkill -f "vite preview --host 127.0.0.1 --port $port" ; sleep 1
}
run save-on-leave $ev/save-on-leave/check.mjs
run b23 $ev/b23-load-latest/check.mjs
run two-tabs $ev/refresh-on-visible/two-tabs.mjs
run races $ev/ratchet-save-leave-99/races.mjs
rm -f $out/w.sqlite*; cp /tmp/rb-pay/pristine.sqlite $out/w.sqlite
(cd $wt && DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=$out/w.sqlite npx vite preview --host 127.0.0.1 --port $port --strictPort > $out/preview-payload.log 2>&1 &)
for i in {1..40}; do curl -s -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.5; done
node /tmp/rb-pay/payload.mjs http://127.0.0.1:$port $PW > $out/payload.txt 2>&1; echo "payload exit $?"
pkill -f "vite preview --host 127.0.0.1 --port $port"
