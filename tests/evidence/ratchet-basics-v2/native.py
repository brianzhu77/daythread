import json,urllib.request,urllib.error,time,base64
from pathlib import Path
BASE='http://127.0.0.1:4727/session/'+json.load(open('/tmp/ratchet229-session.json'))['value']['sessionId']+'/'
def call(path,data=None,method=None):
 r=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
 try:v=json.load(urllib.request.urlopen(r,timeout=120))['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
 return v
def ctx(name):return call('context',{'name':name})
def js(s):return call('execute/sync',{'script':s,'args':[]})
def key(name):
 e=call('element',{'using':'-ios predicate string','value':'name == '+json.dumps(name)})
 eid=next(v for k,v in e.items() if k.startswith('element-') or k=='ELEMENT');call('element/'+eid+'/click',{})
def shot(name):Path('/tmp/ratchet229-'+name+'.png').write_bytes(base64.b64decode(call('screenshot',method='GET')))
if __name__=='__main__':
 ctx('NATIVE_APP');js('mobile: activateApp') if False else call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]})
 call('execute/sync',{'script':'mobile: deepLink','args':[{'url':'http://127.0.0.1:3665/pages?page=ratchet229-writing','bundleId':'com.apple.mobilesafari'}]});time.sleep(2)
 print(call('contexts',method='GET'))
 print(call('source',method='GET')[-14000:])
