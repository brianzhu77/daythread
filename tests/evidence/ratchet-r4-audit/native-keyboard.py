import json,time,base64,subprocess
from native import call,script
def tap(using,value):
 e=call('/element',{'using':using,'value':value});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.7);return e
def css(v):return tap('css selector',v)
def xpath(v):return tap('xpath',v)
def shot(n):open('tests/evidence/ratchet-r4-audit/'+n+'.png','wb').write(base64.b64decode(call('/screenshot')))
e=css('[role=dialog] input[placeholder="Search or create"]');call('/element/'+next(iter(e.values()))+'/value',{'text':'Ada'});time.sleep(.6)
print('keyboard',json.dumps(script('const e=document.querySelector("[role=dialog]");return {height:innerHeight,visual:visualViewport.height,rect:e.getBoundingClientRect().toJSON(),text:e.innerText,buttons:[...e.querySelectorAll("button")].map(e=>({text:e.innerText,aria:e.getAttribute("aria-label")}))}')),flush=True);shot('native-relation-keyboard')
