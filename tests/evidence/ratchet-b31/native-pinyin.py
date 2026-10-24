import sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/"ratchet-b49"))
from wd import call
import json,time
print(call('execute/sync',{'script':'''window.__native31=[];const e=document.querySelector('.review-new-input');for(const type of ['keydown','compositionstart','compositionupdate','compositionend','beforeinput','input'])e.addEventListener(type,x=>window.__native31.push({type,key:x.key,code:x.keyCode,composing:x.isComposing,data:x.data,value:e.value,inputType:x.inputType}),true);e.focus();return e.getBoundingClientRect().toJSON();''','args':[]}))
call('context',{'name':'NATIVE_APP'})
def tap(k):
 r=call('element',{'using':'accessibility id','value':k});e=r['value'].get('element-6066-11e4-a52e-4f735466cecf');assert e,r;call('element/'+e+'/click',{})
for k in ['w','a','n']:tap(k)
tap('万')
call('context',{'name':os.environ['WEBVIEW_CONTEXT']})
first=call('execute/sync',{'script':'''return {value:document.querySelector('.review-new-input').value,pending:document.querySelectorAll('.review-pending').length,rows:document.querySelectorAll('.review-list .task-row').length,log:window.__native31};''','args':[]})['value'];print(json.dumps(first,ensure_ascii=False));assert first['value']=='万'
call('context',{'name':'NATIVE_APP'});tap('Return');call('context',{'name':os.environ['WEBVIEW_CONTEXT']});time.sleep(1)
after=call('execute/sync',{'script':'''return {value:document.querySelector('.review-new-input').value,text:document.querySelector('.review-one').innerText,log:window.__native31};''','args':[]})['value'];json.dump({'candidate':first,'return':after},open('/tmp/ratchet197-native-pinyin.json','w'),ensure_ascii=False,indent=2);print(json.dumps(after,ensure_ascii=False));assert after['value']==''
