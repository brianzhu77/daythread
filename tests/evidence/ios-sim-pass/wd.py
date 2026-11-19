import os,json,urllib.request,urllib.error,base64,time,re
BASE=os.environ.get('JAZZ_APPIUM','')  # your own Appium
def sid(): return open(os.environ['JAZZ_SID_FILE']).read().strip()
def call(path, data=None, method=None, session=True):
    url=BASE+('/session/'+sid()+'/' if session else '/')+path
    r=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
    try: return json.load(urllib.request.urlopen(r,timeout=600))
    except urllib.error.HTTPError as e: return json.load(e)
def start(caps):
    v=call('session',{'capabilities':{'alwaysMatch':caps,'firstMatch':[{}]}},session=False).get('value',{})
    if v.get('sessionId'): open(os.environ['JAZZ_SID_FILE'],'w').write(v['sessionId'])
    return v
def mobile(name,args={}): return call('execute/sync',{'script':'mobile: '+name,'args':[args]})['value']
def js(s,args=[]): return call('execute/sync',{'script':s,'args':args})['value']
def ctx(n): return call('context',{'name':n})['value']
def contexts(): return call('contexts')['value']
def shot(path): open(path,'wb').write(base64.b64decode(call('screenshot')['value']))
def webctx(bundle):
    for _ in range(20):
        cs=[c for c in contexts() if isinstance(c,dict) and c.get('bundleId')==bundle and '3711' in (c.get('url') or '')]
        if cs: ctx(cs[-1]['id']); return cs[-1]
        time.sleep(1)
    return None
