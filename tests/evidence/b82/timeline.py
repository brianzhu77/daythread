# Jazz local: frame by frame after a tap: scrollY, offsetTop, vv height, line top. Usage: JAZZ_PORT=.. JAZZ_STORE=.. python3 timeline.py <label> '<json queries>'
import sys; sys.path.insert(0,'tests/evidence/b82'); exec(open('tests/evidence/b82/nat.py').read())
label=sys.argv[1]
FIND="""const q=arguments[0]; const es=[...document.querySelectorAll('[data-node-type=blockContainer]')]; const e=q.i!==undefined?es[q.i]:es.find(x=>(x.querySelector('.bn-inline-content')||{}).textContent===q.t); if(!e) return null; document.querySelectorAll('[data-mark]').forEach(x=>x.removeAttribute('data-mark')); e.setAttribute('data-mark','1'); const c=e.querySelector('.bn-inline-content'); const r=c.getBoundingClientRect(); return {x:Math.max(r.x,30)+30,y:r.y+r.height/2,top:Math.round(r.top)}"""
REC="""const off=arguments[0]; if(off) {window.scrollBy=function(a,b){(window.__l||[]).push(['blocked',typeof a==='object'?a.top:b])}} const c=document.querySelector('[data-mark] .bn-inline-content'); const t0=performance.now(); const l=[]; window.__l=l; let last=''; const go=()=>{const v=visualViewport; const s=[Math.round(scrollY),Math.round(v.offsetTop),Math.round(v.height),Math.round(c.getBoundingClientRect().top)].join(','); if(s!==last){l.push([Math.round(performance.now()-t0),s]); last=s} if(performance.now()-t0<3500) requestAnimationFrame(go)}; requestAnimationFrame(go); return 1"""
def reset(u='/'):
    web(); js("location.href=arguments[0]; return 1",[u]); time.sleep(4); web(); js("document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); getSelection().removeAllRanges(); window.scrollTo(0,0); return 1"); time.sleep(1.2)
off=bool(os.environ.get('NO_SCROLLBY'))
for q in json.loads(sys.argv[2]):
    reset(); web(); r=js(FIND,[q]); js(REC,[off]); print(json.dumps(q),'rest',r['top'],'(scrollY,offsetTop,vvH,top)',flush=True)
    ctx('NATIVE_APP'); mobile('tap',{'x':r['x'],'y':r['y']}); time.sleep(3.2); web(); L=js("return window.__l"); print('  ',json.dumps(L)[:900],flush=True)
