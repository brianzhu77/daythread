#!/bin/sh
# A6b expiry after a server restart mid-run (plan §3.5): tap Draft my day with a model that never answers, kill the
# server, start it again, load: the run left drafting by the old process is stored as expired, with Retry.
#   restart-check.sh <worktree> <work dir with pristine.sqlite> <port> <fake port>
set -e
WT=$1; W=$2; PORT=$3; FAKE=$4
rm -f $W/w.sqlite $W/w.sqlite-wal $W/w.sqlite-shm; cp $W/pristine.sqlite $W/w.sqlite
curl -s -X POST "http://127.0.0.1:$FAKE/__draft-mode?mode=hang" >/dev/null
start() { (cd $WT && DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH=$W/w.sqlite OPENROUTER_BASE_URL=http://127.0.0.1:$FAKE/api/v1 OPENROUTER_API_KEY=fake OPENROUTER_MODEL=fake/model nohup npx vite preview --host 127.0.0.1 --port $PORT > $W/preview-$1.log 2>&1 &); sleep 3; }
start a
node -e "
const { chromium } = await import('$WT/node_modules/playwright/index.mjs'); const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://127.0.0.1:$PORT/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
await p.locator('.start-the-day').getByRole('button', { name: 'Draft my day' }).click(); await p.waitForTimeout(1500)
console.log('before restart:', (await p.locator('.start-the-day').innerText()).includes('Drafting your day') ? 'drafting' : 'NOT drafting'); await b.close()" --input-type=module
pkill -f "port $PORT"; sleep 1
start b
node -e "
const { chromium } = await import('$WT/node_modules/playwright/index.mjs'); const b = await chromium.launch(); const p = await b.newPage()
await p.goto('http://127.0.0.1:$PORT/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const t = await p.locator('.start-the-day').innerText()
console.log('after restart:', t.includes('Model unavailable · nothing was added') && t.includes('Retry') ? 'ok   expired with Retry' : 'FAIL ' + t.slice(0, 200)); await b.close()" --input-type=module
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('$W/w.sqlite',{readOnly:true});const r=JSON.parse(d.prepare(\"SELECT draft FROM pages WHERE snapshot='current' AND draft LIKE '%run%'\").get().draft);console.log('stored:',r.run.status,r.run.failure,'attempts:',JSON.stringify(d.prepare('SELECT state FROM model_attempts').all().map(a=>a.state)))" 2>&1 | grep -v "Warn\|trace"
pkill -f "port $PORT"
