from native import *
web=call('contexts',method='GET')[-1];ctx(web)
r=js('const e=document.querySelector(".editor-phone-toolbar button:nth-child(2)");const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};')
ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: tap','args':[{'x':r['x'],'y':r['y']+62}]});time.sleep(.5)
for i in range(4):
 ctx(web);v=js('''const m=document.querySelector('#bn-suggestion-menu'),e=[...m.querySelectorAll('[role=option]')].at(-1);return {menu:m.getBoundingClientRect().toJSON(),last:e.getBoundingClientRect().toJSON(),scroll:m.scrollTop,max:m.scrollHeight-m.clientHeight};''');print(i,v,flush=True)
 if v['last']['bottom']<=v['menu']['bottom']+1 and v['last']['top']>=v['menu']['top']-1:break
 ctx('NATIVE_APP');call('execute/sync',{'script':'mobile: dragFromToForDuration','args':[{'duration':.6,'fromX':150,'fromY':240,'toX':150,'toY':120}]});time.sleep(.4)
ctx('NATIVE_APP');shot('native-scroll-last')
source=call('source',method='GET');Path('/tmp/ratchet255-scroll.xml').write_text(source)
