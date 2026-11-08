import json, sys
sys.path.insert(0, '/tmp/lead-native')
from wd import start
udid = open('/tmp/lead-sim-udid').read().strip()
caps = {'platformName': 'iOS', 'browserName': 'Safari', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:deviceName': 'iPhone 17 Pro', 'appium:platformVersion': '26.4',
        'appium:connectHardwareKeyboard': False, 'appium:forceSimulatorSoftwareKeyboardPresence': True, 'appium:derivedDataPath': '/tmp/lead-wda', 'appium:wdaLocalPort': 8157, 'appium:mjpegServerPort': 9157,
        'appium:wdaLaunchTimeout': 300000, 'appium:newCommandTimeout': 3600, 'appium:includeSafariInWebviews': True, 'appium:fullContextList': True}
v = start(caps); print(json.dumps({'sessionId': v.get('sessionId'), 'error': v.get('error'), 'message': str(v.get('message', ''))[:600]}))
