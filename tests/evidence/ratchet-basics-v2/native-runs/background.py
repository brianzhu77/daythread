import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx(web);js('document.querySelector(\'[data-id="native-empty"]\').scrollIntoView({block:"center"})');ctx('NATIVE_APP');key('万和');time.sleep(.3)
ctx(web);js('''const e=document.querySelector('[data-id="native-empty"] .bn-inline-content');e.focus();let r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r)''');ctx('NATIVE_APP')
for x in 'hao':key(x)
ctx(web);before=js('return {caret:getSelection().anchorNode.parentElement.closest("[data-id]").dataset.id,text:document.querySelector(\'[data-id="native-empty"] .bn-inline-content\').textContent}');ctx('NATIVE_APP');shot('editor-midword');call('execute/sync',{'script':'mobile: pressButton','args':[{'name':'home'}]});time.sleep(.3);call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]});time.sleep(.4);ctx(web);after=js('return {caret:getSelection().anchorNode.parentElement.closest("[data-id]").dataset.id,text:document.querySelector(\'[data-id="native-empty"] .bn-inline-content\').textContent}');ctx('NATIVE_APP');Path('/tmp/ratchet229-background-keyboard.xml').write_text(call('source',method='GET'));print(before,after);Path('/tmp/ratchet229-background.json').write_text(json.dumps({'before':before,'after':after},ensure_ascii=False,indent=2));assert before==after;shot('editor-returned')
# Commit the candidate after return if preserved in native keyboard.
try:key('好')
except RuntimeError:pass
