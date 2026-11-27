#!/bin/sh
# Runs the app's tests (unit and UI) on the one simulator this machine gives to this work, against three throwaway
# servers started from this checkout:
#   3741  sign-in off, seeded with today's page and its to-dos: "Water the plants", which tests only read, and one for
#         each test that ticks ("Tick me", "Tick me offline", "Tick me twice"); for the to-do row, rows with each
#         kind of mark and one to-do for each test that acts on a row ("Move me", "Set me aside", …)
#   3742  sign-in on (no Supabase behind it: only "who is this?" is asked, and it answers 401)
#   3743  sign-in off, seeded for the strip above the page (slice 1d.1): events on today, to-dos due and started
#         today on yesterday's page, three to-dos set aside; a server of its own, so the rows the tests of 3741 reach
#         do not move down by the strip's height
# Each server keeps its SQLite file in a directory under the system temp directory; all are stopped and their
# directories removed on exit, however the run ends, and so are the stores the UI tests made in the app's container.
# Never uses port 3000 or .daythread-local/.
#
# The simulator is named, not numbered: "iPhone 17" on iOS 26.5, or DAYTHREAD_SIMULATOR_NAME and
# DAYTHREAD_SIMULATOR_OS. Its UDID is looked up only to find the app's container when cleaning up.
#
#   native/scripts/ui-test.sh [extra xcodebuild arguments, e.g. -only-testing:DaythreadUITests]
#   native/scripts/ui-test.sh --serve   # the same three servers, seeded, until Ctrl-C; no tests (for looking by hand)
set -eu

native=$(cd "$(dirname "$0")/.." && pwd)
repo=$(dirname "$native")
simulator_name=${DAYTHREAD_SIMULATOR_NAME:-iPhone 17}
simulator_os=${DAYTHREAD_SIMULATOR_OS:-26.5}
destination="platform=iOS Simulator,name=$simulator_name,OS=$simulator_os"
today_port=3741
sign_in_port=3742
morning_port=3743

# The UDID of the named simulator on that iOS, from simctl; empty when there is none.
simulator_udid() {
  xcrun simctl list devices available -j | node --no-warnings --input-type=module -e "
    let text = ''
    for await (const chunk of process.stdin) text += chunk
    const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-' + process.argv[1].replaceAll('.', '-')
    const device = (JSON.parse(text).devices[runtime] ?? []).find(d => d.name === process.argv[2])
    process.stdout.write(device?.udid ?? '')
  " "$simulator_os" "$simulator_name"
}

for port in $today_port $sign_in_port $morning_port; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ui-test: port $port is in use; stop what is listening there first" >&2
    exit 1
  fi
done

work=$(mktemp -d "${TMPDIR:-/tmp}/daythread-ui-test.XXXXXX")
pids=""

clean_up() {
  status=$?
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  for pid in $pids; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$work"
  udid=$(simulator_udid 2>/dev/null || true)
  if [ -n "$udid" ]; then
    # simctl finds the container only while the simulator runs, and xcodebuild may have shut it down: read the
    # containers' metadata instead.
    for container in "$HOME/Library/Developer/CoreSimulator/Devices/$udid/data/Containers/Data/Application/"*/; do
      metadata="$container.com.apple.mobile_container_manager.metadata.plist"
      [ -f "$metadata" ] || continue
      if [ "$(plutil -extract MCMMetadataIdentifier raw "$metadata" 2>/dev/null)" = app.daythread.Daythread ]; then
        rm -f "$container/Library/Application Support/Daythread/test-"*
      fi
    done
  fi
  exit $status
}
trap clean_up EXIT
trap 'exit 130' INT TERM

# An explicit import source, so a .daythread-local/ next to the checkout is never read: an empty workspace.
(cd "$repo" && node --no-warnings --input-type=module -e "
  const { createEmptyWorkspace } = await import('./src/domain/workspace.ts')
  process.stdout.write(JSON.stringify(createEmptyWorkspace()))
") >"$work/empty.json"

# start <name> <port> <environment...>: the dev server from this checkout, its own process (no npx in between).
start() {
  name=$1 port=$2
  shift 2
  mkdir -p "$work/$name"
  (
    cd "$repo"
    exec env -u DAYTHREAD_AUTH DAYTHREAD_STORAGE=sqlite DAYTHREAD_SQLITE_PATH="$work/$name/workspace.sqlite" \
      DAYTHREAD_LOCAL_DATA_PATH="$work/empty.json" "$@" \
      node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$port" --strictPort
  ) >"$work/$name.log" 2>&1 &
  pids="$pids $!"
}

# wait_for <port> <status>: until the account route answers with that status.
wait_for() {
  tries=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/v1/account")" = "$2" ]; do
    tries=$((tries + 1))
    if [ $tries -gt 120 ]; then
      echo "ui-test: the server on $1 did not answer $2; its log:" >&2
      cat "$work"/*.log >&2
      exit 1
    fi
    sleep 0.5
  done
}

start today $today_port DAYTHREAD_AUTH=off
start sign-in $sign_in_port SUPABASE_URL=http://127.0.0.1:9 SUPABASE_PUBLISHABLE_KEY=unused
start morning $morning_port DAYTHREAD_AUTH=off
wait_for $today_port 200
wait_for $sign_in_port 401
wait_for $morning_port 200

# Today's page in the workspace's own zone, and its to-dos; prints the day, a tab, and the title the app shows for it.
seeded=$(node --no-warnings --input-type=module - "http://127.0.0.1:$today_port" <<'EOF'
const base = process.argv[2]
const read = async () => {
  const reply = await fetch(`${base}/api/v1/workspace`)
  if (!reply.ok) throw new Error(`workspace: ${reply.status}`)
  return reply.json()
}
const send = async (operationId, action) => {
  const { workspace, owner } = await read()
  const basis = { baseRevision: workspace.revision, ownRevisions: [], readsBeyond: false }
  const body = { operationId, expectedRevision: workspace.revision, action, expectedOwner: owner, basis }
  const reply = await fetch(`${base}/api/v1/commands`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const outcome = await reply.json()
  if (outcome.status !== 'applied') throw new Error(`${action.type}: ${JSON.stringify(outcome)}`)
  return outcome.receipt
}
// The id of the to-do with these words, read from the workspace as any client reads it.
const taskId = async title => {
  const { workspace } = await read()
  const task = workspace.tasks.find(task => task.title === title)
  if (!task) throw new Error(`no to-do "${title}"`)
  return task.id
}
const { workspace } = await read()
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: workspace.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const at = new Date().toISOString()
const todayPage = `day:${today}`
await send('ui-test-day', { type: 'ensure-day', date: today })
for (const [index, title] of ['Water the plants', 'Tick me', 'Tick me offline', 'Tick me twice'].entries()) {
  await send(`ui-test-task-${index}`, { type: 'add-task', pageId: todayPage, title })
}

// Slice 1c: rows with marks, each planned today on today's page, and one to-do for each test that acts on a row.
// Nothing here plans a to-do for today with `plan-task`: that is a choice, and it would restart Since.
const planned = (title, dates = {}) => ({ type: 'add-task', pageId: todayPage, title, plannedOn: today, ...dates })
// First, so its row is on the screen with the page at its top: the notice is seen there over an unscrolled page.
await send('ui-test-notice', planned('Show the notice'))
await send('ui-test-due', planned('Pay the rent', { deadlineOn: addDays(today, 1) }))
await send('ui-test-was-due', planned('File the return', { deadlineOn: addDays(today, -3) }))
await send('ui-test-start-due', planned('Book the venue', {
  attentionOn: addDays(today, 4), deadlineOn: addDays(today, 10),
}))
await send('ui-test-repeat-task', planned('Water the fern'))
await send('ui-test-repeat', {
  type: 'set-todo-repeat', taskId: await taskId('Water the fern'), today, at,
  repeat: { every: 'week', interval: 1, from: 'schedule' },
})
await send('ui-test-blocker', planned('Buy paint'))
await send('ui-test-blocked', planned('Paint the fence'))
await send('ui-test-link', {
  type: 'link-tasks', taskId: await taskId('Paint the fence'), add: [await taskId('Buy paint')], remove: [], at,
})
await send('ui-test-cancelled-task', planned('Return the parcel'))
await send('ui-test-cancelled', { type: 'task-status', taskId: await taskId('Return the parcel'), status: 'cancelled', today })

// Carried seven days: made eight days ago on that day's page, then put on today's page by today's draft, as the
// server's own carrying does, so its plan row today is the draft's.
const eightDaysAgo = addDays(today, -8)
await send('ui-test-carried-day', { type: 'ensure-day', date: eightDaysAgo })
await send('ui-test-carried-task', {
  type: 'add-task', pageId: `day:${eightDaysAgo}`, title: 'Renew the passport', plannedOn: eightDaysAgo,
})
const carried = await taskId('Renew the passport')
const firstBlock = await (async () => {
  const { workspace } = await read()
  const page = workspace.pages.find(page => page.id === todayPage)
  return JSON.parse(page.document)[0].id
})()
await send('ui-test-carry-draft', {
  type: 'set-draft', pageId: todayPage, status: 'ready', moreOpen: [], allowedTaskIds: [carried],
  items: [{ id: 'carry-0', anchor: firstBlock, place: 'after', taskId: carried, source: 'model', state: 'open' }],
})
await send('ui-test-carry', { type: 'apply-draft', pageId: todayPage, itemIds: ['carry-0'], today })

for (const [index, title] of ['Move me', 'Set me aside', 'Cancel me', 'Undo me', 'Pick a day for me'].entries()) {
  await send(`ui-test-act-${index}`, planned(title))
}
const title = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
}).format(new Date(`${today}T00:00:00Z`))
process.stdout.write(`${today}\t${title}`)
EOF
)
today=$(printf '%s' "$seeded" | cut -f1)
title=$(printf '%s' "$seeded" | cut -f2)
echo "ui-test: seeded today ($title) on $today_port"

# The morning (slice 1d.1) on its own server, through the server's own commands and saves. Run from the repository
# root so it can import the web's `pageContentKey`, which a save of a page names.
(cd "$repo" && node --no-warnings --input-type=module - "http://127.0.0.1:$morning_port" <<'MORNING'
const { pageContentKey } = await import('./src/domain/editor-document.ts')
const base = process.argv[2]
const read = async () => {
  const reply = await fetch(`${base}/api/v1/workspace`)
  if (!reply.ok) throw new Error(`workspace: ${reply.status}`)
  return reply.json()
}
// A command (`commands`) or a page's save (`saves`), on the workspace as the server has it now.
const post = async (route, operationId, action) => {
  const { workspace, owner } = await read()
  const body = { operationId, expectedRevision: workspace.revision, action, expectedOwner: owner }
  if (route === 'commands') body.basis = { baseRevision: workspace.revision, ownRevisions: [], readsBeyond: false }
  const reply = await fetch(`${base}/api/v1/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const outcome = await reply.json()
  if (!reply.ok || (outcome.status !== undefined && outcome.status !== 'applied')) {
    throw new Error(`${action.type}: ${reply.status} ${JSON.stringify(outcome)}`)
  }
}
const send = (operationId, action) => post('commands', operationId, action)
const taskId = async title => {
  const { workspace } = await read()
  const task = workspace.tasks.find(task => task.title === title)
  if (!task) throw new Error(`no to-do "${title}"`)
  return task.id
}
// Saves the page once, its blocks as `change` gives them back.
const save = async (operationId, pageId, change) => {
  const { workspace } = await read()
  const page = workspace.pages.find(page => page.id === pageId)
  if (!page) throw new Error(`no page ${pageId}`)
  const document = JSON.stringify(change(JSON.parse(page.document)))
  await post('saves', operationId, { type: 'save-editor', pageId, expectedContent: pageContentKey(page), document })
}
const { workspace } = await read()
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: workspace.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const todayPage = `day:${today}`, yesterdayPage = `day:${addDays(today, -1)}`
await send('morning-today', { type: 'ensure-day', date: today })
await send('morning-yesterday', { type: 'ensure-day', date: addDays(today, -1) })

// The events line: `Lunch with Kathy · 10:30 AM Standup with Lu`, `+1 more` (all-day first, then by the time).
const text = words => ({ type: 'text', text: words, styles: {} })
const chip = (eventId, time) => ({ type: 'dateMention', props: { eventId, date: today, ...(time ? { time } : {}) } })
const line = (id, content, type = 'bulletListItem') => ({ id, type, props: {}, content, children: [] })
// Under the template's own `Events` heading, which the events line scrolls to; lines of notes at the end, so the page
// is long enough for that heading to reach the top of the screen.
await save('morning-events', todayPage, blocks => {
  const heading = blocks.findIndex(block => block.type === 'heading' && block.content?.[0]?.text === 'Events')
  if (heading < 0) throw new Error("today's template has no Events heading")
  const events = [
    line('morning-standup', [text('Standup with Lu '), chip('morning-standup', '10:30')]),
    line('morning-dentist', [text('Dentist '), chip('morning-dentist', '15:00')]),
  ]
  const notes = Array.from({ length: 16 }, (_, index) => line(`morning-note-${index}`, [text(`A note, ${index + 1}`)]))
  return [...blocks.slice(0, heading + 1), ...events, ...blocks.slice(heading + 1), ...notes]
})
await save('morning-lunch', yesterdayPage, blocks => [
  ...blocks, line('morning-lunch', [text('Lunch with Kathy '), chip('morning-lunch')], 'paragraph'),
])

// Due soon on today: their rows are on yesterday's page, so none has a row on today's.
await send('morning-due', { type: 'add-task', pageId: yesterdayPage, title: 'Pay the gas bill', deadlineOn: today })
await send('morning-start', { type: 'add-task', pageId: yesterdayPage, title: 'Start the essay', attentionOn: today })
await send('morning-long', {
  type: 'add-task', pageId: yesterdayPage, title: 'Call the insurance company about the claim from last spring',
  deadlineOn: today,
})
// Due soon on yesterday: due the day before it, its row on today's page (so it is not in today's Due soon).
await send('morning-past', {
  type: 'add-task', pageId: todayPage, title: 'Return the library books', deadlineOn: addDays(today, -2),
})

// Not today · 3, each planned today and then set aside, so its row leaves today's page: one for each test that acts.
for (const [index, title] of ['Fix the bike', 'Bring me back later', 'Plan me for later'].entries()) {
  await send(`morning-plan-${index}`, { type: 'add-task', pageId: todayPage, title, plannedOn: today })
  await send(`morning-aside-${index}`, { type: 'not-today', taskId: await taskId(title), date: today })
}
MORNING
)
echo "ui-test: seeded the morning on $morning_port"

if [ "${1:-}" = --serve ]; then
  echo "ui-test: serving on $today_port (sign-in off), $sign_in_port (sign-in on) and $morning_port (the morning);" \
    "Ctrl-C stops them"
  wait
  exit 0
fi

TEST_RUNNER_DAYTHREAD_SERVER_URL="http://127.0.0.1:$today_port" \
TEST_RUNNER_DAYTHREAD_TODAY="$today" \
TEST_RUNNER_DAYTHREAD_SIGN_IN_SERVER_URL="http://127.0.0.1:$sign_in_port" \
TEST_RUNNER_DAYTHREAD_MORNING_SERVER_URL="http://127.0.0.1:$morning_port" \
  xcodebuild test -project "$native/Daythread.xcodeproj" -scheme Daythread \
  -destination "$destination" -derivedDataPath "$native/DerivedData" "$@"
