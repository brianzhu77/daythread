// A row's Move to… (docs/design/move-row.md §2): the same dialog as a page's, listing databases. If nothing would be lost it moves with no
// question; otherwise it says exactly what's lost, first.
import { Modal, SearchField } from '@heroui/react'
import { useState } from 'react'
import { databaseOfRow, isDatabase, type Database } from '../domain/database'
import { planRowMove, type RowMove } from '../domain/move-row'
import type { Page } from '../domain/types'
import { flushAllEditors } from './editor-flush'
import { displayPageTitle } from './page-title'
import { recentIds, usePhone } from './page-tree'
import { useWorkspace } from './use-day'

type DatabasePage = Page & { database: Database }
const lostLines = (move: RowMove) => [
  ...(move.leftBehind.length ? [`${move.leftBehind.length} value${move.leftBehind.length === 1 ? '' : 's'} won't move: ${move.leftBehind.join(', ')}.`] : []),
  ...move.linksLost.map(l => `${l.rows} row${l.rows === 1 ? '' : 's'} in ${l.database} will lose ${l.rows === 1 ? 'its' : 'their'} link to it.`),
]

export function MoveRowDialog({ row, onClose }: { row: Page; onClose: () => void }) {
  const { workspace, run, latest } = useWorkspace()
  const phone = usePhone()
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState<{ to: DatabasePage; lines: string[] } | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  if (!workspace) return null
  const from = databaseOfRow(workspace, row)
  const all = workspace.pages.filter((p): p is DatabasePage => isDatabase(p) && !p.trashedAt && !p.database.fixed && p.id !== from?.id)
  const q = query.trim().toLowerCase()
  const recent = recentIds()
  const rank = (p: Page) => { const at = recent.indexOf(p.id); return at < 0 ? recent.length : at }
  const shown = (q ? all.filter(p => displayPageTitle(p).toLowerCase().includes(q)) : [...all].sort((a, b) => rank(a) - rank(b))).slice(0, 50)
  const send = async (to: DatabasePage) => {
    const receipt = await run({ type: 'move-row', pageId: row.id, databaseId: to.id, at: new Date().toISOString() }, r => ({ text: `Moved to ${displayPageTitle(to)}`, undoOperationId: r.operationId }), undefined, { inlineRefusal: /./, onRefused: m => setRefused(m) })
    if (receipt) onClose()
  }
  const pick = async (to: DatabasePage) => {
    setRefused(null)
    // Unsaved typing in the row is saved first, and it doesn't move if that fails.
    if (!(await flushAllEditors())) { setRefused("It hasn't saved yet, so it didn't move. Try again in a moment."); return }
    const ws = latest() ?? workspace, now = ws.pages.find(p => p.id === row.id), owner = now && databaseOfRow(ws, now), target = ws.pages.find(p => p.id === to.id)
    if (!now || !owner || !isDatabase(target)) { setRefused("That's gone."); return }
    const lines = lostLines(planRowMove(ws, now, owner, target))
    if (lines.length) { setAsking({ to, lines }); return }
    await send(to)
  }
  return (
    <Modal.Backdrop isOpen isDismissable onOpenChange={o => { if (!o) onClose() }}>
      <Modal.Container placement={phone ? 'bottom' : 'top'} scroll="inside" className={`move-dialog ${phone ? 'is-sheet' : ''}`}>
        <Modal.Dialog aria-label={`Move “${displayPageTitle(row)}”`}>
          {phone && <div className="sheet-handle" aria-hidden="true" />}
          <header className="move-head">
            <h2>Move “{displayPageTitle(row)}”</h2>
            <button type="button" className="app-link" onClick={onClose}>Cancel</button>
          </header>
          {asking
            ? <div className="move-list" role="alertdialog" aria-label={`Move to ${displayPageTitle(asking.to)}`}>
                <p className="move-group">To {displayPageTitle(asking.to)}</p>
                {asking.lines.map(line => <p key={line} className="move-note">{line}</p>)}
                <p className="move-note">Undo brings them back.</p>
                <button type="button" role="option" aria-selected="true" className="move-row active" onClick={() => void send(asking.to)}><span className="move-row-text"><span>Move</span></span></button>
                <button type="button" role="option" aria-selected="false" className="move-row" onClick={() => setAsking(null)}><span className="move-row-text"><span>Back</span></span></button>
                {refused && <p className="move-refused" role="status">{refused}</p>}
              </div>
            : <>
                <SearchField aria-label="Search databases" value={query} onChange={setQuery} autoFocus fullWidth>
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Search databases" />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <div className="move-list" role="listbox" aria-label="Databases">
                  {shown.map(p => <button key={p.id} type="button" role="option" aria-selected="false" className="move-row" onClick={() => void pick(p)}>
                    <span className="move-row-text"><span>{displayPageTitle(p)}</span></span>
                  </button>)}
                  {!shown.length && <p className="move-empty">{q ? `No database called “${query.trim()}”` : 'No other database to move it to'}</p>}
                  {refused && <p className="move-refused" role="status">{refused}</p>}
                </div>
              </>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
