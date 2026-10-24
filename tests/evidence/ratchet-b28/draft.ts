import {applyCommand} from '../../../src/domain/workspace.ts'
import {DatabaseSync} from 'node:sqlite'
import {readWorkspace,writeWorkspace} from '../../../src/server/sqlite-mapping.ts'
const db=new DatabaseSync('/tmp/rb-b28-ratchet174.sqlite');const before=readWorkspace(db);const ws=applyCommand(before,{operationId:'ratchet-draft-seed',expectedRevision:before.revision,action:{type:'ensure-day',date:'2026-10-24'}}).workspace;const day=ws.pages.find(p=>p.date==='2026-10-23')!;day.reviewStep=5;day.reviewSource='direct';const next=ws.pages.find(p=>p.date==='2026-10-24')!;next.draft={simulated:true,taskIds:['g','c1','P','c3','c2','Q'].map(n=>ws.tasks.find(t=>t.title===n)!.id),materialIds:[],text:''};writeWorkspace(db,before,ws);db.close()
