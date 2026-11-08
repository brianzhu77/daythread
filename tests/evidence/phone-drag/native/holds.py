import json, subprocess, sys, time
sys.path.insert(0, '/tmp/lead-native')
from wd import call, js, ctx, contexts, go
BASE, STORE, TREE = sys.argv[1:4]
today = subprocess.check_output(['date', '+%Y-%m-%d'], env={'TZ': 'America/Vancouver'}).decode().strip()
def web():
    # The page on screen: Safari may hold another, hidden one, which gestures never reach.
    ids = [x if isinstance(x, str) else x.get('id', '') for x in contexts()]
    for i in reversed([i for i in ids if 'WEBVIEW' in i]):
        ctx(i)
        if js("return document.visibilityState === 'visible'"): return

def rect(id): web(); return js("const b = document.querySelector(`.bn-block-outer[data-id='${arguments[0]}'] > .bn-block`).getBoundingClientRect(); return { x: b.x, y: b.y, h: Math.min(b.height, 30) }", [id])
def order():
    data = json.loads(subprocess.check_output(['sqlite3', STORE, 'select data from workspace'])); doc = json.loads(next(p for p in data['pages'] if p['id'] == f'day:{today}')['document'])
    return ' '.join(n['id'] for n in doc if not n['id'].startswith('z'))
for hold in [0.5, 0.6, 0.8, 1.0, 1.0, 1.2, 1.2, 1.5, 2.0, 3.0]:
    subprocess.run(f'rm -f {STORE} {STORE}-wal {STORE}-shm && node --no-warnings tests/evidence/phone-drag/seed.ts {STORE} {today}', shell=True, cwd=TREE, check=True, capture_output=True)
    web(); go(f'{BASE}/'); time.sleep(5); js('scrollTo(0, 0)'); time.sleep(1)
    a, b = rect('a2'), rect('b1')
    ctx('NATIVE_APP'); call('execute/sync', {'script': 'mobile: dragFromToForDuration', 'args': [{'duration': hold, 'fromX': a['x'] + 100, 'fromY': 62 + a['y'] + a['h'] / 2, 'toX': a['x'] + 100, 'toY': 62 + b['y'] + b['h'] - 3}]})
    time.sleep(2.5); web(); sel = js('return String(getSelection())')
    print(hold, order(), 'selected:', repr(sel))
