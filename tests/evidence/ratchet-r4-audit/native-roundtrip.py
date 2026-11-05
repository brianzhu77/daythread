import json,time,subprocess,base64
from native import call,script
def tap(using,value):
 e=call('/element',{'using':using,'value':value});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.7)
def row():return next(p for p in json.loads(subprocess.check_output(['sqlite3','/tmp/ratchet-audit.sqlite','select data from workspace']))['pages']if p['id']=='call')
assert not row()['values'].get('owner');print('PASS prior native remove + Done persisted',flush=True)
tap('css selector','[data-cell="row:call|call|owner|"]');tap('xpath','//*[@role="dialog"]//button[normalize-space(.)="Ada"]');tap('xpath','//*[@role="dialog"]//button[normalize-space(.)="Done"]');assert row()['values']['owner']==['ada'];print('PASS native add + Done persists Ada',flush=True);result=script('return {width:innerWidth,standalone:navigator.standalone,text:document.body.innerText,visualHeight:visualViewport.height}');print(json.dumps(result),flush=True);assert 'Sum\n7' in result['text'] and 'Calc\n8' in result['text'];print('PASS derived Rollup and Formula update after native relation edit',flush=True);open('tests/evidence/ratchet-r4-audit/native-relation-saved.png','wb').write(base64.b64decode(call('/screenshot')))
