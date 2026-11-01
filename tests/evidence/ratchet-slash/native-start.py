from native import *
ctx('NATIVE_APP')
call('execute/sync',{'script':'mobile: activateApp','args':[{'bundleId':'com.apple.mobilesafari'}]})
call('execute/sync',{'script':'mobile: deepLink','args':[{'url':'http://127.0.0.1:3691/pages?page=review','bundleId':'com.apple.mobilesafari'}]})
time.sleep(3)
print(call('contexts',method='GET'))
print(call('source',method='GET')[-6000:])
