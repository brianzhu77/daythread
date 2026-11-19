# Simulator pass for #217 (swipe a notice away) and #218 (Move to a day), Jazz, Nov 19.
# Env: JAZZ_APPIUM, JAZZ_SID_FILE (own Appium session), JAZZ_PORT, JAZZ_STORE (throwaway), JAZZ_REPO, MODE=safari|hs
import sys, os, json, time, subprocess, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wd import *
PORT = os.environ['JAZZ_PORT']; STORE = os.environ['JAZZ_STORE']; REPO = os.environ['JAZZ_REPO']; MODE = os.environ.get('MODE', 'safari')
OUT = os.environ.get('JAZZ_OUT', '/tmp')
fails = 0
def ok(v, what):
    global fails; fails += 0 if v else 1; print('PASS' if v else 'FAIL', MODE, what, flush=True)
def reseed():
    subprocess.run(['node', '--no-warnings', 'tests/evidence/draft-snooze/seed.ts', STORE, datetime.date.today().isoformat()], cwd=REPO, capture_output=True)
def web():
    want = 'com.apple.mobilesafari' if MODE == 'safari' else 'com.apple.SafariViewService'
    for _ in range(40):
        cs = [c for c in contexts() if isinstance(c, dict) and PORT in (c.get('url') or '') and c.get('bundleId') == want]
        if cs:
            ctx(cs[-1]['id'])
            try: js('return 1'); return
            except Exception: pass
        time.sleep(0.5)
    raise SystemExit('no web view')
def origin():
    ctx('NATIVE_APP'); wv = call('element', {'using': 'class name', 'value': 'XCUIElementTypeWebView'})['value']
    return call('element/' + wv['element-6066-11e4-a52e-4f735466cecf'] + '/rect', method='GET')['value']
def rect(sel, i=0):
    web(); return js("const e=document.querySelectorAll(arguments[0])[arguments[1]]; if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}", [sel, i])
def pt(sel, dx=0.5, dy=0.5, i=0):
    r = rect(sel, i); assert r, sel; o = origin(); return o['x'] + r['x'] + r['w'] * dx, o['y'] + r['y'] + r['h'] * dy
def tap(sel, dx=0.5, dy=0.5, i=0):
    x, y = pt(sel, dx, dy, i); mobile('tap', {'x': x, 'y': y})
def drag(sel, ddx, ddy, dur, dx=0.5, dy=0.5):
    x, y = pt(sel, dx, dy); ctx('NATIVE_APP')
    mobile('dragFromToForDuration', {'fromX': x, 'fromY': y, 'toX': x + ddx, 'toY': y + ddy, 'duration': dur})
def nel(pred):
    ctx('NATIVE_APP')
    for _ in range(10):
        v = call('elements', {'using': '-ios predicate string', 'value': pred})['value']
        if v: return v[0]['element-6066-11e4-a52e-4f735466cecf']
        time.sleep(0.3)
    return None
def nrect(pred):
    e = nel(pred); return call('element/' + e + '/rect', method='GET')['value'] if e else None
def ntap(pred, dx=0.5, dy=0.5):
    r = nrect(pred); assert r, pred; mobile('tap', {'x': r['x'] + r['width'] * dx, 'y': r['y'] + r['height'] * dy}); return r
def ndrag(pred, ddx, ddy, dur, dx=0.5, dy=0.5):
    r = nrect(pred); assert r, pred; x, y = r['x'] + r['width'] * dx, r['y'] + r['height'] * dy
    mobile('dragFromToForDuration', {'fromX': x, 'fromY': y, 'toX': x + ddx, 'toY': y + ddy, 'duration': dur})
def nvdrag(pred, ddx, ddy, velocity, dx=0.5, dy=0.5, press=0.15, hold=0.1):
    # XCUITest's dragFromToForDuration holds first, then moves fast; this one moves at `velocity` pt/s.
    r = nrect(pred)
    if not r: return False
    x, y = r['x'] + r['width'] * dx, r['y'] + r['height'] * dy
    mobile('dragFromToWithVelocity', {'pressDuration': press, 'holdDuration': hold, 'velocity': velocity, 'fromX': x, 'fromY': y, 'toX': x + ddx, 'toY': y + ddy}); return True
def nokb():
    web(); js("document.activeElement && document.activeElement.blur && document.activeElement.blur()"); time.sleep(0.6)
TITLE = "type == 'XCUIElementTypeStaticText' AND (label BEGINSWITH 'Skipped' OR label BEGINSWITH 'Moved')"
UNDO = "type == 'XCUIElementTypeButton' AND label == 'Undo'"
DAY = lambda n: f"type == 'XCUIElementTypeButton' AND label BEGINSWITH 'Move' AND label CONTAINS '{n}'"
def notices():
    web(); return js("return [...document.querySelectorAll('[data-slot=toast]:not([data-exiting=true])')].map(e=>e.innerText.replace(/\\s+/g,' ').trim())")
def bands():
    web(); return js("return [...document.querySelectorAll('.draft-band')].map(e=>e.innerText.split('\\n')[0])")
def open_today():
    reseed(); web(); js("location.href = arguments[0]", [f'http://127.0.0.1:{PORT}/']); time.sleep(4); web()
    for _ in range(40):
        if js("return document.querySelectorAll('.draft-band').length") > 0: break
        time.sleep(0.5)
    time.sleep(1)
def clear():
    web(); js("document.querySelectorAll('[data-slot=toast] .toast__close-button').forEach(b=>b.click())")
    for _ in range(20):
        if not js("return document.querySelectorAll('[data-slot=toast]').length"): break
        time.sleep(0.3)
def skip(name):
    clear()
    # the band's ✕ (always visible on a phone)
    nokb(); ntap(f"type == 'XCUIElementTypeButton' AND label BEGINSWITH 'Skip {name}'"); time.sleep(1.2)
def snap(name): ctx('NATIVE_APP'); shot(f'{OUT}/{MODE}-{name}.png')

# 1. ✕ → notice with the day row; look
open_today(); skip('Tech Design Review')
n = notices(); ok(n and n[0].startswith('Skipped Undo Move to'), f'✕ on a to-do: {n}'); snap('1-skipped')
r = nrect(DAY('Nov')); ok(r and r['height'] >= 44, f'day button {r and round(r["height"])} pt tall (native)')
# 2. swipe up 44 pt slowly: goes; the skip stays
nvdrag(TITLE, 0, -44, 60); time.sleep(0.9)
ok(not notices() and not any('Fraud' in b for b in bands()), f'slow swipe up 44 pt (60 pt/s) closes it, skip kept: {notices()}')
# 3. 20 pt slowly: springs back
skip('Umbrella'); nvdrag(TITLE, 0, -20, 40); time.sleep(0.9)
ok(len(notices()) == 1, f'slow 20 pt (40 pt/s) springs back: {notices()}')
# 4. flick 18 pt fast: goes
if not notices(): skip('TRV')
nvdrag(TITLE, 0, -18, 1500, press=0.0, hold=0.0); time.sleep(0.9)
ok(not notices(), f'18 pt flick (1500 pt/s) closes it: {notices()}')
# 5. press on a day button and slide 14 pt sideways: no move, notice stays
open_today(); skip('TRV')
nvdrag(DAY('Mon'), 14, 0, 80); time.sleep(1)
n = notices(); ok(n and n[0].startswith('Skipped') and not any(x.startswith('Moved') for x in n), f'slide sideways on a day button: no move ({n})')
# 6. press on Undo and slide up 44 pt: closes, Undo not fired
nvdrag(UNDO, 0, -44, 200); time.sleep(1)
ok(not notices() and not any('TRV' in b for b in bands()), f'swipe from Undo closes without undoing: bands {bands()}')
# 7. Mon → Moved; Undo → Skipped again; Undo → back
skip('Umbrella'); ntap(DAY('Mon')); time.sleep(1.5)
n = notices(); ok(n and n[0].startswith('Moved to Mon'), f'Mon: {n}'); snap('7-moved')
ntap(UNDO); time.sleep(1.5); n = notices(); ok(n and n[0].startswith('Skipped'), f'Undo move: {n}')
ntap(UNDO); time.sleep(1.5); ok(any('Umbrella' in b for b in bands()), f'Undo: back in suggestions {bands()}')
# 8. Pick…: the native calendar comes up, nothing is chosen for him, the notice waits; a tapped day moves it
skip('Umbrella'); ntap(DAY('another day')); time.sleep(2); snap('8-picker')
ctx('NATIVE_APP'); src = call('source')['value']
ok('XCUIElementTypeDatePicker' in src, 'Pick… opens the native calendar')
time.sleep(10); n = notices(); ok(any(x.startswith('Skipped') for x in n) and not any(x.startswith(('Moved', 'Not moved')) for x in n), f'12 s later nothing was picked for him, notice still up: {n}'); snap('8-picker-12s')
ntap("type == 'XCUIElementTypeButton' AND label CONTAINS 'November 24'"); time.sleep(2)
n = notices(); ok(n and n[0].startswith('Moved to Tue, Nov 24'), f'a tapped day (Tue 24) moves it: {n}')
ctx('NATIVE_APP'); ok('XCUIElementTypeDatePicker' not in call('source')['value'], 'and the calendar closes')
# 9. Dismiss on a mix at phone width: row under its label, inside the notice
open_today(); clear(); nokb(); ntap("type == 'XCUIElementTypeButton' AND label == 'Dismiss'"); time.sleep(1.2)
n = notices(); ok(n and n[0].startswith('Skipped 4 Undo Move 3 to-dos to'), f'Dismiss on a mix: {n}'); snap('9-mix')
web(); fit = js("const t=document.querySelector('[data-slot=toast]').getBoundingClientRect(); return [...document.querySelectorAll('.toast-row-button')].every(b=>{const r=b.getBoundingClientRect(); return r.right<=t.right+.5 && r.bottom<=t.bottom+.5})")
ok(fit, 'mix row: every day button inside the notice')
print('DONE', MODE, 'fails', fails)
