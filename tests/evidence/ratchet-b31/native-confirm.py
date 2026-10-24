import sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/"ratchet-b49"))
from wd import call
import json,time
call('execute/sync',{'script':"document.querySelector('.review-new-input').focus();window.__native31=[];",'args':[]});call('context',{'name':'NATIVE_APP'})
def tap(k):
 r=call('element',{'using':'accessibility id','value':k});e=r['value']['element-6066-11e4-a52e-4f735466cecf'];call('element/'+e+'/click',{})
for k in ['w','a','n','Return']:tap(k)
call('context',{'name':os.environ['WEBVIEW_CONTEXT']});time.sleep(.2)
v=call('execute/sync',{'script':"return {value:document.querySelector('.review-new-input').value,pending:document.querySelectorAll('.review-pending').length,log:window.__native31};",'args':[]})['value'];json.dump(v,open('/tmp/ratchet197-native-confirm.json','w'),ensure_ascii=False,indent=2);print(json.dumps(v,ensure_ascii=False));assert v['value'] and v['pending']==0
