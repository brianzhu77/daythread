from driver import *
import driver
driver.ROOT=Path('/tmp/b213-ios');native();call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]});time.sleep(.8);contexts();driver.web=lambda:call('context',{'name':'WEBVIEW_57921.1'});out=[]
for path,name in [('/','today'),('/tasks','tasks'),('/review','review')]:
 goto(path);js('scrollTo(0,0)');v=js('return {url:location.href,standalone:navigator.standalone,safe:document.querySelector(".safe-top").getBoundingClientRect().toJSON(),padding:getComputedStyle(document.querySelector(".app-content")).paddingTop,title:document.querySelector("h1").getBoundingClientRect().toJSON(),color:getComputedStyle(document.querySelector(".safe-top")).backgroundColor}');print(v,flush=True);out.append(v);snap('safari-'+name);assert not v['standalone']and v['safe']['height']==0 and v['padding']=='0px'
Path('/tmp/b213-ios/safari-screens.json').write_text(json.dumps(out,indent=2))
