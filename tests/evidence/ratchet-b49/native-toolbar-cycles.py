from wd import call
import json,time,xml.etree.ElementTree as ET,os
out=[]
def native():call('context',{'name':'NATIVE_APP'})
def web():call('context',{'name':os.environ['WEBVIEW_CONTEXT']})
def tapname(name):
 r=call('element',{'using':'accessibility id','value':name})['value'];e=r.get('element-6066-11e4-a52e-4f735466cecf');assert e,r;call('element/'+e+'/click',{})
native()
try:tapname('Hide keyboard')
except:pass
for i in range(3):
 web();call('execute/sync',{'script':'''[...document.querySelectorAll('.bn-inline-content')].find(x=>x.textContent==='万圣节装饰、衣服').scrollIntoView({block:'center'});''','args':[]})
 time.sleep(.7);native();root=ET.fromstring(call('source')['value']);a=next(x for x in root.iter() if x.get('name')=='万圣节装饰、衣服' and x.get('visible')=='true');call('execute/sync',{'script':'mobile: tap','args':[{'x':float(a.get('x'))+20,'y':float(a.get('y'))+10}]});time.sleep(.4)
 web();dom=call('execute/sync',{'script':'''return {toolbar:document.querySelector('.editor-phone-toolbar').getBoundingClientRect().toJSON(),vv:{height:visualViewport.height,offsetTop:visualViewport.offsetTop},innerHeight,active:document.activeElement.getAttribute('contenteditable')};''','args':[]})['value']
 native();root=ET.fromstring(call('source')['value']);keys=[x.attrib for x in root.iter('XCUIElementTypeKeyboard') if x.get('visible')=='true'];tools=[x.attrib for x in root.iter('XCUIElementTypeButton') if x.get('name') in ['Indent','Hide keyboard']];
 if not keys:
  call('execute/sync',{'script':'mobile: tap','args':[{'x':float(a.get('x'))+20,'y':float(a.get('y'))+10}]});time.sleep(.7);web();dom=call('execute/sync',{'script':"return {toolbar:document.querySelector('.editor-phone-toolbar').getBoundingClientRect().toJSON(),vv:{height:visualViewport.height,offsetTop:visualViewport.offsetTop},innerHeight,active:document.activeElement.getAttribute('contenteditable')};",'args':[]})['value'];native();root=ET.fromstring(call('source')['value']);keys=[x.attrib for x in root.iter('XCUIElementTypeKeyboard') if x.get('visible')=='true'];tools=[x.attrib for x in root.iter('XCUIElementTypeButton') if x.get('name') in ['Indent','Hide keyboard']]
 assert keys and tools and dom['toolbar']['height']==50,(dom,keys,tools)
 out.append({'cycle':i+1,'dom':dom,'keyboards':keys,'tools':tools});print(json.dumps(out[-1]));tapname('Hide keyboard');time.sleep(.2)
json.dump(out,open('/tmp/ratchet196/toolbar-real.json','w'),indent=2)
