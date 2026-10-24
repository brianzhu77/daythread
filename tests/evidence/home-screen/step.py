import sys,json,re
from wd import call
cmd=sys.argv[1]
if cmd=='contexts': print(json.dumps(call('contexts')['value'],ensure_ascii=False)[:2000])
elif cmd=='ctx': print(call('context',{'name':sys.argv[2]}))
elif cmd=='url': print(call('url',{'url':sys.argv[2]}))
elif cmd=='js': print(json.dumps(call('execute/sync',{'script':sys.argv[2],'args':[]}),ensure_ascii=False)[:3000])
elif cmd=='names':
    s=call('source')['value']
    names=re.findall(r'<(XCUIElementType\w+)[^>]*?name="([^"]*)"[^>]*?visible="true"',s)
    print(json.dumps([f'{t[16:]}:{n}' for t,n in names][:int(sys.argv[2]) if len(sys.argv)>2 else 120],ensure_ascii=False))
elif cmd=='tap':
    r=call('element',{'using':'accessibility id','value':sys.argv[2]})['value'];e=r.get('element-6066-11e4-a52e-4f735466cecf')
    print(call('element/'+e+'/click',{}) if e else r)
elif cmd=='tappred':
    r=call('element',{'using':'-ios predicate string','value':sys.argv[2]})['value'];e=r.get('element-6066-11e4-a52e-4f735466cecf')
    print(call('element/'+e+'/click',{}) if e else r)
elif cmd=='shot':
    import base64; open(sys.argv[2],'wb').write(base64.b64decode(call('screenshot')['value'])); print('saved')
elif cmd=='mobile': print(json.dumps(call('execute/sync',{'script':'mobile: '+sys.argv[2],'args':[json.loads(sys.argv[3]) if len(sys.argv)>3 else {}]}),ensure_ascii=False)[:2000])
