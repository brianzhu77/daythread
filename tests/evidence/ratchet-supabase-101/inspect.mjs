import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/private/tmp/ratchet101.sqlite',{readOnly:true});
for(const {name} of d.prepare("select name from sqlite_master where type='table' order by name").all()){
 console.log('TABLE',name,JSON.stringify(d.prepare(`pragma table_info("${name}")`).all().map(r=>({name:r.name,type:r.type,pk:r.pk}))));
 console.log('COUNTS',JSON.stringify(d.prepare(`select ${!d.prepare(`pragma table_info("${name}")`).all().some(r=>r.name==='snapshot')?'count(*) as n':'snapshot,count(*) as n'} from "${name}" ${!d.prepare(`pragma table_info("${name}")`).all().some(r=>r.name==='snapshot')?'':'group by snapshot'}`).all()));
}
d.close();
