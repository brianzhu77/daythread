# Jazz local: B82's table, several runs per line. Usage: JAZZ_PORT=.. JAZZ_STORE=.. python3 b82table.py <label> <runs> <entry> '<json cases>'
import sys; sys.path.insert(0,'tests/evidence/b82'); exec(open('tests/evidence/b82/nat.py').read())
label,runs,want=sys.argv[1],int(sys.argv[2]),sys.argv[3]
ENTRY="return [...document.scripts].map(s=>s.src).map(u=>(u.match(/assets\\/(index-[^/]+\\.js)/)||[])[1]).find(Boolean)"
SPY="window.__n=0; if(!window.__sb){window.__sb=window.scrollBy; window.scrollBy=function(){window.__n++; return window.__sb.apply(window,arguments)}} return 1"
FIND="""const q=arguments[0]; const es=[...document.querySelectorAll('[data-node-type=blockContainer]')]; const e=q.i!==undefined?es[q.i]:es.find(x=>(x.querySelector('.bn-inline-content')||{}).textContent===q.t); if(!e) return null; document.querySelectorAll('[data-mark]').forEach(x=>x.removeAttribute('data-mark')); e.setAttribute('data-mark','1'); const c=e.querySelector('.bn-inline-content'); const r=c.getBoundingClientRect(); return {x:Math.max(r.x,30)+30,y:r.y+r.height/2,top:Math.round(r.top)}"""
STATE="""const e=document.querySelector('[data-mark]'); const c=e.querySelector('.bn-inline-content'); const r=c.getBoundingClientRect(); const es=[...document.querySelectorAll('[data-node-type=blockContainer]')]; const nx=es[es.indexOf(e)+1]; const nb=nx&&nx.querySelector('.bn-block-content').getBoundingClientRect(); const a=getSelection().anchorNode; const b=a&&(a.nodeType===1?a:a.parentElement); return {top:Math.round(r.top),bottom:Math.round(r.bottom),next:nb?Math.round(nb.bottom):null,bar:Math.round(document.querySelector('.editor-phone-toolbar').getBoundingClientRect().top),clock:Math.round(document.querySelector('.safe-top').getBoundingClientRect().bottom),y:Math.round(scrollY),n:window.__n,inLine:!!(b&&e.contains(b)),text:c.textContent.slice(0,24)}"""
def reset(u='/'):
    web(); js("location.href=arguments[0]; return 1",[u]); time.sleep(3.5); web(); js("document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); getSelection().removeAllRanges(); window.scrollTo(0,0); return 1"); time.sleep(1)
def judge(s,moved_ok=True):
    bad=[]
    if s['top']<s['clock']: bad.append('under clock')
    if s['bottom']>s['bar']: bad.append('behind toolbar')
    if s['next'] and s['next']>s['bar']+1 and s['top']>s['clock']+9: bad.append('next line behind toolbar')
    if s['n']>1: bad.append(f"{s['n']} moves")
    if not s['inLine']: bad.append('caret elsewhere')
    return bad
reset(); ok(js(ENTRY)==want,f'{label} on {want}')
for q in json.loads(sys.argv[4]):
    name=q.get('name') or q.get('t') or str(q.get('i')); rows=[]; bads=[]
    for run in range(runs):
        reset(); web(); pre=q.get('pre',0)
        if pre: js("window.scrollTo(0,arguments[0]); return 1",[pre]); time.sleep(0.7)
        web(); js(SPY); r=js(FIND,[q])
        if not r: print(name,'no such line'); break
        ctx('NATIVE_APP')
        if os.environ.get('SAFARI'):
            r=dict(r,y=r['y']+62)  # Safari's page starts under the status bar
        mobile('tap',{'x':r['x'],'y':r['y']}); time.sleep(q.get('wait',2.0)); web(); s=js(STATE); b=judge(s)
        if q.get('still') and (s['y']!=0 or s['n']!=0): b.append('moved a clear line')
        rows.append(s['top']); bads+=b
    rest=r['top'] if r else None
    ok(not bads,f"{name}: rest {rest}, after {rows} (next {s['next']}, bar {s['bar']}, clock {s['clock']}, moves {s['n']}) {bads or ''}")
print('fails',fails)
