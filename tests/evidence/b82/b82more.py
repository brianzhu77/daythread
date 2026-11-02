# Jazz local: B82 cases beyond the table. Usage: JAZZ_PORT=.. JAZZ_STORE=.. python3 b82more.py <entry> <empty|filled>
import sys; sys.path.insert(0,'tests/evidence/b82'); src=open('tests/evidence/b82/b82table.py').read()
ns=src[:src.index("reset(); ok(js(ENTRY)==want")].replace("label,runs,want=sys.argv[1],int(sys.argv[2]),sys.argv[3]","")
exec(ns)
want,kind=sys.argv[1:3]
SEL="const s=getSelection(); const q=s.getRangeAt(0); let r=q.getBoundingClientRect(); if(!r.height){const a=q.startContainer; r=(a.nodeType===1?a:a.parentElement).getBoundingClientRect()} const b=document.querySelector('.editor-phone-toolbar').getBoundingClientRect(); const p=document.querySelector('.editor-style-panel'); return {top:Math.round(r.top),bottom:Math.round(r.bottom),bar:Math.round(b.top),panel:p?Math.round(p.getBoundingClientRect().top):null,clock:Math.round(document.querySelector('.safe-top').getBoundingClientRect().bottom),y:Math.round(scrollY),n:window.__n}"
def tap(r): ctx('NATIVE_APP'); mobile('tap',{'x':r['x'],'y':r['y']})
def line(q): web(); return js(FIND,[q])
def begin(pre=0):
    reset(); web()
    if pre: js("window.scrollTo(0,arguments[0]); return 1",[pre]); time.sleep(0.7); web()
    js(SPY)
reset(); ok(js(ENTRY)==want,f'on {want}')
if kind=='empty':
    for q in [{'i':0,'name':'TODO'},{'i':1,'name':'first task row'},{'i':2,'name':'Events'},{'i':3,'name':'bullet under Events'},{'i':4,'name':'Good Stuffs'},{'i':5,'name':'bullet under Good Stuffs'}]:
        tops=[];bads=[]
        for _ in range(3):
            begin(); r=line(q); tap(r); time.sleep(2); web(); s=js(STATE); tops.append(s['top']); bads+=judge(s)
        ok(not bads,f"empty day, {q['name']}: rest {r['top']}, after {tops}, next {s['next']}, moves {s['n']} {bads or ''}")
    for name,q in [('TODO',{'i':0})]:
        begin(); r=line(q); tap(r); time.sleep(2); ctx('NATIVE_APP'); shot('tests/evidence/b82/b82-fix-empty-todo.png'); call('keys',{'value':list('ab')}); time.sleep(1.5); web(); s=js(STATE); print('  typed',s,flush=True); ok(s['top']>=s['clock'] and s['text'].startswith(('TODO','abTODO','TabODO')) and 'ab' in s['text'],f"empty day, typing in TODO stays in view ({s['text']!r} at {s['top']})"); call('keys',{'value':['','']}) if False else None
    print('fails',fails); sys.exit()
# Typing right after the tap
begin(); r=line({'i':11}); tap(r); ctx('NATIVE_APP'); call('keys',{'value':list('quick')}); time.sleep(2); web(); s=js(STATE); print('  typing',s,flush=True); ok(s['text']=='quick' and not judge(s),f"typing right after the tap: text lands, line clear ({s['text']!r} at {s['top']}, moves {s['n']})")
ctx('NATIVE_APP'); shot('tests/evidence/b82/b82-fix-typing.png')
# Lines reached with the keyboard already up
begin(); r=line({'t':'Task 0 for today'}); tap(r); time.sleep(2); web(); js("window.__n=0; return 1"); r=line({'t':'Task 3 for today'}); ok(r['y']<430,f"Task 3 above the toolbar at {r['y']}"); tap(r); time.sleep(1.5); web(); s=js(STATE); ok(not judge(s) and s['n']<=1,f"keyboard up, a lower line: rest {r['top']}, at {s['top']}, next {s['next']}, moves {s['n']} {judge(s) or ''}")
web(); js("window.__n=0; return 1"); r=line({'t':'Task 1 for today'}); ok(r['y']>70,f"Task 1 in view at {r['y']}"); tap(r); time.sleep(1.5); web(); s=js(STATE); ok(not judge(s) and s['n']==0 and s['top']==r['top'],f"keyboard up, a higher clear line doesn't move: {r['top']} -> {s['top']}, moves {s['n']}")
# Scrolled by hand with the keyboard up, a line near the clock: comes clear of it
begin(); r=line({'i':11}); tap(r); time.sleep(2); ctx('NATIVE_APP'); mobile('dragFromToForDuration',{'fromX':370,'fromY':330,'toX':370,'toY':120,'duration':0.2}); time.sleep(1.5); web(); js("window.__n=0; return 1"); h=js("const es=[...document.querySelectorAll('[data-node-type=blockContainer]')]; const clock=document.querySelector('.safe-top').getBoundingClientRect().bottom; const e=es.find(x=>{const c=x.querySelector('.bn-inline-content'); const t=c.getBoundingClientRect().top; return t>clock-2&&c.textContent}); const c=e.querySelector('.bn-inline-content'); return c.textContent"); r=line({'t':h}); tap(r); time.sleep(1.5); web(); s=js(STATE); ok(not judge(s),f"scrolled by hand, the top line in view ({h[:12]!r}): {r['top']} -> {s['top']}, moves {s['n']} {judge(s) or ''}")
# The keyboard's ✓: the page settles back, the screen isn't left blank
begin(); r=line({'i':11}); tap(r); time.sleep(2); ctx('NATIVE_APP'); mobile('tap',{'x':361,'y':532}); time.sleep(1.5); web(); d=js("return {y:Math.round(scrollY),vvH:Math.round(visualViewport.height),docH:document.documentElement.scrollHeight,focused:document.activeElement.tagName}"); print('  after ✓',d,flush=True); ok(d['vvH']==874 and d['y']<=d['docH']-874,f"✓: keyboard down, page in range {d}"); ctx('NATIVE_APP'); shot('tests/evidence/b82/b82-fix-check.png')
# Enter at the bottom, several times, and typing
begin(600); r=line({'t':'Line 12 of the day, with a few words in it'}); tap(r); time.sleep(2); web(); js("window.__n=0; return 1"); ctx('NATIVE_APP'); ok_all=True; seen=[]
for i in range(5):
    call('keys',{'value':['\n']+list('x')}); time.sleep(0.6); web(); c=js(SEL); seen.append((c['top'],c['bottom'])); ok_all=ok_all and c['top']>=c['clock'] and c['bottom']<=c['bar']; ctx('NATIVE_APP')
ok(ok_all,f'Enter five times: caret stays clear {seen}')
# His own scroll with the keyboard up is left alone
begin(); r=line({'i':11}); tap(r); time.sleep(2); web(); s0=js(STATE); js("window.__n=0; return 1"); ctx('NATIVE_APP'); mobile('dragFromToForDuration',{'fromX':370,'fromY':300,'toX':370,'toY':90,'duration':0.2}); time.sleep(0.2); web(); a=js(STATE); time.sleep(2); web(); b=js(STATE); print('  scroll up',s0['top'],a['top'],b['top'],'moves',b['n'],flush=True); ok(a['top']<s0['top'] and b['top']==a['top'] and b['n']==0,f"his scroll up isn't undone ({s0['top']} -> {a['top']} -> {b['top']})")
ctx('NATIVE_APP'); mobile('dragFromToForDuration',{'fromX':370,'fromY':120,'toX':370,'toY':400,'duration':0.2}); time.sleep(2); web(); c=js(STATE); print('  scroll down',c['top'],'moves',c['n'],flush=True); ok(c['n']==0,f"his scroll down isn't undone (at {c['top']})")
# B53: Aa panel
begin(); r=line({'t':'Task 5 for today'}); tap(r); time.sleep(2); web(); js("window.__n=0; const b=[...document.querySelectorAll('.editor-phone-toolbar button')].find(x=>x.textContent.trim()==='Aa'); b.setAttribute('data-aa','1'); return 1"); tap_web('[data-aa]'); time.sleep(1.5); web(); c=js(SEL); ctx('NATIVE_APP'); shot('tests/evidence/b82/b82-fix-aa.png'); ok(c['panel'] is not None and c['bottom']<=c['panel'] and c['top']>=c['clock'],f"B53: Aa panel, the line above it {c}")
# With the table, on a document page, and toolbar above keyboard (B48)
print('fails',fails)
