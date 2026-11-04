// Import a CSV (docs/design/csv.md §4, R4-8): read and parsed here, so the preview costs the server nothing and nothing's sent until he
// confirms. It only adds rows. What can't be read is counted and named, and a column he leaves out is named too.
import { toast } from '@heroui/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { decodeCsv, importKinds, importRefusal, planImport, readSheet, workspaceBytes, workspaceWarnBytes, type ImportKind, type ImportSheet, type ImportTarget } from '../domain/csv'
import { isDatabase, isReadOnly, typeLabels, type Database } from '../domain/database'
import { withLinks } from '../domain/relations'
import { useWorkspace } from './use-day'

export type ImportInto = { kind: 'new'; parentId?: string; place?: (pageId: string) => Promise<string | null> } | { kind: 'merge'; databaseId: string }
type Open = { into: ImportInto; name: string; text: string }
let open: Open | null = null
const listeners = new Set<() => void>()
const setOpen = (next: Open | null) => { open = next; listeners.forEach(l => l()) }
const maxFileBytes = 50 * 1024 * 1024

/** Called in the tap: a browser only opens its file picker for one. */
export function chooseCsv(into: ImportInto) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > maxFileBytes) { toast(`That file is ${(file.size / 1048576).toFixed(0)} MB, and an import reads up to 50 MB. Nothing was written.`, { timeout: 8000 }); return }
    setOpen({ into, name: file.name.replace(/\.[^.]+$/, ''), text: decodeCsv(new Uint8Array(await file.arrayBuffer())) })
  }
  input.click()
}

const targetKey = (t: ImportTarget) => (t.to === 'new' ? `new:${t.kind}` : t.to === 'existing' ? `existing:${t.propertyId}` : t.to)
function targetOf(key: string): ImportTarget {
  if (key === 'name' || key === 'skip') return { to: key }
  const [kind, value] = key.split(/:(.*)/) as [string, string]
  return kind === 'new' ? { to: 'new', kind: value as ImportKind } : { to: 'existing', propertyId: value }
}

function ImportDialog({ open: { into, name, text } }: { open: Open }) {
  const { workspace, run } = useWorkspace()
  const read = useMemo(() => (workspace ? withLinks(workspace) : null), [workspace])
  const target = into.kind === 'merge' ? read?.pages.find(p => p.id === into.databaseId) : undefined
  const db: Database | null = isDatabase(target) ? target.database : null
  const [sheet, setSheet] = useState<ImportSheet>(() => readSheet(text, db))
  const [title, setTitle] = useState(name)
  const [busy, setBusy] = useState(false)
  const plan = useMemo(() => { let n = 0; return planImport(sheet, db, () => `preview-${n++}`) }, [sheet, db])
  const refusal = workspace ? importRefusal(workspace, plan.rows) : null
  const close = () => setOpen(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])
  const choose = (index: number, key: string) => setSheet(s => ({ ...s, columns: s.columns.map(c => (c.index === index ? { ...c, target: targetOf(key) } : c.target.to === 'name' && key === 'name' ? { ...c, target: { to: 'new', kind: c.suggested } } : c)) }))
  const write = async () => {
    if (busy || refusal) return
    setBusy(true)
    const final = planImport(sheet, db, () => crypto.randomUUID())
    const databaseId = into.kind === 'merge' ? into.databaseId : crypto.randomUUID()
    let homeBlockId: string | null = null
    if (into.kind === 'new' && into.place) homeBlockId = await into.place(databaseId)
    const counted = final.bad.length ? ` · ${final.bad.length} cell${final.bad.length === 1 ? '' : 's'} couldn't be read` : ''
    const receipt = await run({ type: 'import-csv', databaseId, ...(into.kind === 'new' ? { create: { parentId: into.parentId ?? null, homeBlockId, title: title.trim() } } : {}), changes: final.changes, rows: final.rows, at: new Date().toISOString() }, r => ({ text: `${final.rows.length} row${final.rows.length === 1 ? '' : 's'} imported${counted}`, undoOperationId: r.operationId }))
    setBusy(false)
    if (receipt) close()
  }
  const properties = db?.properties.filter(p => !isReadOnly(p) && p.type !== 'rollup') ?? []
  return <>
    <div className="database-menu-scrim csv-import-scrim" aria-hidden="true" onClick={close} />
    <div className="app-menu database-menu csv-import" role="dialog" aria-label="Import CSV" onKeyDown={e => e.stopPropagation()}>
      <div className="database-menu-head"><span>{into.kind === 'merge' ? `Merge with ${target?.title || 'Untitled'}` : 'Import CSV'}</span></div>
      {into.kind === 'new' && <input className="database-menu-field" aria-label="Database name" placeholder="Database name" value={title} onChange={e => setTitle(e.target.value)} />}
      <div className="csv-import-columns">
        {sheet.columns.map(c => <div key={c.index} className="csv-import-column">
          <div className="csv-import-words">
            <span className="csv-import-header">{c.header}</span>
            <span className="database-menu-quiet csv-import-samples">{c.samples.join(' · ') || 'Empty'}</span>
          </div>
          <select aria-label={`Where ${c.header} goes`} value={targetKey(c.target)} onChange={e => choose(c.index, e.target.value)}>
            <option value="name">Name</option>
            {properties.length > 0 && <optgroup label={`In ${target?.title || 'Untitled'}`}>{properties.map(p => <option key={p.id} value={`existing:${p.id}`}>{p.name}</option>)}</optgroup>}
            <optgroup label="New property">{importKinds.map(k => <option key={k} value={`new:${k}`}>{typeLabels[k]}</option>)}</optgroup>
            <option value="skip">Don't import</option>
          </select>
          {Boolean(plan.badByColumn[c.index]) && <span className="csv-import-bad">{plan.badByColumn[c.index]} won't read</span>}
        </div>)}
      </div>
      <div className="csv-import-summary" role="status">
        <p>{plan.rows.length.toLocaleString('en-US')} row{plan.rows.length === 1 ? '' : 's'} to add. It only adds rows, and doesn't look for duplicates.</p>
        {plan.skipped.length > 0 && <p>Left out: {plan.skipped.join(', ')}</p>}
        {sheet.extraCells > 0 && <p className="csv-import-bad">{sheet.extraCells} cell{sheet.extraCells === 1 ? '' : 's'} past the last header left out</p>}
        {plan.bad.length > 0 && <p className="csv-import-bad">{plan.bad.length} cell{plan.bad.length === 1 ? '' : 's'} won't read and stay empty: {plan.bad.slice(0, 5).map(b => `row ${b.row}, ${b.column}: “${b.value}”`).join('; ')}{plan.bad.length > 5 ? ` and ${plan.bad.length - 5} more` : ''}</p>}
        {refusal && <p className="csv-import-bad">{refusal}</p>}
      </div>
      <div className="formula-actions">
        <span className="formula-actions-end">
          <button type="button" onClick={close}>Cancel</button>
          <button type="button" className="formula-done" disabled={busy || Boolean(refusal) || !plan.rows.length} onClick={() => void write()}>Import</button>
        </span>
      </div>
    </div>
  </>
}

/** The dialog, and the one warning that the workspace is filling up: it refuses nothing, and typing is never refused. */
export function CsvImportHost() {
  const current = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => open, () => null)
  const { workspace } = useWorkspace()
  const pages = workspace?.pages.length ?? 0
  useEffect(() => {
    if (!workspace || warned || workspaceBytes(workspace) < workspaceWarnBytes) return
    warned = true
    toast('This workspace is nearly full. Everything keeps working, but a large import may be refused.', { timeout: 10_000 })
  // Only when pages come or go: a save doesn't change how full it is by much.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])
  return current ? <ImportDialog key={current.name} open={current} /> : null
}
let warned = false
