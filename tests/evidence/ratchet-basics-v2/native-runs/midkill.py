import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx('NATIVE_APP');key('Tomorrow · Fri, Oct 30');time.sleep(.5);ctx(web);js('document.querySelector(".tomorrow-new-input").scrollIntoView({block:"center"})');ctx('NATIVE_APP');key('Add a to-do for tomorrow')
for x in 'he':key(x)
ctx(web);before=js('return {value:document.querySelector(".tomorrow-new-input").value,rows:[...document.querySelectorAll(".tomorrow-row")].map(e=>e.textContent)}');ctx('NATIVE_APP');shot('midcomposition');call('execute/sync',{'script':'mobile: pressButton','args':[{'name':'home'}]});call('execute/sync',{'script':'mobile: dragFromToForDuration','args':[{'fromX':201,'fromY':873,'toX':201,'toY':430,'duration':1.5}]});time.sleep(.3);shot('mid-switcher');call('execute/sync',{'script':'mobile: dragFromToWithVelocity','args':[{'fromX':200,'fromY':500,'toX':200,'toY':0,'velocity':1500,'pressDuration':.05,'holdDuration':.1}]});time.sleep(.5);state=call('execute/sync',{'script':'mobile: queryAppState','args':[{'bundleId':'com.apple.mobilesafari'}]});assert state==1,state;call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]});time.sleep(.8)
for x in call('contexts',method='GET'):
 if x.startswith('WEBVIEW'):
  ctx(x)
  if js('return location.href').startswith('http://127.0.0.1:3665/'):
   web=x;break
r=js('return {value:document.querySelector(".tomorrow-new-input").value,rows:[...document.querySelectorAll(".tomorrow-row")].map(e=>e.textContent)}');print(before,r);Path('/tmp/ratchet229-midkill.json').write_text(json.dumps({'before':before,'appStateAfterSwipe':state,'after':r},ensure_ascii=False,indent=2));assert r==before;Path('/tmp/ratchet229-webcontext').write_text(web);ctx('NATIVE_APP');shot('mid-recovered')
