import sys, json; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wd import start
caps={'platformName':'iOS','browserName':'Safari','appium:automationName':'XCUITest','appium:udid':os.environ['JAZZ_UDID'],'appium:connectHardwareKeyboard':False,'appium:forceSimulatorSoftwareKeyboardPresence':True,'appium:derivedDataPath':os.environ['JAZZ_WDA'],'appium:wdaLocalPort':8127,'appium:mjpegServerPort':9127,'appium:wdaLaunchTimeout':600000,'appium:newCommandTimeout':3600,'appium:includeSafariInWebviews':True,'appium:fullContextList':True,'appium:webviewConnectTimeout':20000}
v=start(caps); print(json.dumps({'sessionId':v.get('sessionId'),'error':v.get('error'),'message':str(v.get('message',''))[:500]}))
