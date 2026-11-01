from native import *
web=call('contexts',method='GET')[-1];ctx(web)
r=js('''const e=document.querySelector('[data-id="native-20"] .bn-inline-content');const r=e.getBoundingClientRect();scrollBy(0,r.top-300);const n=e.getBoundingClientRect();return {x:n.x+10,y:n.y+n.height/2,width:innerWidth,height:innerHeight,vv:visualViewport.height};''');print(r)
ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: tap','args':[{'x':r['x'],'y':r['y']+62}]});time.sleep(1)
print(call('source',method='GET')[-5000:]);shot('keyboard')
ctx(web);print(js('return {width:innerWidth,height:innerHeight,vv:visualViewport.height,offset:visualViewport.offsetTop,bar:document.querySelector(".editor-phone-toolbar")?.getBoundingClientRect().toJSON(),active:document.activeElement?.className}'))
