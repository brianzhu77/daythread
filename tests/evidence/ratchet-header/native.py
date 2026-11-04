import json,urllib.request,sys,time,base64
S=json.load(open('/tmp/ratchet122-native-session.json'))['value']['sessionId']
def call(path,body=None,method=None):
 req=urllib.request.Request('http://127.0.0.1:4727/session/'+S+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method=method or ('GET' if body is None else 'POST'))
 try:return json.load(urllib.request.urlopen(req,timeout=90))['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()[:700])
def script(s,args=[]):return call('/execute/sync',{'script':s,'args':args})
if __name__=='__main__':
 if sys.argv[1]=='info': print(json.dumps({'contexts':call('/contexts'),'current':call('/context')}))
 elif sys.argv[1]=='go':call('/url',{'url':sys.argv[2]});time.sleep(2);print(json.dumps(script('return {url:location.href,title:document.title,text:document.body.innerText.slice(0,1600),width:innerWidth,standalone:navigator.standalone}')))
 elif sys.argv[1]=='js':print(json.dumps(script(sys.argv[2])))
 elif sys.argv[1]=='source':print(call('/source'))
 elif sys.argv[1]=='shot':open(sys.argv[2],'wb').write(base64.b64decode(call('/screenshot')));print(sys.argv[2])
