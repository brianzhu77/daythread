from native import *
web=call('contexts',method='GET')[-1];ctx(web)
print(js('''document.activeElement.blur();location.reload();return true;'''));time.sleep(2)
print(js('''const e=document.querySelector('[data-id="native-20"] .bn-inline-content');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+10,y:r.y+10};'''))
