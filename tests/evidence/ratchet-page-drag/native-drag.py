from native import *
web=call('contexts',method='GET')[-1];ctx(web)
v=js('''const rows=[...document.querySelectorAll('.sidebar .tree-row[data-page]')];const rect=t=>rows.find(e=>e.querySelector('.tree-title').textContent===t).getBoundingClientRect().toJSON();window.__dragEvidence=[];new MutationObserver(()=>{const e=document.querySelector('[data-dragging]');if(e)window.__dragEvidence.push({at:Date.now(),touch:e.dataset.dragging,title:e.querySelector('.tree-title').textContent,chip:document.querySelector('.tree-drag-chip')?.textContent});}).observe(document.querySelector('.sidebar'),{subtree:true,attributes:true,attributeFilter:['data-dragging']});document.addEventListener('contextmenu',()=>window.__dragEvidence.push({contextmenu:true}));return {from:rect('Delta'),to:rect('Charlie'),url:location.href};''');print(v,flush=True)
a={'x':100,'y':v['from']['y']+15+86};z={'x':100,'y':v['to']['y']+3+86}
ctx('NATIVE_APP')
call('actions',{'actions':[{'type':'pointer','id':'finger','parameters':{'pointerType':'touch'},'actions':[{'type':'pointerMove','duration':0,**a},{'type':'pointerDown','button':0},{'type':'pause','duration':3000},{'type':'pointerMove','duration':600,**z},{'type':'pause','duration':200},{'type':'pointerUp','button':0}]}]})
time.sleep(.7);shot('native-drop');source=call('source',method='GET');Path('/tmp/ratchet256-drop.xml').write_text(source)
ctx(web);print(js('''return {roots:[...document.querySelectorAll('[role=tree][aria-label=Pages] > li > .tree-row .tree-title')].map(e=>e.textContent),toast:document.querySelector('.app-toasts')?.textContent,url:location.href,evidence:window.__dragEvidence};'''),flush=True)

ctx('NATIVE_APP');key('Undo');time.sleep(.6);shot('native-undo');ctx(web);print('UNDO',js('return [...document.querySelectorAll("[role=tree][aria-label=Pages] > li > .tree-row .tree-title")].map(e=>e.textContent)'),flush=True)
