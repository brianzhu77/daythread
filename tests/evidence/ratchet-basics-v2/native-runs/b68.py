import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx(web);call('url',{'url':'http://127.0.0.1:3665/'});time.sleep(1)
print(js('return {url:location.href,input:!!document.querySelector(".tomorrow-new-input")}'))
js('''window.__ime=[];for(const t of ['compositionstart','compositionupdate','compositionend','input','blur','pagehide','visibilitychange'])window.addEventListener(t,e=>window.__ime.push({t,data:e.data,v:e.target?.value,composing:e.isComposing}),true);''')
js('document.querySelector(".tomorrow-new-input").scrollIntoView({block:"center"})');ctx('NATIVE_APP');key('Add a to-do for tomorrow');time.sleep(.4)
Path('/tmp/ratchet229-b68-keyboard.xml').write_text(call('source',method='GET'))
for x in 'wan':key(x)
key('万');time.sleep(.3);ctx(web);print(js('return {v:document.querySelector(".tomorrow-new-input").value,events:window.__ime}'));ctx('NATIVE_APP')
# Native tap outside input via heading AX element.
key('Tomorrow · Fri, Oct 30')
time.sleep(1);ctx(web);r=js('return {input:document.querySelector(".tomorrow-new-input").value,rows:[...document.querySelectorAll(".tomorrow-row")].map(e=>e.textContent),events:window.__ime}');Path('/tmp/ratchet229-b68-tap.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));print(r)
