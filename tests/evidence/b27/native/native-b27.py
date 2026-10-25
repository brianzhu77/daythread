# B27 native check (Simulator iPhone 17, iOS 26.4, zh_Hans pinyin + en_US keyboards): real keyboard taps in Mobile
# Safari against a disposable store. Lead 466456d0's path.
from steps import *
import sys
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rb-b27n'
res = []
def log(ok, what, detail=''):
    res.append(ok); print(('ok   ' if ok else 'FAIL ') + what + (f' ({detail})' if detail else ''))
def current_keys():
    native(); r = call('elements', {'using': '-ios predicate string', 'value': "type == 'XCUIElementTypeKey'"})
    return [call(f"element/{e.get('ELEMENT') or e.get('element-6066-11e4-a52e-4f735466cecc')}/attribute/label", method='GET').get('value') for e in r['value']]
def ensure_pinyin():
    if '数字' not in current_keys(): click(find("label ==[c] 'Next keyboard'")); time.sleep(0.8)
def ensure_english():
    if 'numbers' not in current_keys(): click(find("label ==[c] 'Next keyboard'")); time.sleep(0.8)
web(); call('url', {'url': 'http://127.0.0.1:3571/day/2026-10-24'}); time.sleep(3)
js('localStorage.clear(); sessionStorage.clear(); return 1'); call('url', {'url': 'http://127.0.0.1:3571/day/2026-10-24'}); time.sleep(4)
js('const b=[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Later"); if(b) b.click(); return 1')
tap_line(LINE); ensure_pinyin()
# 1. ＠ from the Chinese keyboard, then pinyin 明天: the list reads it once the word is committed.
word('kaihui'); time.sleep(0.4); click(find("label == '开会'")); time.sleep(0.5)
key('数字'); key('@'); time.sleep(0.8)
s = state(); log(len(s['menu']) == 4, '@ from the Chinese keyboard after 开会 opens the list', json.dumps(s['menu'], ensure_ascii=False))
word('mingtian'); time.sleep(0.5); click(find("label == '明天'")); time.sleep(1.2)
s = state(); log(len(s['menu']) == 1 and 'All day' in s['menu'][0], 'after picking 明天 the list reads tomorrow', json.dumps(s['menu'], ensure_ascii=False))
native(); shot(f'{out}/native-mingtian-list.png')
# 2. Return on the keyboard makes the chip.
click(find("label == '换行'")); time.sleep(1.2)
s = state(); log('Tomorrow' in s['chips'] and any(l.startswith('开会Tomorrow') for l in s['lines']), 'Return on the keyboard makes the chip', json.dumps(s['lines'], ensure_ascii=False))
native(); shot(f'{out}/native-chip.png')
# 3. Toolbar Undo gives back the typed text; Redo brings the chip back.
click(find("label == 'Undo'")); time.sleep(1.2)
s = state(); log(any(l == '开会@明天' for l in s['lines']) and 'Tomorrow' not in s['chips'], 'toolbar Undo gives back 开会@明天', json.dumps(s['lines'], ensure_ascii=False))
native(); click(find("label == 'Redo'")); time.sleep(1.2)
s = state(); log('Tomorrow' in s['chips'], 'Redo brings the chip back', json.dumps(s['chips'], ensure_ascii=False))
# 4. ＠老王: a committed word that isn't a date leaves the text.
web(); js('const e=[...document.querySelectorAll(".bn-editor .bn-inline-content")].find(e=>e.textContent.startsWith("开会")); const r=document.createRange(); r.selectNodeContents(e); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return 1'); time.sleep(0.4)
native(); click(find("label == '换行'")); time.sleep(0.6)
key('数字'); key('@'); time.sleep(0.6); word('laowang'); time.sleep(0.5); click(find("label == '老王'")); time.sleep(1.2)
s = state(); log(not s['menu'] and any(l == '@老王' for l in s['lines']), '@老王: no list, text as typed', json.dumps(s['lines'], ensure_ascii=False))
# 5. English keyboard: Dentist @nov 20 3pm, Return.
native(); click(find("label == '换行'")); time.sleep(0.5); ensure_english()
keys('Dentist '); time.sleep(0.4); key('numbers'); key('@'); time.sleep(0.4)
if 'letters' in current_keys(): key('letters')
keys('nov 20 3pm'); time.sleep(0.8)
s = state(); log(len(s['menu']) == 1 and '3:00 PM' in s['menu'][0], 'English keyboard: @nov 20 3pm reads with its time', json.dumps(s['menu'], ensure_ascii=False))
native(); click(find("label ==[c] 'return'")); time.sleep(1.2)
s = state(); log(any(c.startswith('Fri, Nov 20') for c in s['chips']), 'Return makes the Nov 20 chip', json.dumps(s['chips'], ensure_ascii=False))
native(); shot(f'{out}/native-nov20-chip.png')
# 6. Keyboard down: today's events line leads the strip.
click(find("label == 'Hide keyboard'")); time.sleep(1.5)
web(); js('scrollTo(0,0); return 1'); time.sleep(0.8)
strip = js('const e=document.querySelector(".facts .today-events"); if(!e) return null; const r=e.getBoundingClientRect(); return [e.textContent, r.top, r.bottom, innerHeight]')
log(bool(strip) and strip[2] < strip[3], "keyboard down: today's events line is in the strip, on screen", json.dumps(strip, ensure_ascii=False))
native(); shot(f'{out}/native-strip.png')
# 7. Nov 20 (no page yet) shows the rows, written nowhere.
time.sleep(2)
web(); call('url', {'url': 'http://127.0.0.1:3571/day/2026-11-20'}); time.sleep(3)
rows = js('return [...document.querySelectorAll(".future-day-events .day-event-title")].map(e=>e.textContent)')
log('PAC Lunch' in (rows or []) and 'Dentist' in (rows or []), 'Nov 20 with no page lists PAC Lunch and Dentist', json.dumps(rows))
native(); shot(f'{out}/native-nov20.png')
print('all passed' if all(res) else f'{res.count(False)} FAILED')
