# Prepared for the final PR131 head only. Requires own Appium session receipt and opening/seed.ts store.
import json,time,urllib.request,sys,subprocess
base,store,out=sys.argv[1:4]
session=json.load(open('/tmp/ratchet122-native-session.json'))['value']['sessionId']
def call(path,body=None):
 r=urllib.request.Request('http://127.0.0.1:4727/session/'+session+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='GET' if body is None else 'POST')
 return json.load(urllib.request.urlopen(r,timeout=90))['value']
def js(s):return call('/execute/sync',{'script':s,'args':[]})
def key(k):return call('/execute/sync',{'script':'mobile: keys','args':[{'keys':[{'key':k}]}]})
def go(page):call('/url',{'url':base+'/pages?page='+page});time.sleep(1.5)
def tap(css):
 e=call('/element',{'using':'css selector','value':css});call('/element/'+next(iter(e.values()))+'/click',{});return e
call('/appium/settings',{'settings':{'nativeWebTap':True}})
go('elsewhere')
# A temporary DOM input calibrates the actual native key; no app data is changed by it.
js('const i=document.createElement("input");i.id="key-probe";i.style="position:fixed;top:150px;left:30px;width:200px;height:50px;z-index:99999;background:white";document.body.append(i)')
e=tap('#key-probe');call('/element/'+next(iter(e.values()))+'/value',{'text':'AB'});key('XCUIKeyboardKeyDelete');probe=js('return document.querySelector("#key-probe").value');assert probe=='A',probe
results=[{'calibration':'native XCTest Backspace deletes B','value':probe}]
for page in ['home','alone','linked','todos','card','divider','synced']:
 go('elsewhere');go(page)
 before=json.loads(subprocess.check_output(['sqlite3',store,'select data from workspace']))['pages']
 initial=js('window.__nativeKeys=[];window.addEventListener("keydown",e=>window.__nativeKeys.push({key:e.key,trusted:e.isTrusted,target:e.target.tagName}));return {url:location.href,active:document.activeElement.tagName,standalone:navigator.standalone,width:innerWidth}')
 assert initial['active']=='BODY',initial
 key('XCUIKeyboardKeyDelete');time.sleep(.5)
 after=js('return {url:location.href,keys:window.__nativeKeys,active:document.activeElement.tagName}')
 current=json.loads(subprocess.check_output(['sqlite3',store,'select data from workspace']))['pages']
 results.append({'page':page,'initial':initial,'after':after,'pagesUnchanged':current==before})
 assert after['url']==initial['url'] and current==before,results[-1]
json.dump(results,open(out,'w'),indent=2);print(json.dumps(results,indent=2))
