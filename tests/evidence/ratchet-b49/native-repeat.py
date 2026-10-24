from wd import call
import json,time,os
from pathlib import Path
assert call('context',{'name':os.environ['WEBVIEW_CONTEXT']})['value'] is None
print(call('url',{'url':os.environ.get('TEST_URL','http://127.0.0.1:3604/day/2026-10-23')}))
time.sleep(1)
print(call('execute/sync',{'script':open(Path(__file__).with_name('recorder.js')).read(),'args':[]}))
print(call('execute/sync',{'script':'''const p=[...document.querySelectorAll('.bn-inline-content')].find(x=>x.textContent==='万圣节装饰、衣服');p.scrollIntoView({block:'center'});p.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);return p.closest('[data-id]').dataset.id;''','args':[]}))
call('context',{'name':'NATIVE_APP'})
def tap(name):
 r=call('element',{'using':'accessibility id','value':name});e=r['value'].get('element-6066-11e4-a52e-4f735466cecf');assert e,r
 assert call('element/'+e+'/click',{})['value'] is None
for key in ['Return','w','a','n']:tap(key)
s=call('source')['value'];open('/tmp/b49-candidate.xml','w').write(s)
assert 'name="万"' in s
call('context',{'name':os.environ['WEBVIEW_CONTEXT']})
before=call('execute/sync',{'script':'''return {id:getSelection().anchorNode.parentElement.closest('[data-id]').dataset.id,html:getSelection().anchorNode.parentElement.closest('[data-id]').outerHTML};''','args':[]})['value']
call('context',{'name':'NATIVE_APP'});tap('万');call('context',{'name':os.environ['WEBVIEW_CONTEXT']})
after=call('execute/sync',{'script':'''return {log:window.__b49log,blocks:[...document.querySelectorAll('[data-content-type]')].slice(-14).map(e=>({type:e.dataset.contentType,text:e.textContent,id:e.closest('[data-id]')?.dataset.id,html:e.innerHTML})),caret:getSelection().anchorNode.parentElement.closest('[data-id]')?.dataset.id};''','args':[]})['value']
json.dump({'before':before,'after':after},open('/tmp/b49-native-result.json','w'),ensure_ascii=False,indent=2)
print(json.dumps({'before':before,'afterBlocks':after['blocks'],'caret':after['caret']},ensure_ascii=False))
