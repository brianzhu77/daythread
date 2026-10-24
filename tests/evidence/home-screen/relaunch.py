# Quit the Home Screen app and open it again from its icon (page 2 of the Home Screen); prints the new web view id.
from wd import call
import time,re,json
call('context',{'name':'NATIVE_APP'})
call('execute/sync',{'script':'mobile: terminateApp','args':[{'bundleId':'com.apple.webapp'}]})
call('execute/sync',{'script':'mobile: pressButton','args':[{'name':'home'}]}); time.sleep(1)
for _ in range(3):
    s=call('source')['value']; m=re.search(r'<XCUIElementTypeIcon[^>]*?label="Daythread"[^>]*?visible="true"[^>]*?x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"',s)
    if m: break
    call('execute/sync',{'script':'mobile: swipe','args':[{'direction':'left'}]}); time.sleep(1)
x,y,w,h=map(int,m.groups()); call('execute/sync',{'script':'mobile: tap','args':[{'x':x+w/2,'y':y+h/3}]}); time.sleep(4)
print(json.dumps([c for c in call('contexts')['value'] if c.get('bundleId')=='com.apple.SafariViewService']))
