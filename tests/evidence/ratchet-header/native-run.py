import json,time,base64
from native import call,script
out=[]
def note(name,value):out.append({'check':name,**value});print(json.dumps(out[-1]),flush=True)
def tap(css):
 e=call('/element',{'using':'css selector','value':css});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(.7)
def go(path):call('/url',{'url':'http://127.0.0.1:3699'+path});time.sleep(1.3)
def shot(name):open('tests/evidence/ratchet-header/'+name+'.png','wb').write(base64.b64decode(call('/screenshot')))
call('/appium/settings',{'settings':{'nativeWebTap':True}})
go('/pages?view=bookmarks');tap('[data-bookmark="dan"] .bookmark-main')
note('bookmark header',script('return {url:location.href,crumbs:document.querySelector(".crumbs-path")?.innerText.trim(),linked:document.querySelector(".linked-from")?.innerText??null,width:innerWidth,standalone:navigator.standalone}'));shot('native-header')
tap('.crumb-last');note('day lands on card',script('const e=document.querySelector(".block-flash"); const r=e?.getBoundingClientRect();return {url:location.href,flash:!!e,cardVisible:!!r&&r.top>=0&&r.bottom<=innerHeight}'));shot('native-day-card')
go('/pages?view=bookmarks');script('document.querySelector("[data-bookmark=many3]").scrollIntoView({block:"center"});return scrollY');time.sleep(.3);tap('[data-bookmark="many3"] .bookmark-main');call('/refresh',{});time.sleep(1.3);tap('.crumb-back')
note('return after reload',script('const r=document.querySelector("[data-bookmark=many3]").getBoundingClientRect();return {url:location.href,scroll:scrollY,top:r.top,bottom:r.bottom,height:innerHeight,rowVisible:r.top>=0&&r.bottom<=innerHeight}'));shot('native-return')
go('/pages?page=leaf');note('Trash parent',script('return {crumbs:document.querySelector(".crumbs-path").innerText.trim()}'))
go('/pages?page=heads&from=bookmarks');note('long path',script('const e=document.querySelector(".crumbs-path");return {crumbs:e.innerText.trim(),overflow:e.scrollWidth>e.clientWidth+1,cut:[...e.querySelectorAll(".crumb")].some(c=>c.getBoundingClientRect().right>e.getBoundingClientRect().right+1)}'));shot('native-long-path')
open('tests/evidence/ratchet-header/native-results.json','w').write(json.dumps(out,indent=2))
assert out[0]['crumbs'].replace('\n',' ')=='Bookmarks Tue, Nov 3' and out[0]['linked'] is None and out[0]['standalone'] is False
assert out[1]['flash'] and out[1]['cardVisible'] and '/day/2026-11-03' in out[1]['url']
assert out[2]['rowVisible'] and out[2]['scroll']>0
assert 'Gone parent' not in out[3]['crumbs'] and 'Middle row' in out[3]['crumbs']
assert not out[4]['overflow'] and not out[4]['cut']
print('ALL PASS')
