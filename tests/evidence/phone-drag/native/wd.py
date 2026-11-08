import json, urllib.request, urllib.error, base64
BASE = 'http://127.0.0.1:4757'
def sid(): return open('/tmp/lead-native/sid').read().strip()
def call(path, data=None, method=None, session=True):
    url = BASE + ('/session/' + sid() + '/' if session else '/') + path
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type': 'application/json'}, method=method)
    try: return json.load(urllib.request.urlopen(r, timeout=600))
    except urllib.error.HTTPError as e: return json.load(e)
def start(caps):
    v = call('session', {'capabilities': {'alwaysMatch': caps, 'firstMatch': [{}]}}, session=False).get('value', {})
    if v.get('sessionId'): open('/tmp/lead-native/sid', 'w').write(v['sessionId'])
    return v
def js(src, args=None): return call('execute/sync', {'script': src, 'args': args or []}).get('value')
def ctx(name): return call('context', {'name': name})
def contexts(): return call('contexts', method='GET').get('value')
def shot(path): open(path, 'wb').write(base64.b64decode(call('screenshot', method='GET').get('value')))
def go(url): return call('url', {'url': url})
