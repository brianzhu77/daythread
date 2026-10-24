from driver import *
import driver
ROOT=Path('/tmp/b50-ios');driver.ROOT=ROOT
goto('/day/2026-10-22');js("document.querySelector('[data-content-type=pageLink] .editor-page-card').scrollIntoView({block:'center'})");time.sleep(.5)
tap('felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models');time.sleep(.5)
v=js('return {url:location.href,standalone:navigator.standalone}');print(v,flush=True);assert '/pages?page='in v['url'];snap('standalone-card-open')
goto('/day/2026-10-24');url='https://example.com/?sweep=flat';js("[...document.querySelectorAll('a')].find(a=>a.textContent===arguments[0]).scrollIntoView({block:'center'})",url);time.sleep(.6);tap(url);time.sleep(1)
print('contexts',contexts(),flush=True)
for ctx in contexts():
 if ctx.startswith('WEBVIEW'):
  call('context',{'name':ctx});print('destination',ctx,call('url'),flush=True)
native();ROOT.joinpath('standalone-plain-link.png').write_bytes(base64.b64decode(call('screenshot')));ROOT.joinpath('standalone-plain-link.xml').write_text(call('source'))
