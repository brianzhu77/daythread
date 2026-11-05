import json,urllib.request,time
sid=json.load(open('/tmp/ratchet131-native-session.json'))['value']['sessionId']
def call(path,body=None):
 r=urllib.request.Request('http://127.0.0.1:4727/session/'+sid+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='GET' if body is None else 'POST');return json.load(urllib.request.urlopen(r,timeout=90))['value']
def js(s):return call('/execute/sync',{'script':s,'args':[]})
print('contexts',call('/contexts'));call('/url',{'url':'http://127.0.0.1:3699/sign-in'});time.sleep(2)
js('const i=document.createElement("input");i.id="key-probe";i.style="position:fixed;top:150px;left:30px;width:200px;height:50px;z-index:99999;background:white";document.body.append(i)')
e=call('/element',{'using':'css selector','value':'#key-probe'});eid=next(iter(e.values()));call('/element/'+eid+'/click',{});call('/element/'+eid+'/value',{'text':'AB'});time.sleep(1);print('probe',js('return {value:document.querySelector("#key-probe").value,active:document.activeElement.id}'))
ctx=call('/context');print('webcontext',ctx);json.dump({'context':ctx},open('/tmp/ratchet131-native-context.json','w'));call('/context',{'name':'NATIVE_APP'});source=call('/source');open('/tmp/ratchet131-native-source.xml','w').write(source);print('source captured',len(source))
