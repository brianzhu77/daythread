from check import *
click('Next keyboard');time.sleep(.4)
word('kaihui','开会');click('数字');click('@');time.sleep(.3);s=snap('home-final-at');assert len(s['menu'])==4
word('mingtian','明天');time.sleep(.6);s=snap('home-final-reading');assert len(s['menu'])==1 and 'All day' in s['menu'][0]
click('换行');time.sleep(.4);s=snap('home-final-chip');assert 'Tomorrow' in s['chips']
expected=['开会@明天','开会@明天','开会@','开会','']
for i,want in enumerate(expected,1):
 click('Undo');time.sleep(.3);s=snap('home-final-undo'+str(i));line=js('return document.querySelector(\'[data-id="day:2026-10-24:notes:template:0"] .bn-inline-content\').textContent');print('actual',i,repr(line),flush=True)
 if i==1:assert line=='开会@明天'
 if i==5:assert line==''
