import {existsSync} from 'node:fs'
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
const path=process.argv[2];if(!path?.startsWith('/tmp/ratchet-163-')||existsSync(path))throw Error('new isolated path')
const r=new SqliteWorkspaceRepository(path),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'}).format(new Date())
await r.execute({operationId:'seed',expectedRevision:0,action:{type:'ensure-day',date:today}})
console.log(today)
