import json,time,subprocess,base64
from native import call,script
def tap(using,value):
 e=call('/element',{'using':using,'value':value});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.7)
def css(v):tap('css selector',v)
def xpath(v):tap('xpath',v)
def row():return next(p for p in json.loads(subprocess.check_output(['sqlite3','/tmp/ratchet-audit.sqlite','select data from workspace']))['pages']if p['id']=='call')
css('button[aria-label="Undo"]');assert row()['values']['owner']==['ada'];print('PASS native toolbar Undo restores relation',flush=True)
css('button[aria-label="Hide keyboard"]');xpath('//button[contains(.,"Add property")]');print('property dialog',json.dumps(script('return {text:document.body.innerText,selects:[...document.querySelectorAll("select")].map(e=>({label:e.getAttribute("aria-label"),value:e.value,options:[...e.options].map(o=>o.text)})),buttons:[...document.querySelectorAll("[role=dialog] button")].map(e=>e.innerText),dialogs:[...document.querySelectorAll("[role=dialog]")].map(e=>({rect:e.getBoundingClientRect().toJSON(),text:e.innerText}))}')),flush=True);open('tests/evidence/ratchet-r4-audit/native-add-property.png','wb').write(base64.b64decode(call('/screenshot')))
