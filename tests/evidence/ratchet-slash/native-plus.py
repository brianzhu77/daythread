from native import *
web=call('contexts',method='GET')[-1];ctx(web)
r=js('const e=document.querySelector(".editor-phone-toolbar button:nth-child(2)");const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};');print(r)
ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: tap','args':[{'x':r['x'],'y':r['y']+62}]});time.sleep(.6);shot('native-plus');source=call('source',method='GET');Path('/tmp/ratchet255-plus.xml').write_text(source);print('native keyboard', 'XCUIElementTypeKeyboard' in source)
ctx(web);print(js('''const m=document.querySelector('#bn-suggestion-menu'),b=document.querySelector('.editor-phone-toolbar');return {menu:m?.getBoundingClientRect().toJSON(),bar:b?.getBoundingClientRect().toJSON(),width:innerWidth,vv:visualViewport.height,offset:visualViewport.offsetTop,caret:getSelection().getRangeAt(0).getBoundingClientRect().toJSON(),options:[...m.querySelectorAll('[role=option]')].map(e=>e.textContent)}'''))
