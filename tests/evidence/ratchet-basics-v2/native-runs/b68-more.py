import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx(web);js('window.__ime=[];document.querySelector(".tomorrow-new-input").scrollIntoView({block:"center"})');ctx('NATIVE_APP');key('Add a to-do for tomorrow')
for x in 'he':key(x)
ctx(web);before=js('return {value:document.querySelector(".tomorrow-new-input").value,rows:document.querySelectorAll(".tomorrow-row").length,events:window.__ime}');ctx('NATIVE_APP');key('Tomorrow · Fri, Oct 30');time.sleep(.8);ctx(web);after=js('return {value:document.querySelector(".tomorrow-new-input").value,rows:[...document.querySelectorAll(".tomorrow-row")].map(e=>e.textContent),events:window.__ime,storage:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes("tomorrow")))}');Path('/tmp/ratchet229-b68-midblur.json').write_text(json.dumps({'before':before,'after':after},ensure_ascii=False,indent=2));print(after)
# Continue the saved draft if still there, then close Safari through app switcher.
ctx('NATIVE_APP');key('Add a to-do for tomorrow');time.sleep(.2)
Path('/tmp/ratchet229-b68-current.xml').write_text(call('source',method='GET'))
