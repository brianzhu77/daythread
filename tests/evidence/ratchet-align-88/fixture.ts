import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
import {editorSeed,pageContentKey} from '../../../src/domain/editor-document.ts';
const r=new SqliteWorkspaceRepository('/private/tmp/ratchet88.sqlite');
async function exec(action:any){const w=await r.load();return r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action})}
await exec({type:'ensure-day',date:'2026-10-25'});
await exec({type:'create-document',pageId:'ratchet88-empty',parentId:'day:2026-10-25',title:'很长的页面标题用于验证换行后的图标与第一行文字对齐 '.repeat(5),body:''});
let w=await r.load(),p=w.pages.find(p=>p.id==='day:2026-10-25')!;
await exec({type:'save-editor',pageId:p.id,today:'2026-10-20',expectedContent:pageContentKey(p),document:JSON.stringify([...editorSeed(p,w),{id:'ratchet88-card',type:'pageLink',props:{pageId:'ratchet88-empty'}}])});
await exec({type:'paste-links',pageId:p.id,today:'2026-10-20',items:[{url:'https://example.com/ratchet-alignment',pageId:'ratchet88-link',cardBlockId:'ratchet88-link-card',lineType:'paragraph'}]});
console.log('Fixture via real domain commands: long no-preview page card and link card on /day/2026-10-25; copy only.');
