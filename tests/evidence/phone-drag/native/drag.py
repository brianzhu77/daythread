# Phone drag in real Mobile Safari (iOS 26.4 Simulator): long-press-and-drag gestures by XCUITest on a seeded day.
import json, subprocess, sys, time
sys.path.insert(0, '/tmp/lead-native')
from wd import call, js, ctx, contexts, shot, go
BASE, STORE, TREE, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
today = subprocess.check_output(['date', '+%Y-%m-%d'], env={'TZ': 'America/Vancouver'}).decode().strip()
def seed(): subprocess.run(f'rm -f {STORE} {STORE}-wal {STORE}-shm && node --no-warnings tests/evidence/phone-drag/seed.ts {STORE} {today}', shell=True, cwd=TREE, check=True, capture_output=True)
def order():
    data = json.loads(subprocess.check_output(['sqlite3', STORE, 'select data from workspace']))
    doc = json.loads(next(p for p in data['pages'] if p['id'] == f'day:{today}')['document'])
    return ' '.join(f"{n['id']}({' '.join(c['id'] for c in n['children'])})" if n.get('children') else n['id'] for n in doc if not n['id'].startswith('z'))
fails = 0
def check(ok, what, extra=None):
    global fails
    if not ok: fails += 1
    print('PASS' if ok else 'FAIL', what, json.dumps(extra) if extra is not None else '')
def web():
    # The page on screen: Safari may hold another, hidden one, which gestures never reach.
    ids = [x if isinstance(x, str) else x.get('id', '') for x in contexts()]
    for i in reversed([i for i in ids if 'WEBVIEW' in i]):
        ctx(i)
        if js("return document.visibilityState === 'visible'"): return

def native(): ctx('NATIVE_APP')
def webview_top():
    # Where CSS y 0 is on screen: a line's words, read natively and from the page (62 pt under this Safari's status bar).
    web(); css = js("const b = [...document.querySelectorAll('.bn-block-outer > .bn-block')].find(e => e.textContent.trim() === 'Bravo one').getBoundingClientRect(); return b.y + b.height / 2")
    native(); r = call('elements', {'using': '-ios predicate string', 'value': "label == 'Bravo one' OR value == 'Bravo one'"}); el = list(r['value'][0].values())[0]
    n = call(f'element/{el}/rect', method='GET')['value']
    return {'x': 0, 'y': round(n['y'] + n['height'] / 2 - css)}
def rect_of(id):
    web(); return js("const b = document.querySelector(`.bn-block-outer[data-id='${arguments[0]}'] > .bn-block`).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: Math.min(b.height, 30) }", [id])
def open_day():
    seed(); web(); go(f'{BASE}/'); time.sleep(4); js('localStorage.clear()'); go(f'{BASE}/'); time.sleep(5); js('scrollTo(0, 0)'); time.sleep(1)
def drag(from_id, to_id, to_edge, hold=0.6, top=None):
    a, b = rect_of(from_id), rect_of(to_id); wv = top or webview_top()
    fx, fy = wv['x'] + a['x'] + min(120, a['w'] / 2), wv['y'] + a['y'] + a['h'] / 2
    ty = wv['y'] + b['y'] + (3 if to_edge == 'top' else b['h'] - 3)
    native(); return call('execute/sync', {'script': 'mobile: dragFromToForDuration', 'args': [{'duration': hold, 'fromX': fx, 'fromY': fy, 'toX': fx, 'toY': ty}]})
def focused():
    web(); return js('return Boolean(document.activeElement && document.activeElement.isContentEditable)')

open_day()
wv = webview_top()
print('INFO webview', wv)
r = drag('a2', 'b1', 'bottom', top=wv); time.sleep(2.5)
native(); shot(f'{OUT}/native-after-drop.png')
check(order() == 'ha a1 a3 hb b1 a2 b2(b21) t1', 'a long press and drag lands where the finger let go', order())
check(not focused(), 'and no keyboard comes up')
web(); sel = js('return String(getSelection())'); check(not sel, 'and no text is left selected', sel)
drag('t1', 'a1', 'top', top=wv); time.sleep(2.5)
check(order() == 'ha t1 a1 a3 hb b1 a2 b2(b21)', 'a to-do moves up, above the line it was let go on', order())
drag('hb', 'ha', 'top', top=wv); time.sleep(2.5)
check(order() == 'hb b1 a2 b2(b21) ha t1 a1 a3', 'a heading takes its section', order())
# Typing first: the keyboard is up and the caret is in a line; a hold on another line still picks it up.
open_day()
a = rect_of('a1'); native(); call('execute/sync', {'script': 'mobile: tap', 'args': [{'x': wv['x'] + a['x'] + 60, 'y': wv['y'] + a['y'] + a['h'] / 2}]}); time.sleep(1.5)
check(focused(), 'a tap places the caret, with the keyboard')
native(); shot(f'{OUT}/native-typing.png')
drag('a3', 'a1', 'top', top=wv); time.sleep(2.5)
native(); shot(f'{OUT}/native-typing-after.png')
check(order() == 'ha a3 a1 a2 hb b1 b2(b21) t1', 'while typing, a hold on another line moves it where let go', order())
check(focused(), 'and the keyboard stays up, as it was')
# In the line being typed in, a long press is iOS's own: no drag, nothing moves.
a = rect_of('a1'); native(); call('execute/sync', {'script': 'mobile: tap', 'args': [{'x': wv['x'] + a['x'] + 30, 'y': wv['y'] + a['y'] + a['h'] / 2}]}); time.sleep(1.2)
before = order(); drag('a1', 'b1', 'bottom', top=wv); time.sleep(2.5)
check(order() == before, "in the line being typed in, a long press doesn't drag it", order())
print(f'[native drag] fail {fails}')
