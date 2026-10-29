import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx('NATIVE_APP');key('Return')
for x in 'wan':key(x)
ctx(web);before=js('return getSelection().anchorNode.parentElement.closest("[data-id]").dataset.id');ctx('NATIVE_APP');key('万');time.sleep(.3)
ctx(web);after=js('return {caret:getSelection().anchorNode.parentElement.closest("[data-id]").dataset.id,text:getSelection().anchorNode.parentElement.closest("[data-id]").textContent}');print(before,after);assert before==after['caret'] and '万' in after['text'];ctx('NATIVE_APP');shot('new-bullet');Path('/tmp/ratchet229-native-newbullet.json').write_text(json.dumps({'before':before,'after':after},ensure_ascii=False))
# Focus empty task via setup, then actual keyboard input/candidate.
ctx(web);r=js('''const e=document.querySelector('[data-id="native-todo"] .bn-inline-content');e.scrollIntoView({block:'center'});e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);return e.getBoundingClientRect().toJSON()''');ctx('NATIVE_APP')
for x in 'wan':key(x)
key('万');time.sleep(.4);ctx(web);task=js('return {caret:getSelection().anchorNode.parentElement.closest("[data-id]").dataset.id,text:document.querySelector(\'[data-id="native-todo"]\').textContent}');print(task);assert task['caret']=='native-todo' and '万' in task['text'];ctx('NATIVE_APP');shot('task');Path('/tmp/ratchet229-native-task.json').write_text(json.dumps(task,ensure_ascii=False))
