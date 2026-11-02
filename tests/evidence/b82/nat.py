# B82 native helpers. JAZZ_PORT + JAZZ_STORE are required (shared Mac); JAZZ_UDID is your own Simulator.
import sys,json,time,subprocess,re,os; sys.path.insert(0,'tests/evidence/b82')
from wd import *
UDID=os.environ.get('JAZZ_UDID','')
PORT=os.environ.get('JAZZ_PORT'); STORE=os.environ.get('JAZZ_STORE')
if not PORT or not STORE: raise SystemExit('set JAZZ_PORT and JAZZ_STORE')
fails=0
def ok(v,what):
    global fails; fails+=0 if v else 1; print(('PASS' if v else 'FAIL'),what,flush=True)
def web():
    for _ in range(40):
        cs=[c for c in contexts() if isinstance(c,dict) and PORT in (c.get('url') or '') and ((c.get('bundleId')=='com.apple.mobilesafari')==bool(os.environ.get('SAFARI')))]
        if cs:
            ctx(cs[-1]['id'])
            try: js('return 1'); return cs[-1]
            except Exception: pass
        time.sleep(0.5)
    raise SystemExit('no web view')
def keyboard():
    ctx('NATIVE_APP'); s=call('source')['value']; return bool(re.search(r'<XCUIElementTypeKeyboard[^>]*visible="true"',s))
def home(): ctx('NATIVE_APP'); mobile('pressButton',{'name':'home'})
def launch(): subprocess.run(['python3','tests/evidence/b82/launch.py'])
def value(row,prop):
    d=json.loads(subprocess.run(['sqlite3',STORE,'select data from workspace'],capture_output=True,text=True).stdout)
    p=[x for x in d['pages'] if x['id']==row][0]; return p.get('values',{}).get(prop) if prop!='title' else p.get('title')
def rect_js(sel): web(); return js("const e=document.querySelector(arguments[0]); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height, vv:visualViewport.height, iw:innerWidth}",[sel])
def tap_web(sel, dx=0.5, dy=0.5):
    # web CSS px == iOS points in a full-screen web app (no browser chrome); offset by the web view's origin.
    r=rect_js(sel); assert r, sel
    ctx('NATIVE_APP'); wv=call('element',{'using':'class name','value':'XCUIElementTypeWebView'})['value']
    o=call('element/'+wv['element-6066-11e4-a52e-4f735466cecf']+'/rect',method='GET')['value']
    mobile('tap',{'x':o['x']+r['x']+r['w']*dx,'y':o['y']+r['y']+r['h']*dy})
