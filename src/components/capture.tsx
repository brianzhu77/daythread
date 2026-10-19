import { useState } from 'react'
import type { Capture, Page, ProposalItem, Workspace } from '../domain/types'
import { longLabel } from './dates'
import { CloseIcon } from './icons'
import { useWorkspace } from './use-day'
import { ReceiptV2 } from './receipt-v2'

type BarState = 'idle' | 'sending' | 'failed'

/** "I'm speaking" (01 §4). The text is saved first; organizing follows. Bottom of the screen on iPhone. */
export function CaptureBar({ page, placeholder = 'Capture… e.g. “Fri: submit materials, start Wed”' }: { page: Page; placeholder?: string }) {
  const { submitCapture, simOutcome, model, workspace } = useWorkspace()
  const [text, setText] = useState('')
  // Jazz's status table: a muted line under the field for the two states he can act on himself.
  const lastModel = [...(workspace?.captures ?? [])].reverse().find(c => !c.simulated && c.status !== 'organizing')
  const modelLine = model.state === 'simulated' ? 'Simulated · no model key' : model.state === 'paused' ? "Model paused · a cost couldn't be confirmed · text saved" : lastModel?.status === 'failed' && /key rejected/.test(lastModel.error ?? '') ? 'Model key rejected · text saved' : null
  const [state, setState] = useState<BarState>('idle')

  const submit = async () => {
    const value = text.trim()
    if (!value || state === 'sending') return
    setState('sending')
    const saved = await submitCapture(page.id, value, simOutcome)
    if (saved) {
      setText('')
      setState('idle')
    } else {
      // Not saved: keep the text in the bar; no model call happens (01 §4.2 step 1).
      setState('failed')
    }
  }

  return (
    <form
      className="capture-bar"
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        value={text}
        rows={1}
        placeholder={placeholder}
        aria-label="Capture"
        enterKeyHint="send"
        onChange={e => {
          setText(e.target.value)
          if (state === 'failed') setState('idle')
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {modelLine && <span className="capture-model-line">{modelLine}</span>}
      <span className="capture-status" aria-live="polite">
        {state === 'sending' && 'Saving…'}
        {state === 'failed' && 'Not saved'}
      </span>
      <button type="submit" className="primary" disabled={!text.trim() || state === 'sending'}>
        {state === 'failed' ? 'Retry' : 'Save'}
      </button>
    </form>
  )
}

/**
 * Receipt cards (01 §4.3): waiting captures from any day, plus the last two handled ones from this page, newest first.
 * The receipt is the only place he sees what Auto saved or failed, so the newest (failed too) never sits below older
 * ones (Bumblebee, Lead 85852c23).
 */
export function CaptureReceipts({ page, workspace }: { page: Page; workspace: Workspace }) {
  const waiting = workspace.captures.filter(c => c.status === 'needs_confirmation' || c.status === 'organizing')
  const recent = workspace.captures.filter(c => c.pageId === page.id && c.status !== 'needs_confirmation' && c.status !== 'organizing').slice(-2)
  if (!waiting.length && !recent.length) return null
  // Captures are stored in the order they were made.
  const order = new Map(workspace.captures.map((c, i) => [c.id, i]))
  const shown = [...waiting, ...recent].sort((a, b) => order.get(b.id)! - order.get(a.id)!)
  return (
    <div id="captures" className="receipts">
      {shown.map(c => c.simulated
        ? <ReceiptCard key={c.id} capture={c} workspace={workspace} currentPageId={page.id} />
        : <ReceiptV2 key={c.id} capture={c} workspace={workspace} />)}
    </div>
  )
}

const kindLabel: Record<ProposalItem['kind'], string> = {
  'create-task': 'Task',
  'create-material': 'Material',
  'update-task': 'Change',
  'create-event': 'Event',
  'add-note': 'Note',
}

const failureCopy: Record<NonNullable<Capture['failure']>, string> = {
  failure: 'Couldn’t organize — your text is safe',
  budget: 'Today’s AI budget is used up ($10). Your text is saved. You can retry once the budget resets.',
  context: 'Too much linked material to send in one go. Nothing was sent. Your text is kept.',
  paused: "Model paused · a cost couldn't be confirmed · text saved",
}

function ReceiptCard({ capture, workspace, currentPageId }: { capture: Capture; workspace: Workspace; currentPageId: string }) {
  const { run, submitCapture, simOutcome, model } = useWorkspace()
  const [showOriginal, setShowOriginal] = useState(false)
  const proposals = capture.proposals ?? []
  const mixed = proposals.some(p => p.kind === 'update-task')
  const fromPage = workspace.pages.find(p => p.id === capture.pageId)
  // A fresh capture of the same words; a retry of the same capture (new revision) comes with the receipt UI (c).
  const organizeAgain = () => submitCapture(capture.pageId, capture.text, simOutcome)

  return (
    <section className={`app-card receipt status-${capture.status}`} aria-label="Capture result">
      <header className="card-head">
        <p className="receipt-source">
          {capture.status === 'applied' ? 'Saved from' : 'From'} “{capture.text.length > 60 ? `${capture.text.slice(0, 60)}…` : capture.text}”
        </p>
        {capture.simulated && <span className="sim">{model.state === 'simulated' ? 'Simulated · no model key' : 'Simulated'}</span>}
      </header>

      {capture.status === 'needs_confirmation' && (
        <>
          <p className="waiting">
            <strong>Waiting for you</strong> · {proposals.length} item{proposals.length === 1 ? '' : 's'}
            {mixed ? ' · includes new items, saved together' : ' · nothing saved yet except your text'}
            {fromPage?.date && capture.pageId !== currentPageId && <> · from {longLabel(fromPage.date)}</>}
          </p>
          <ul className="proposals">
            {proposals.map((item, i) => (
              <ProposalRow
                key={item.id}
                item={item}
                editable={i === 0 && item.kind === 'create-task'}
                removable={proposals.length > 1}
                onEdit={title => run({ type: 'edit-capture', captureId: capture.id, title, proposalRevision: capture.proposalRevision }, null)}
                onRemove={() =>
                  run({ type: 'edit-capture', captureId: capture.id, title: capture.proposedTitle, proposalRevision: capture.proposalRevision, removeItemId: item.id }, null)
                }
              />
            ))}
          </ul>
          <footer className="card-foot">
            <button
              type="button"
              className="primary"
              onClick={() =>
                run({ type: 'apply-capture', captureId: capture.id, proposalRevision: capture.proposalRevision }, r => ({ text: r.message }))
              }
            >
              Apply all
            </button>
            <button type="button" className="ghost" onClick={() => run({ type: 'discard-capture', captureId: capture.id }, null)}>
              Discard all
            </button>
          </footer>
        </>
      )}

      {capture.status === 'applied' && (
        <ul className="proposals">
          {proposals.map(item => (
            <li key={item.id} className="proposal-row">
              <span className="app-chip">✓ {kindLabel[item.kind]}</span>
              <span className="grow">{item.kind === 'update-task' ? `${item.title} → ${item.status ?? 'done'}` : item.title}</span>
              {item.kind === 'create-task' && <span className="app-tag">Unscheduled</span>}
              {item.kind === 'create-material' && <span className="app-tag quiet">no body provided</span>}
            </li>
          ))}
        </ul>
      )}

      {capture.status === 'failed' && (
        <div className="failed-line" role="alert">
          <p>{failureCopy[capture.failure ?? 'failure']}</p>
          <p className="actions">
            {capture.failure === 'context' ? (
              <button type="button" className="secondary" onClick={organizeAgain}>Try without links</button>
            ) : (
              <button type="button" className="secondary" onClick={organizeAgain} disabled={capture.failure === 'budget' && simOutcome === 'budget'}>
                Retry
              </button>
            )}
          </p>
        </div>
      )}

      {capture.status === 'discarded' && (
        <p>
          Discarded · your text is kept ·{' '}
          <button type="button" className="app-link" onClick={organizeAgain}>
            Organize again
          </button>
        </p>
      )}

      <p className="card-meta">
        {capture.contextLine && <span>{capture.contextLine} · </span>}
        <button type="button" className="app-link" onClick={() => setShowOriginal(s => !s)}>
          {showOriginal ? 'Hide original' : 'Show original'}
        </button>
      </p>
      {showOriginal && <blockquote className="original">{capture.text}</blockquote>}
    </section>
  )
}

function ProposalRow({ item, editable, removable, onEdit, onRemove }: { item: ProposalItem; editable: boolean; removable: boolean; onEdit: (t: string) => void; onRemove: () => void }) {
  const [title, setTitle] = useState(item.title)
  const sign = item.kind === 'update-task' ? '~' : '+'
  return (
    <li className="proposal-row">
      <span className="app-chip">
        {sign} {kindLabel[item.kind]}
      </span>
      {editable ? (
        <input className="grow" value={title} aria-label="Proposed task title" onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== item.title && onEdit(title.trim())} />
      ) : (
        <span className="grow">{item.kind === 'update-task' ? `${item.title} → ${item.status ?? 'done'}` : item.title}</span>
      )}
      {item.kind === 'create-material' && <span className="app-tag quiet">no body provided</span>}
      {removable && (
        <button type="button" className="icon" aria-label={`Remove ${item.title} from this group`} onClick={onRemove}>
          <CloseIcon />
        </button>
      )}
    </li>
  )
}
