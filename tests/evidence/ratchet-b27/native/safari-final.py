from check import *
d.web();d.call('url',{'url':'http://127.0.0.1:3648/'});time.sleep(1)
d.activate('[data-id="day:2026-10-24:good-stuffs:template:0"] .bn-inline-content')
# New line created through the software keyboard, then pinyin input.
labels=[e.get('label') for e in E.fromstring(d.source()).iter('XCUIElementTypeKey')]
click('换行' if '删除' in labels else 'return');time.sleep(.4)
probe=js('return getSelection().anchorNode.parentElement.closest(".bn-block-outer").dataset.id');print('probe',probe,flush=True)
labels=[e.get('label') for e in E.fromstring(d.source()).iter('XCUIElementTypeKey')]
if '删除' not in labels:click('Next keyboard');time.sleep(.3)
word('kaihui','开会');click('数字');click('@');word('mingtian','明天');time.sleep(.5);s=snap('safari-final-reading');assert len(s['menu'])==1 and 'All day' in s['menu'][0]
click('换行');time.sleep(.4);s=snap('safari-final-chip');assert 'Tomorrow' in s['chips']
for i in range(1,6):
 click('Undo');time.sleep(.3);s=snap('safari-final-undo'+str(i));t=js('return document.querySelector(`[data-id="${arguments[0]}"] .bn-inline-content`)?.textContent',probe);print('actual',i,repr(t),flush=True)
 if i==1:assert t=='开会@明天'
 if i==5:assert t==''
click('Hide keyboard');time.sleep(.4);js('scrollTo(0,0);return true');s=snap('safari-final-strip');assert s['strip'] and s['vv']>600
js('location.href="http://127.0.0.1:3648/day/2026-11-20";return true');time.sleep(1.5);s=snap('safari-final-future');rows=js('return [...document.querySelectorAll(".day-event-title")].map(e=>e.textContent)');assert 'Dentist' in rows;print('rows',rows,flush=True)
