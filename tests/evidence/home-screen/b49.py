# B49 in the Home Screen app: Return, w a n, first candidate 万, then h e, 和; on a nested bullet and on a to-do.
from wd import call
import json,sys,time,os
WEB=os.environ['WEBVIEW']
def web(): call('context',{'name':WEB})
def native(): call('context',{'name':'NATIVE_APP'})
def js(s): web(); return call('execute/sync',{'script':s,'args':[]})['value']
def tap(name):
    native(); r=call('element',{'using':'accessibility id','value':name})['value'];e=r.get('element-6066-11e4-a52e-4f735466cecf');assert e,(name,r)
    assert call('element/'+e+'/click',{})['value'] is None
anchor=sys.argv[1]; out=sys.argv[2]
js(open(os.path.join(os.path.dirname(__file__),'..','b49','recorder.js')).read())
start=js('''const p=[...document.querySelectorAll('.bn-inline-content')].find(x=>x.textContent===%s);p.scrollIntoView({block:'center'});p.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);return p.closest('[data-id]').dataset.id;'''%json.dumps(anchor))
time.sleep(.8)
import xml.etree.ElementTree as ET
native(); root=ET.fromstring(call('source')['value'])
a=next(x for x in root.iter() if x.get('name')==anchor and x.get('visible')=='true')
call('execute/sync',{'script':'mobile: tap','args':[{'x':float(a.get('x'))+float(a.get('width'))-4,'y':float(a.get('y'))+float(a.get('height'))/2}]}); time.sleep(.8)
js('''const p=[...document.querySelectorAll('.bn-inline-content')].find(x=>x.textContent===%s);const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);'''%json.dumps(anchor)); time.sleep(.4)
native(); kb=[x.attrib.get('name') for x in ET.fromstring(call('source')['value']).iter('XCUIElementTypeKeyboard')]
print('keyboard', kb)
tap('Return'); time.sleep(.6)
newline=js("const a=getSelection().anchorNode;const e=a.nodeType===1?a:a.parentElement;const b=e.closest('[data-node-type=\"blockContainer\"]');return {id:b.dataset.id,type:b.querySelector('[data-content-type]').dataset.contentType,standalone:navigator.standalone}")
for k in ['w','a','n']: tap(k); time.sleep(.25)
tap('万'); time.sleep(1.2)
first=js("const a=getSelection().anchorNode;const e=a.nodeType===1?a:a.parentElement;const b=e.closest('[data-node-type=\"blockContainer\"]');return {id:b.dataset.id,type:b.querySelector('[data-content-type]').dataset.contentType,text:b.querySelector('.bn-inline-content').textContent,html:b.querySelector('.bn-inline-content').innerHTML}")
for k in ['h','e']: tap(k); time.sleep(.25)
tap('和'); time.sleep(1.2)
later=js("const a=getSelection().anchorNode;const e=a.nodeType===1?a:a.parentElement;const b=e.closest('[data-node-type=\"blockContainer\"]');return {id:b.dataset.id,type:b.querySelector('[data-content-type]').dataset.contentType,text:b.querySelector('.bn-inline-content').textContent,html:b.querySelector('.bn-inline-content').innerHTML}")
around=js('''const all=[...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')];const i=all.findIndex(b=>b.dataset.id===%s);return all.slice(i,i+4).map(b=>({id:b.dataset.id,type:b.querySelector('[data-content-type]').dataset.contentType,text:b.querySelector('.bn-inline-content')?.textContent,depth:(function(){let d=0,x=b;while((x=x.parentElement?.closest('[data-node-type="blockContainer"]')))d++;return d})()}))'''%json.dumps(start))
log=js('return window.__b49log')
res={'anchor':start,'newLine':newline,'first':first,'later':later,'around':around}
json.dump({**res,'log':log},open(out,'w'),ensure_ascii=False,indent=1)
print(json.dumps(res,ensure_ascii=False))
