import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
contexts=call('contexts',method='GET');print(contexts);web=contexts[-1];ctx(web)
print(js('return location.href'))
print(js('''const el=document.querySelector('[data-id="native-empty"] .bn-inline-content');el.scrollIntoView({block:'center'});el.focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);return el.outerHTML'''))
ctx('NATIVE_APP');time.sleep(.5);Path('/tmp/ratchet229-keyboard.xml').write_text(call('source',method='GET'));shot('keyboard');Path('/tmp/ratchet229-webcontext').write_text(web)
