import sys,json,time,base64,xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,'/tmp/sweep-ios');import driver as d
ROOT=Path('/tmp/ratchet219-ios');CTX=(ROOT/'ctx').read_text().strip() if (ROOT/'ctx').exists() else 'WEBVIEW_14248.1';d.web=lambda:d.call('context',{'name':CTX})
def js(s,*a):return d.js(s,*a)
def click(label):
 d.native();el=d.call('element',{'using':'-ios predicate string','value':f"label == {json.dumps(label)}"})['element-6066-11e4-a52e-4f735466cecf'];d.call('element/'+el+'/click',{})
def letters(t):
 for c in t:click(c);time.sleep(.08)
def word(t,c):letters(t);time.sleep(.3);click(c);time.sleep(.4)
def state():return js('return {url:location.href,standalone:navigator.standalone,menu:[...document.querySelectorAll(".date-menu [role=option],.date-menu-hint")].map(e=>e.textContent),chips:[...document.querySelectorAll(".date-ref")].map(e=>e.textContent),lines:[...document.querySelectorAll(".bn-inline-content")].map(e=>e.textContent),vv:visualViewport.height,strip:document.querySelector(".today-events")?.textContent}')
def snap(name):
 s=state();(ROOT/(name+'.json')).write_text(json.dumps(s,ensure_ascii=False,indent=2));d.native();(ROOT/(name+'.xml')).write_text(d.call('source'));(ROOT/(name+'.png')).write_bytes(base64.b64decode(d.call('screenshot')));print(name,json.dumps(s,ensure_ascii=False),flush=True);return s
if __name__=='__main__':
 word('kaihui','开会');click('数字');click('@');time.sleep(.5);snap('safari-at')
 word('mingtian','明天');time.sleep(.8);s=snap('safari-mingtian');assert len(s['menu'])==1 and 'All day' in s['menu'][0]
 click('换行');time.sleep(.6);s=snap('safari-chip');assert 'Tomorrow' in s['chips']
 click('Undo');time.sleep(.5);s=snap('safari-undo');assert '开会@明天' in s['lines']
 click('Undo');time.sleep(.5);snap('safari-undo2')
