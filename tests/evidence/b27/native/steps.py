from wd import *
import time, json, sys
OFFSET = 62  # web content top in points (measured: Good Stuffs heading CSS y 344 vs native 406)
def web():
    cs = contexts(); ctx([c for c in cs if c['id'] != 'NATIVE_APP'][-1]['id'])
def native(): ctx('NATIVE_APP')
LINE = '.bn-block-outer[data-id="day:2026-10-24:good-stuffs:template:0"] .bn-inline-content'
def rect_of(sel, center=False):
    return js('const e=document.querySelector(arguments[0]); if(!e) return null; if(arguments[1]) e.scrollIntoView({block:"center"}); const r=e.getBoundingClientRect(); return [r.left,r.top,r.width,r.height]', [sel, center])
def tap_line(sel):
    web(); rect_of(sel, True); time.sleep(0.6); r = rect_of(sel); native(); tap(r[0] + 20, r[1] + r[3] / 2 + OFFSET); time.sleep(1.2)
def state():
    web()
    return js('const m=[...document.querySelectorAll(".date-menu [role=option], .date-menu .date-menu-hint")].map(e=>e.textContent.trim()); const lines=[...document.querySelectorAll(".bn-editor .bn-inline-content")].map(e=>e.textContent).filter(t=>/[@＠]|Tomorrow|Today|Nov|开会/.test(t)); const chips=[...document.querySelectorAll(".bn-editor .date-ref")].map(e=>e.textContent); return {menu:m, lines:lines, chips:chips, active: document.activeElement && document.activeElement.className.slice(0,30)}')
if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'open':
        web(); call('url', {'url': 'http://127.0.0.1:3571/day/2026-10-24'}); time.sleep(4)
        print(js('const b=[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Later"); if(b) b.click(); return !!b'))
    elif cmd == 'tapline': tap_line(LINE); native(); shot('/tmp/rb-b27n/s.png'); print(state())
    elif cmd == 'state': print(json.dumps(state(), ensure_ascii=False))
    elif cmd == 'shot': native(); shot(sys.argv[2])

def keys(text):
    native(); return call('execute/sync', {'script': 'mobile: keys', 'args': [{'keys': list(text)}]})

def key(label):
    native(); el = find(f"type == 'XCUIElementTypeKey' AND label == '{label}'") or find(f"label == '{label}'")
    if not el: raise SystemExit(f'no key {label}')
    click(el); time.sleep(0.15)
def word(letters):
    for ch in letters: key(ch)
