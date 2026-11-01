from native import *
web=call('contexts',method='GET')[-1]
ctx(web)
r=js('const e=document.querySelector("[data-id=native-20] .bn-inline-content");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10};')
ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: tap','args':[{'x':r['x'],'y':r['y']+62}]});time.sleep(.5)
# WDA sends actual native key sequences to the focused Mobile Safari editor.
for title,trigger in [('link','[[Target'),('date','@')]:
 ctx('NATIVE_APP');call('keys',{'value':[trigger]});time.sleep(.6)
 source=call('source',method='GET');assert 'XCUIElementTypeKeyboard' in source
 shot('native-'+title);Path('/tmp/ratchet255-'+title+'.xml').write_text(source)
 ctx(web)
 result=js('''const m=[...document.querySelectorAll('#bn-suggestion-menu')].at(-1),b=document.querySelector('.editor-phone-toolbar');return {menu:m?.getBoundingClientRect().toJSON(),bar:b?.getBoundingClientRect().toJSON(),vv:visualViewport.height,width:innerWidth,text:m?.textContent};''');print(title,result,flush=True)
 assert result['width']==390 and result['menu'] and result['menu']['bottom']<=result['bar']['top']+1
 # Native backspace dismisses the typed trigger; Escape via WDA closes menus when needed.
 ctx('NATIVE_APP');call('keys',{'value':['\b'*len(trigger)]});time.sleep(.4)
