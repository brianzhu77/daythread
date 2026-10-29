import sys
sys.path.insert(0,'tests/evidence/ratchet-basics-v2')
from native import *
web=Path('/tmp/ratchet229-webcontext').read_text();ctx(web);r=js('const r=document.querySelector(\'[data-id="native-empty"] .bn-inline-content\').getBoundingClientRect();return {x:r.x+15,y:r.y+r.height/2,offset:window.visualViewport.offsetTop,height:innerHeight,screen:screen.height}')
print(r);ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: tap','args':[{'x':r['x'],'y':r['y']+62}]});time.sleep(.6);Path('/tmp/ratchet229-keyboard2.xml').write_text(call('source',method='GET'));shot('keyboard2')
