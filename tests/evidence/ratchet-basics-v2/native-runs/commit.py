import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text()
def state():
 ctx(web);r=js('''return {url:location.href,caret:getSelection().anchorNode?.parentElement?.closest('[data-id]')?.dataset.id,rows:[...document.querySelectorAll('[data-node-type="blockContainer"]')].map(e=>({id:e.dataset.id,text:e.querySelector('.bn-inline-content')?.textContent,type:e.querySelector('[data-content-type]')?.dataset.contentType}))}''');ctx('NATIVE_APP');return r
before=state();key('万');time.sleep(.3);after=state()
for x in 'he':key(x)
time.sleep(.2);Path('/tmp/ratchet229-he.xml').write_text(call('source',method='GET'));key('和');time.sleep(.3);second=state();shot('committed');Path('/tmp/ratchet229-native-result.json').write_text(json.dumps({'before':before,'after':after,'second':second},ensure_ascii=False,indent=2));print(json.dumps({'before':before,'after':after,'second':second},ensure_ascii=False))
