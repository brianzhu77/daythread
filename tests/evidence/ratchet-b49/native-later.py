from wd import call
import json,time,os
before=call('execute/sync',{'script':"return getSelection().anchorNode.parentElement.closest('[data-id]').dataset.id",'args':[]})['value'];call('context',{'name':'NATIVE_APP'})
def tap(k):
 r=call('element',{'using':'accessibility id','value':k});e=r['value'].get('element-6066-11e4-a52e-4f735466cecf');assert e,r;call('element/'+e+'/click',{})
for k in ['h','e','和']:tap(k)
call('context',{'name':os.environ['WEBVIEW_CONTEXT']});time.sleep(.2)
v=call('execute/sync',{'script':'''const b=getSelection().anchorNode.parentElement.closest('[data-id]');return {id:b.dataset.id,type:b.querySelector('[data-content-type]').dataset.contentType,text:b.querySelector('.bn-inline-content').textContent,html:b.querySelector('.bn-inline-content').innerHTML,log:window.__b49log};''','args':[]})['value'];print(json.dumps({ 'before':before,'after':v},ensure_ascii=False));json.dump({'before':before,'after':v},open('/tmp/ratchet198-later.json','w'),ensure_ascii=False,indent=2);assert v['id']==before and v['text']=='万和' and '<br' not in v['html']
