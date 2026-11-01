import {DatabaseSync} from 'node:sqlite';
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
import {harness,dayId,todo,heading} from '../../v2-helpers.ts';
const h=harness();h.day('2026-10-31');h.save(dayId('2026-10-31'),()=>[heading('old','TODO'),todo('carry','Existing carry','plan','2026-10-31')],{today:'2026-10-31'});
const path='/tmp/ratchet257.sqlite';await new SqliteWorkspaceRepository(path).load();const db=new DatabaseSync(path);db.prepare('update workspace set revision=?,data=? where id=1').run(h.ws.revision,JSON.stringify(h.ws));db.close();
