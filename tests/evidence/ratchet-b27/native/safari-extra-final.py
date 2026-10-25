from check import *
d.web();d.call('url',{'url':'http://127.0.0.1:3648/'});time.sleep(1)
# Choose the empty line created by the final history probe, without changing its text.
probe=js('return [...document.querySelectorAll(\'[data-content-type="bulletListItem"] .bn-inline-content\')].find(e=>!e.textContent)?.closest(".bn-block-outer").dataset.id');print('probe',probe,flush=True);d.activate(f'[data-id="{probe}"] .bn-inline-content')
labels=[e.get('label') for e in E.fromstring(d.source()).iter('XCUIElementTypeKey')]
if '删除' not in labels:click('Next keyboard');time.sleep(.3)
click('数字');click('@');word('laowang','老王');time.sleep(.4);s=snap('safari-6a-laowang');assert '@老王' in s['lines'] and not s['menu']
click('换行');time.sleep(.4);click('Next keyboard');time.sleep(.3)
for c in 'safari':d.key(c);time.sleep(.1)
d.tap('space');click('numbers');click('@');click('letters')
for c in 'nov':d.key(c);time.sleep(.1)
d.tap('space');click('numbers');click('2');click('0');time.sleep(.5);s=snap('safari-6a-nov-reading');assert len(s['menu'])==1 and 'Nov 20' in s['menu'][0]
click('return');time.sleep(.4);snap('safari-6a-nov-chip');click('Undo');time.sleep(.4);s=snap('safari-6a-nov-undo');assert 'Safari @nov 20' in s['lines'];click('Redo');time.sleep(.5);click('Hide keyboard');time.sleep(.4)
js('location.href="http://127.0.0.1:3648/day/2026-11-20";return true');time.sleep(1.5);snap('safari-6a-nov-row');rows=js('return [...document.querySelectorAll(".day-event-title")].map(e=>e.textContent)');print('rows',rows,flush=True);assert 'Safari' in rows
