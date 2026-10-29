import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: dragFromToForDuration','args':[{'fromX':201,'fromY':430,'toX':201,'toY':40,'duration':.4}]});time.sleep(.4);shot('swiped-away');call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]});time.sleep(1)
contexts=call('contexts',method='GET');print(contexts)
for x in contexts:
 if not x.startswith('WEBVIEW'):continue
 ctx(x)
 if js('return location.href').startswith('http://127.0.0.1:3665/'):
  web=x;break
else:raise RuntimeError('own tab missing')
r=js('return {url:location.href,value:document.querySelector(".tomorrow-new-input")?.value,rows:[...document.querySelectorAll(".tomorrow-row")].map(e=>e.textContent),storage:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes("tomorrow")))}');print(r);Path('/tmp/ratchet229-after-swipe.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));Path('/tmp/ratchet229-webcontext').write_text(web);assert r['value']=='万万';assert sum('万万' in t for t in r['rows'])==0;ctx('NATIVE_APP');shot('after-swipe')
