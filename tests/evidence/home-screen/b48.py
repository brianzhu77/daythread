# B48 in the Home Screen app: three cycles of tap into a line (keyboard up), measure the toolbar against the visible
# part and the native keyboard, then Hide keyboard.
from wd import call
import json,time,os,xml.etree.ElementTree as ET
WEB=os.environ['WEBVIEW']; anchor=os.environ.get('ANCHOR','万圣节装饰、衣服')
def web(): call('context',{'name':WEB})
def native(): call('context',{'name':'NATIVE_APP'})
def js(s): web(); return call('execute/sync',{'script':s,'args':[]})['value']
out=[]
for i in range(3):
    js("[...document.querySelectorAll('.bn-inline-content')].find(x=>x.textContent===%s).scrollIntoView({block:'center'})"%json.dumps(anchor)); time.sleep(.8)
    native(); root=ET.fromstring(call('source')['value'])
    a=next(x for x in root.iter() if x.get('name')==anchor and x.get('visible')=='true')
    for attempt in range(3):
        call('execute/sync',{'script':'mobile: tap','args':[{'x':float(a.get('x'))+20,'y':float(a.get('y'))+10}]}); time.sleep(1.2)
        if js("return document.activeElement?.getAttribute('contenteditable')==='true' && innerHeight - visualViewport.height > 100"): break
        native()
    dom=js("const t=document.querySelector('.editor-phone-toolbar').getBoundingClientRect();return {toolbar:{top:t.top,bottom:t.bottom,height:t.height},vv:{height:visualViewport.height,offsetTop:visualViewport.offsetTop},innerHeight,active:document.activeElement.getAttribute('contenteditable'),standalone:navigator.standalone,tabBar:(()=>{const r=document.querySelector('nav.tab-bar').getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()}")
    native(); root=ET.fromstring(call('source')['value'])
    kb=[{k:x.get(k) for k in ('y','height')} for x in root.iter() if x.get('name')=='q' and x.get('visible')=='true']
    tools=[{k:x.get(k) for k in ('name','y','height','visible')} for x in root.iter('XCUIElementTypeButton') if x.get('name') in ('Indent','Hide keyboard','Line style')]
    shot=call('screenshot')['value']
    import base64; open(f'/tmp/rb-hs/b48-cycle{i+1}.png','wb').write(base64.b64decode(shot))
    overlap=max(0,min(dom['toolbar']['bottom'],dom['tabBar']['bottom'])-max(dom['toolbar']['top'],dom['tabBar']['top']))
    dom['tabBarOverlapPx']=overlap
    ok=bool(kb) and dom['toolbar']['height']>0 and dom['active']=='true' and all(t['visible']=='true' for t in tools) and tools and float(tools[0]['y'])+float(tools[0]['height'])<=float(kb[0]['y']) and not js("return Boolean(document.querySelector('.bn-suggestion-menu, [role=listbox]'))")
    out.append({'cycle':i+1,'ok':ok,'dom':dom,'keyboard':kb,'tools':tools}); print(json.dumps(out[-1]))
    r=call('element',{'using':'accessibility id','value':'Hide keyboard'})['value'];e=r.get('element-6066-11e4-a52e-4f735466cecf')
    if e: call('element/'+e+'/click',{})
    time.sleep(.8)
json.dump(out,open('/tmp/rb-hs/b48-standalone.json','w'),indent=1)
print('ALL OK' if all(o['ok'] for o in out) else 'SOME FAILED')
