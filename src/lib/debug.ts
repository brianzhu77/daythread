export interface DebugFields { operationId?: string; triggerOperationId?: string; command?: string; pageId?: string; taskId?: string; blockId?: string; beforeRevision?: number; afterRevision?: number; elapsedMs?: number; result?: string; error?: string }
const keys = ['operationId','triggerOperationId','command','pageId','taskId','blockId','beforeRevision','afterRevision','elapsedMs','result','error'] as const
export function formatDebug(event: string, fields: DebugFields = {}): string {
  const safe:Record<string,unknown>={time:new Date().toISOString(),level:'debug',event}
  for(const key of keys) if(fields[key]!==undefined) safe[key]=fields[key]
  return JSON.stringify(safe)
}
let enabled=false
export function configureDebug(value:boolean):void {enabled=value}
export function debugClient(event:string,fields:DebugFields={}):void {if(enabled)console.debug(formatDebug(event,fields))}
