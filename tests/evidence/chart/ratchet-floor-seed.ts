import {writeFileSync} from 'node:fs'
import {harness} from '../../v2-helpers.ts'
const h=harness(),at='2026-11-05T10:00:00.000Z'
h.run({type:'create-database',pageId:'db',title:'DB',homeBlockId:null})
h.run({type:'change-database',pageId:'db',change:{kind:'addProperty',property:{id:'date',name:'Date',type:'date'}}})
h.run({type:'add-row',databaseId:'db',pageId:'r',title:'One',values:{date:{start:'2027-01-01'}},at})
const id=h.page('db').database!.views[0]!.id
h.run({type:'change-database',pageId:'db',change:{kind:'updateView',viewId:id,layout:'chart',groupBy:'date',groupDateBy:'week',chart:{form:'bar',byYear:true}}})
writeFileSync(process.argv[2],JSON.stringify(h.ws))
