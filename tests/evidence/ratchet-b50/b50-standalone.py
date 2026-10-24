from driver import *
import driver,sqlite3
ROOT=Path('/tmp/b50-ios');driver.ROOT=ROOT
out=[]
for scenario in ['text','empty','checkbox']:
 goto('/day/2026-10-24');js('''window.__tap=[];for(const t of ['pointerdown','touchstart','touchend','mousedown','mouseup','click'])document.addEventListener(t,e=>__tap.push({type:t,x:e.clientX,y:e.clientY,target:e.target.outerHTML.slice(0,160)}),true)''')
 sel={'text':'[data-id="day:2026-10-24:notes:template:0"] .bn-inline-content','empty':'[data-id="day:2026-10-24:events:template:0"] .bn-inline-content','checkbox':'[data-content-type="task"] input[aria-label="Complete TRV for Lu and Kathy"]'}[scenario]
 js('document.querySelector(arguments[0]).scrollIntoView({block:"center"})',sel);time.sleep(.8);rect=js('return document.querySelector(arguments[0]).getBoundingClientRect().toJSON()',sel)
 if scenario=='text':
  r=ET.fromstring(source());a=next(x for x in r.iter()if x.get('name')=='明天'and x.get('visible')=='true');x=float(a.get('x'))+10;y=float(a.get('y'))+10
 elif scenario=='empty':
  heading=js("return document.querySelector('[data-id=\"day:2026-10-24:events\"] .bn-inline-content').getBoundingClientRect().top");r=ET.fromstring(source());a=next(e for e in r.iter()if e.get('name')=='Events'and e.get('visible')=='true');offset=float(a.get('y'))-heading;x=90;y=rect['top']+offset+12
 else:
  r=ET.fromstring(source());a=next(x for x in r.iter()if x.get('name')=='Complete TRV for Lu and Kathy'and x.get('visible')=='true');x=float(a.get('x'))+float(a.get('width'))/2;y=float(a.get('y'))+float(a.get('height'))/2
 native();call('execute/sync',{'script':'mobile: tap','args':[{'x':x,'y':y}]});time.sleep(.7)
 v=js('''return {events:__tap,focused:document.activeElement.getAttribute('contenteditable'),viewport:visualViewport.height,menus:document.querySelectorAll('.bn-side-menu').length};''');d=sqlite3.connect('/tmp/ratchet201.sqlite');v['task']=d.execute("select id,title,status from tasks where snapshot='current' and title='TRV for Lu and Kathy'").fetchall();d.close();v['scenario']=scenario;out.append(v);snap('standalone-single-'+scenario);print(json.dumps(v,ensure_ascii=False),flush=True)
 assert any(e['type']=='click'for e in v['events']),v
 if scenario!='checkbox':assert v['focused']=='true'and v['viewport']<500,v
 else:assert v['task'][0][2]=='done',v
(ROOT/'single-tap-standalone.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
