import json,urllib.request,sys,os
SID=os.environ['APPIUM_SESSION_ID']
def call(path, data=None, method=None):
 r=urllib.request.Request(os.environ.get('APPIUM_URL','http://127.0.0.1:4727')+'/session/'+SID+'/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
 try:return json.load(urllib.request.urlopen(r,timeout=60))
 except urllib.error.HTTPError as e:return json.load(e)
if __name__=='__main__':print(json.dumps(call(sys.argv[1],json.loads(sys.argv[2]) if len(sys.argv)>2 else None),ensure_ascii=False))
