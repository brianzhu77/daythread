from wd import start
import json,sys
udid=open('/tmp/rb-hs/udid').read().strip()
caps={'platformName':'iOS','appium:automationName':'XCUITest','appium:udid':udid,'appium:deviceName':'iPhone 17','appium:platformVersion':'26.4','appium:connectHardwareKeyboard':False,'appium:forceSimulatorSoftwareKeyboardPresence':True,'appium:derivedDataPath':'/tmp/rb-wda','appium:wdaLocalPort':8117,'appium:mjpegServerPort':9117,'appium:wdaLaunchTimeout':180000,'appium:newCommandTimeout':3600,'appium:autoLaunch':False,'appium:noReset':True,'appium:includeSafariInWebviews':True,'appium:fullContextList':True}
if len(sys.argv)>1: caps['appium:bundleId']=sys.argv[1]
v=start(caps); print(json.dumps({'sessionId':v.get('sessionId'),'error':v.get('error'),'message':str(v.get('message',''))[:600]}))
