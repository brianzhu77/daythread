import json,urllib.request,urllib.error,os
BASE='http://127.0.0.1:4737'
def sid(): return open('/tmp/rb-hs/drv/sid').read().strip()
def call(path, data=None, method=None, session=True):
    url=BASE+('/session/'+sid()+'/' if session else '/')+path
    r=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
    try: return json.load(urllib.request.urlopen(r,timeout=300))
    except urllib.error.HTTPError as e: return json.load(e)
def start(caps):
    r=call('session',{'capabilities':{'alwaysMatch':caps,'firstMatch':[{}]}},session=False)
    v=r.get('value',{}); 
    if v.get('sessionId'): open('/tmp/rb-hs/drv/sid','w').write(v['sessionId'])
    return v
