import json,urllib.request,urllib.error,base64,time
BASE='http://127.0.0.1:4737'
def sid(): return open('/tmp/rb-b27n/drv/sid').read().strip()
def call(path, data=None, method=None, session=True):
    url=BASE+('/session/'+sid()+'/' if session else '/')+path
    r=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
    try: return json.load(urllib.request.urlopen(r,timeout=300))
    except urllib.error.HTTPError as e: return json.load(e)
def start(caps):
    r=call('session',{'capabilities':{'alwaysMatch':caps,'firstMatch':[{}]}},session=False)
    v=r.get('value',{})
    if v.get('sessionId'): open('/tmp/rb-b27n/drv/sid','w').write(v['sessionId'])
    return v
def js(src, args=None): return call('execute/sync',{'script':src,'args':args or []}).get('value')
def ctx(name): return call('context',{'name':name})
def contexts(): return call('contexts',method='GET').get('value')
def tap(x,y): return call('execute/sync',{'script':'mobile: tap','args':[{'x':x,'y':y}]})
def shot(path):
    v=call('screenshot',method='GET').get('value'); open(path,'wb').write(base64.b64decode(v))
def find(pred):
    r=call('element',{'using':'-ios predicate string','value':pred}); return r.get('value',{}).get('ELEMENT') or r.get('value',{}).get('element-6066-11e4-a52e-4f735466cecc')
def click(el): return call(f'element/{el}/click',{})
def rect(el): return call(f'element/{el}/rect',method='GET').get('value')
