import json,time,base64,subprocess
from native import call,script
def tap(using,value):
 e=call('/element',{'using':using,'value':value});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.7)
def xpath(v):tap('xpath',v)
def css(v):tap('css selector',v)
def ws():return json.loads(subprocess.check_output(['sqlite3','/tmp/ratchet-audit.sqlite','select data from workspace']))
def row():return next(p for p in ws()['pages']if p['id']=='call')
def shot(n):open('tests/evidence/ratchet-r4-audit/'+n+'.png','wb').write(base64.b64decode(call('/screenshot')))
xpath('//button[contains(.,"Tomorrow")]');time.sleep(.6)
print('date quick choice',row()['values']['when'],flush=True)
css('[data-cell="row:call|call|owner|"]')
print('relation sheet',json.dumps(script('return {text:document.body.innerText,dialog:[...document.querySelectorAll("[role=dialog]")].map(e=>({text:e.innerText,rect:e.getBoundingClientRect().toJSON()})),input:[...document.querySelectorAll("[role=dialog] input")].map(e=>({placeholder:e.placeholder,type:e.type})),standalone:navigator.standalone}')),flush=True);shot('native-relation')
