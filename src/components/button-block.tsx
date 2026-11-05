// A button on a page (docs/design/buttons.md §3): a tap always runs it, and ⋯ edits it. It takes no caret, so a tap raises no keyboard and leaves the caret where it was.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isRunning, subscribeRunning, useRunButton } from './button-run'
import { openButtonEditor } from './button-editor'
import { RowMenu } from './row-menu'

/** The page whose editor this block is in, set around the editor. */
export const ButtonPage = createContext<{ pageId: string; onTemplate: boolean } | null>(null)
type BlockEditor = { updateBlock(id: string, update: never): unknown; insertBlocks(blocks: never, id: string, place: 'after'): unknown; removeBlocks(ids: string[]): unknown }

export function ButtonLine({ blockId, label, steps, editor }: { blockId: string; label: string; steps: string; editor: BlockEditor }) {
  const page = useContext(ButtonPage)
  const line = useRef<HTMLDivElement>(null), pill = useRef<HTMLButtonElement>(null)
  const edit = () => { if (page) openButtonEditor({ pageId: page.pageId, initial: { label, steps }, anchor: line.current, onDone: draft => { editor.updateBlock(blockId, { props: draft } as never) } }) }
  const run = useRunButton(edit)
  const waiting = useSyncExternalStore(subscribeRunning, () => isRunning(blockId), () => false)
  // Dimmed at once, with a spinner after a moment, and the width held so nothing moves (Jazz).
  const [spinning, setSpinning] = useState(false), [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!waiting) { setSpinning(false); setWidth(null); return }
    setWidth(pill.current?.offsetWidth ?? null)
    const timer = setTimeout(() => setSpinning(true), 300)
    return () => clearTimeout(timer)
  }, [waiting])
  const name = label || 'Button'
  return <div ref={line} className="editor-button-line" contentEditable={false} onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <button ref={pill} type="button" tabIndex={-1} className={`editor-button-pill${waiting ? ' is-waiting' : ''}`} aria-busy={waiting || undefined} {...(width ? { style: { width } } : {})}
      onMouseDown={e => e.preventDefault()}
      onClick={() => { if (!page) return; if (page.onTemplate) edit(); else void run({ id: page.pageId }, blockId, steps) }}>
      {spinning ? <span className="button-spinner" role="status" aria-label={`${name} running`} /> : <span>{name}</span>}
    </button>
    <RowMenu label={`${name} actions`} triggerClass="editor-button-more" groups={[
      { items: [{ label: 'Edit', onSelect: edit }, { label: 'Duplicate', onSelect: () => { editor.insertBlocks([{ type: 'button', props: { label, steps } }] as never, blockId, 'after') } }] },
      { items: [{ label: 'Delete', danger: true, onSelect: () => { editor.removeBlocks([blockId]) } }] },
    ]} />
  </div>
}
