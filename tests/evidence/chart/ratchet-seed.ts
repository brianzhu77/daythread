import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {pageContentKey} from '../../../src/domain/editor-document.ts'
const r=new SqliteWorkspaceRepository(process.argv[2]!);let w=await r.load();
async function run(action:any){w=(await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action})).workspace}
await run({type:'create-document',pageId:'chart-review',title:'Chart review',body:''});
const view={id:'review',name:'Chart',layout:'chart',filter:[],sort:[],groupBy:'status',chart:{form:'bar'}};
const line=(id:string,t:string)=>({id,type:'paragraph',props:{},content:[{type:'text',text:t,styles:{}}],children:[]});
await run({type:'save-editor',pageId:'chart-review',expectedContent:pageContentKey(w.pages.find(p=>p.id==='chart-review')!),document:JSON.stringify([line('before','Before chart'),...['c1','c2'].map(id=>({id,type:'database',props:{pageId:'list',view:JSON.stringify(view)},children:[]})),line('after','After chart')])});
