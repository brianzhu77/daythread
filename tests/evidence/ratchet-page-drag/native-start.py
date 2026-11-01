from native import *
ctx('NATIVE_APP');call('orientation',{'orientation':'LANDSCAPE'})
call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]})
call('execute/sync',{'script':'mobile: deepLink','args':[{'url':'http://127.0.0.1:3692/','bundleId':'com.apple.mobilesafari'}]});time.sleep(3)
print(call('contexts',method='GET'),flush=True)
try:key('xmark.circle.fill')
except Exception:pass
shot('initial');web=call('contexts',method='GET')[-1];ctx(web);print(js('return {width:innerWidth,height:innerHeight,roots:[...document.querySelectorAll("[role=tree][aria-label=Pages] > li > .tree-row .tree-title")].map(e=>e.textContent)}'),flush=True)
