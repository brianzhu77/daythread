import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ContinuousPage } from '../components/continuous-page'
import { todayIso } from '../components/dates'
import { WorkspaceProvider, useWorkspace, type Transport } from '../components/use-day'
import { applyCommand, createEmptyWorkspace } from '../domain/workspace'
import type { Workspace } from '../domain/types'
import recorder from '../../tests/evidence/b49/recorder.js?raw'

export const Route = createFileRoute('/debug-ime')({ component: DebugIme })

/** Draft slots of this page only; never one of his pages (B35/B40 would otherwise pick it up and save it). */
const scratchId = 'debug-ime:scratch'
const clearScratchDrafts = () => {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(`daythread:editor:${scratchId}`)) localStorage.removeItem(key) } catch { /* no storage */ }
}

/**
 * B49 (Lead): a scratch page for one recording of iOS pinyin. The same editor as a day page, on an empty day held in
 * this tab's memory: nothing is loaded from or saved to his workspace, and the page's draft slots are cleared. It
 * records keys, composition and input events and DOM changes (tests/evidence/b49/recorder.js) for "Copy log".
 */
function DebugIme() {
  const transport = useMemo<Transport>(() => {
    let ws: Workspace = applyCommand(createEmptyWorkspace(), { operationId: 'debug-ime', expectedRevision: 0, action: { type: 'ensure-day', date: todayIso() } }).workspace
    ws = { ...ws, pages: ws.pages.map(p => ({ ...p, id: scratchId })) }
    return {
      load: async () => ws,
      run: async (current, action, operationId = crypto.randomUUID()) => { const result = applyCommand(current, { operationId, expectedRevision: current.revision, action }); ws = result.workspace; return result },
    }
  }, [])
  useEffect(() => {
    clearScratchDrafts()
    // eslint-disable-next-line no-new-func
    new Function(recorder)()
    window.addEventListener('pagehide', clearScratchDrafts)
    return () => { window.removeEventListener('pagehide', clearScratchDrafts); clearScratchDrafts() }
  }, [])
  return (
    <main className="debug-ime">
      <h1>Typing test</h1>
      <p className="quiet">Nothing here is saved. Under Notes, start a new line, type a word in pinyin and pick the first candidate. Then tap Copy log and paste it in the chat.</p>
      <WorkspaceProvider transport={transport}><ScratchDay /></WorkspaceProvider>
    </main>
  )
}

function ScratchDay() {
  const { workspace, latest } = useWorkspace()
  const [copied, setCopied] = useState('')
  const page = workspace?.pages.find(p => p.id === scratchId)
  if (!workspace || !page) return <p className="loading">Opening…</p>
  const copy = async () => {
    // The lines as the editor shows them now (nesting, text), and as last kept in this tab's memory.
    const lines = [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].map(b => ({ id: (b as HTMLElement).dataset.id, depth: b.parentElement?.closest('[data-node-type="blockContainer"]') ? 1 : 0, type: b.querySelector('[data-content-type]')?.getAttribute('data-content-type'), text: b.querySelector('.bn-inline-content')?.textContent ?? '' }))
    const saved = latest()?.pages.find(p => p.id === scratchId)?.editorJSON ?? null
    const log = JSON.stringify({ userAgent: navigator.userAgent, lines, saved, events: (window as { __b49log?: unknown[] }).__b49log ?? [] })
    try { await navigator.clipboard.writeText(log); setCopied(`Copied (${Math.round(log.length / 1024)} KB)`) } catch { setCopied("Couldn't copy") }
  }
  return (
    <>
      <p><button type="button" className="app-button" onClick={() => void copy()}>Copy log</button> <span className="quiet">{copied}</span></p>
      <ContinuousPage page={page} workspace={workspace} />
    </>
  )
}
