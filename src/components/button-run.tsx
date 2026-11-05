// A tap on a button (docs/design/buttons.md §4). Confirmations first, then the words saved, then one command, and anything opened only after it's committed.
import { useCallback, useRef, useState } from 'react'
import { toast } from '@heroui/react'
import { useNavigate } from '@tanstack/react-router'
import { changesStored, readSteps, safeUrl, stepsKey, type ButtonStep } from '../domain/buttons'
import { pageContentKey } from '../domain/editor-document'
import type { Action, Page } from '../domain/types'
import { todayIso } from './dates'
import { flushAllEditors, flushEditor } from './editor-flush'
import { pageHref } from './page-tree'
import { newOperationId, useWorkspace } from './use-day'

/** Buttons running now, so a second tap does nothing (§4.2), and pages they're changing, so the open editor merges the reply instead of calling it a conflict (§4.8). */
const running = new Set<string>(), arriving = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())
export const subscribeRunning = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const isRunning = (blockId: string): boolean => running.has(blockId)
export const buttonChanging = (pageId: string): boolean => arriving.has(pageId)

/** Show confirmation: answered in a dialog the host draws, with Continue and Cancel. */
let asking: { text: string; answer: (go: boolean) => void } | null = null
export const currentQuestion = () => asking
const ask = (text: string) => new Promise<boolean>(resolve => { asking = { text, answer: go => { asking = null; changed(); resolve(go) } }; changed() })

const refusals = /^.*(Saved elsewhere|Changed elsewhere|That button's gone|No rows matched|Nothing to do| was deleted| is in Trash| at most|: ).*$/
function openUrl(url: string) {
  // Past the wait a browser may block this. The change is already in, and is never sent again for it (§4.7).
  if (window.open(url, '_blank', 'noopener,noreferrer')) return
  toast('Opening that was blocked', { timeout: 8000, actionProps: { children: 'Open', onPress: () => { window.open(url, '_blank', 'noopener,noreferrer') } } })
}

/** What's the same for a page's button and a property's: one at a time, confirmations first, the words saved, one command, and anything opened after it. */
function useTap(onEdit: () => void) {
  const { run, latest } = useWorkspace()
  const navigate = useNavigate()
  return useCallback(async (key: string, stored: string, pageId: string | null, send: (stamp: { at: string; today: string }) => Action) => {
    if (running.has(key)) return
    const steps = readSteps(stored)
    if (!steps.length) { onEdit(); return }
    if (!navigator.onLine && steps.some(changesStored)) { toast('Not run · offline', { timeout: 6000 }); return }
    running.add(key); changed()
    try {
      for (const step of steps) if (step.kind === 'confirm' && !await ask(step.text)) return
      let madeRow: string | undefined
      if (steps.some(changesStored)) {
        // The command starts from what he sees, so what's typed goes first, with any save already on its way.
        if (!await (pageId ? flushEditor(pageId) : flushAllEditors())) { toast('Not run · your words aren\'t saved yet', { timeout: 6000 }); return }
        if (pageId) arriving.add(pageId)
        const action = send({ at: new Date().toISOString(), today: todayIso() })
        const operationId = newOperationId()
        const last = [...steps].reverse().find(changesStored)
        const notice = (r: { message: string; operationId: string; entityId?: string }) => ({ text: r.message, undoOperationId: r.operationId, ...(last?.kind === 'add-row' && r.entityId ? { extra: { label: 'Open', run: () => { void navigate({ href: `/pages?page=${encodeURIComponent(r.entityId!)}` }) } } } : {}) })
        let refusal: string | null = null
        const once = () => run(action, notice, operationId, { inlineRefusal: refusals, onRefused: message => { refusal = message } })
        let receipt = await once()
        // A tab behind the workspace is refused whatever it sends, and comes back up to date; the keys in the action then decide (§4.8).
        if (!receipt && refusal !== null && /Saved elsewhere/.test(refusal)) { refusal = null; receipt = await once() }
        if (!receipt) { if (refusal !== null) refused(refusal, steps, onEdit, run); return }
        madeRow = receipt.entityId
      }
      // After the commit, so a blocked page or popup can't send it again (§4.7).
      for (const step of steps) {
        if (step.kind !== 'open') continue
        if (step.target.kind === 'url') { const url = safeUrl(step.target.url); if (url) openUrl(url) }
        else {
          const to = step.target.kind === 'page' ? latest()?.pages.find(p => p.id === (step.target as { pageId: string }).pageId) : latest()?.pages.find(p => p.id === madeRow)
          if (to) void navigate({ href: pageHref(to) })
          else if (step.target.kind === 'page') toast(`${step.target.name} was deleted`, { timeout: 6000 })
        }
      }
    } finally {
      running.delete(key); changed()
      // The reply's page arrives with a render just after this.
      if (pageId) setTimeout(() => arriving.delete(pageId), 300)
    }
  }, [run, latest, navigate, onEdit])
}

export function useRunButton(onEdit: (blockId: string) => void) {
  const { latest } = useWorkspace()
  const [edit] = useState(() => ({ current: onEdit })); edit.current = onEdit
  const blockRef = useRef('')
  const tap = useTap(useCallback(() => edit.current(blockRef.current), [edit]))
  return useCallback((page: Pick<Page, 'id'>, blockId: string, stored: string) => {
    blockRef.current = blockId
    return tap(blockId, stored, page.id, stamp => {
      const now = latest()?.pages.find(p => p.id === page.id)
      return { type: 'run-button', pageId: page.id, blockId, stepsKey: stepsKey(stored), expectedContent: now ? pageContentKey(now) : '', ...stamp }
    })
  }, [tap, latest])
}
/** A Button property, on one row or several chosen ones (§6). */
export function useRunRowButton(onEdit: () => void) {
  const tap = useTap(onEdit)
  return useCallback((databaseId: string, propertyId: string, stored: string, rowIds: string[]) => tap(`${propertyId}:${rowIds.join()}`, stored, null, stamp => ({ type: 'run-row-button', databaseId, propertyId, rowIds, stepsKey: stepsKey(stored), ...stamp })), [tap])
}

/** A broken target, said at the tap, with the way to mend it (§4.4). */
function refused(message: string, steps: readonly ButtonStep[], onEdit: () => void, run: ReturnType<typeof useWorkspace>['run']) {
  if (/ is in Trash$/.test(message)) {
    const step = steps.find(s => (s.kind === 'add-row' || s.kind === 'edit-rows') && message.startsWith(s.databaseName)) as { databaseId: string } | undefined
    toast(message, { timeout: 8000, ...(step ? { actionProps: { children: 'Restore', onPress: () => { void run({ type: 'restore-page', pageId: step.databaseId }, { text: 'Restored' }) } } } : {}) })
  } else if (/ was deleted$/.test(message)) toast(message, { timeout: 8000, actionProps: { children: 'Edit', onPress: onEdit } })
  else toast(/elsewhere/.test(message) ? 'Changed in another tab, so nothing ran' : message, { timeout: 6000 })
}
