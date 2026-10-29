import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx('NATIVE_APP');key('delete');key('delete')
for x in 'wan':key(x)
key('万')
for x in 'wan':key(x)
key('万');time.sleep(.2);ctx(web);before=js('return {value:document.querySelector(".tomorrow-new-input").value,storage:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes("tomorrow")))}');print('before',before);ctx('NATIVE_APP');shot('before-swipe')
# Real touch gesture: lift the app to the switcher, hold, release.
call('actions',{'actions':[{'type':'pointer','id':'finger','parameters':{'pointerType':'touch'},'actions':[{'type':'pointerMove','duration':0,'x':201,'y':870},{'type':'pointerDown','button':0},{'type':'pointerMove','duration':700,'x':201,'y':410},{'type':'pause','duration':1200},{'type':'pointerUp','button':0}]}]});time.sleep(.5);shot('switcher');Path('/tmp/ratchet229-switcher.xml').write_text(call('source',method='GET'));Path('/tmp/ratchet229-before-swipe.json').write_text(json.dumps(before,ensure_ascii=False,indent=2))
