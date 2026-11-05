import json,time,base64
from native import call,script
call('/appium/settings',{'settings':{'nativeWebTap':True}})
def tap(css):
 e=call('/element',{'using':'css selector','value':css});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.6)
def shot(name):open('tests/evidence/ratchet-r4-audit/'+name+'.png','wb').write(base64.b64decode(call('/screenshot')))
tap('[data-cell="row:call|call|when|"]')
print(json.dumps(script('return {text:document.body.innerText,width:innerWidth,dialogs:[...document.querySelectorAll("[role=dialog]")].map(e=>({label:e.getAttribute("aria-label"),text:e.innerText,rect:e.getBoundingClientRect().toJSON()})),buttons:[...document.querySelectorAll(".property-popover button")].map(e=>({text:e.innerText,aria:e.getAttribute("aria-label")}))}')),flush=True)
shot('native-date')
