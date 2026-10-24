from driver import *
import driver
driver.ROOT=Path('/tmp/b50-ios');tap('Close');goto('/day/2026-10-22');js("document.querySelector('[data-content-type=pageLink] .editor-page-card').scrollIntoView({block:'center'})");time.sleep(.6)
r=js("return document.querySelector('[data-content-type=pageLink] .editor-page-card-open').getBoundingClientRect().toJSON()");native();call('execute/sync',{'script':'mobile: tap','args':[{'x':r['left']+r['width']/2,'y':r['top']+r['height']/2}]});time.sleep(3);s=source();Path('/tmp/b50-ios/standalone-website.xml').write_text(s);print([(e.get('name'),e.get('value'))for e in ET.fromstring(s).iter()if e.get('name')=='URL'],flush=True);Path('/tmp/b50-ios/standalone-website.png').write_bytes(base64.b64decode(call('screenshot')))
