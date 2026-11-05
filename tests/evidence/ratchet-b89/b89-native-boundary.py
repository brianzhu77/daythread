exec(open('scripts/b89-native-calibrate.py').read().split("print('contexts'")[0])
import subprocess
results=[]
web=json.load(open('/tmp/ratchet131-native-context.json'))['context']
for page,block in [('bdb','bdb-z'),('emptybelow','eb-0')]:
 call('/context',{'name':web});call('/url',{'url':'http://127.0.0.1:3698/pages?page='+page});time.sleep(4)
 css='[data-id="'+block+'"] .bn-inline-content';js('document.querySelector('+json.dumps(css)+').scrollIntoView({block:"center"})');time.sleep(.5);call('/context',{'name':'NATIVE_APP'});e=call('/element',{'using':'accessibility id','value':'Below' if page=='bdb' else 'Above'});call('/element/'+next(iter(e.values()))+'/click',{});call('/context',{'name':web});time.sleep(.3)
 before=js('''const el=document.querySelector('''+json.dumps(css)+''');document.querySelector('.ProseMirror').focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);window.__keys=[];window.__inputs=[];window.addEventListener('keydown',e=>__keys.push({key:e.key,trusted:e.isTrusted}));window.addEventListener('beforeinput',e=>__inputs.push({type:e.inputType,trusted:e.isTrusted}));return {width:innerWidth,active:document.activeElement.className,offset:s.anchorOffset,text:s.anchorNode.textContent}''')
 call('/context',{'name':'NATIVE_APP'});e=call('/element',{'using':'accessibility id','value':'delete'});call('/element/'+next(iter(e.values()))+'/click',{});time.sleep(2);call('/context',{'name':web});events=js('return {keys:__keys,inputs:__inputs}')
 ws=json.loads(subprocess.check_output(['sqlite3','/tmp/ratchet-b89-native.sqlite','select data from workspace']));p=next(x for x in ws['pages'] if x['id']==page);nodes=json.loads(p['document']);result={'page':page,'before':before,'events':events,'nodes':nodes,'dbLive':not next(x for x in ws['pages'] if x['id']=='home-db').get('trashedAt')};results.append(result);print(json.dumps(result),flush=True)
json.dump(results,open('/tmp/ratchet131-native-boundary.json','w'),indent=2)
