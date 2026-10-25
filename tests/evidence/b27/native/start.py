from wd import start
import json
udid=open('/tmp/rb-b27n/udid').read().strip()
caps={'platformName':'iOS','browserName':'Safari','appium:automationName':'XCUITest','appium:udid':udid,'appium:deviceName':'iPhone 17','appium:platformVersion':'26.4','appium:connectHardwareKeyboard':False,'appium:forceSimulatorSoftwareKeyboardPresence':True,'appium:derivedDataPath':'/tmp/rb-wda','appium:wdaLocalPort':8117,'appium:mjpegServerPort':9117,'appium:wdaLaunchTimeout':240000,'appium:newCommandTimeout':3600,'appium:includeSafariInWebviews':True,'appium:fullContextList':True}
v=start(caps); print(json.dumps({'sessionId':v.get('sessionId'),'error':v.get('error'),'message':str(v.get('message',''))[:600]}))
