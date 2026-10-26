import { AsyncLocalStorage } from 'node:async_hooks'
import type { Command } from '../domain/types.ts'
import { formatDebug, type DebugFields } from '../lib/debug.ts'
export type LogFields = DebugFields
const context=new AsyncLocalStorage<{operationId:string}>()
export const logOperationId=()=>context.getStore()?.operationId
export function withLogOperation<T>(operationId:string,work:()=>T):T {return context.run({operationId},work)}
export const debugEnabled = () => process.env.DAYTHREAD_LOG === 'debug'
export function debugLog(event: string, fields: LogFields = {}): void {
  if (debugEnabled()) console.debug(formatDebug(event,{...context.getStore(),...fields}))
}
export function commandLogFields(c: Command): LogFields {
  const a = c.action
  return {operationId:c.operationId,command:a.type,beforeRevision:c.expectedRevision,...('pageId' in a ? {pageId:a.pageId}:{}),...('taskId' in a ? {taskId:a.taskId}:{})}
}
