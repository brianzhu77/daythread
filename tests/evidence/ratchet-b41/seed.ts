import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts'
import {existsSync} from 'node:fs'
const path=process.argv[2];if(!path.startsWith('/tmp/ratchet177-')||existsSync(path))throw Error('fresh disposable path required');await new SqliteWorkspaceRepository(path,'/tmp/jazz-basics/ws.json').load();console.log(path)
