// The mark on a commented line (docs/design/comments.md §2): in the margin at 1280, at the line's end at 390. Drawn over the page, not in it, so it can't shift a line or
// touch the document, and with no thread on a line none of this runs.
import { useLayoutEffect, useMemo, useState } from 'react'
import { threadsOn } from '../domain/comments'
import { openComments } from './comments-pane'
import { CommentIcon } from './icons'
import { useWorkspace } from './use-day'

type Mark = { blockId: string; threadId: string; count: number; top: number; left: number }
const markSize = 16
export function CommentMarks({ pageId, host, onChange }: { pageId: string; host: () => HTMLElement | null; onChange: (run: () => void) => () => void }) {
  const { workspace } = useWorkspace()
  const open = useMemo(() => threadsOn(workspace?.threads, pageId).filter(t => t.anchor && !t.resolvedAt), [workspace?.threads, pageId])
  const [marks, setMarks] = useState<Mark[]>([])
  const key = open.map(t => `${t.id}:${t.anchor!.blockId}`).join()
  useLayoutEffect(() => {
    if (!open.length) { setMarks([]); return }
    const measure = () => {
      const root = host()
      if (!root) return
      const box = root.getBoundingClientRect(), wide = window.matchMedia('(min-width: 900px)').matches, next: Mark[] = []
      for (const t of open) {
        const blockId = t.anchor!.blockId, have = next.find(m => m.blockId === blockId)
        if (have) { have.count++; continue }
        const line = root.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(blockId)}"]`), content = line?.querySelector<HTMLElement>('.bn-block-content')
        const lineBox = content?.getBoundingClientRect()
        // Gone from the page, or in a section whose empty rows are hidden: nothing to mark.
        if (!content || !lineBox || !lineBox.height) continue
        const inline = content.querySelector('.bn-inline-content'), range = document.createRange()
        if (inline) range.selectNodeContents(inline)
        const rects = inline ? [...range.getClientRects()].filter(r => r.width > 0) : []
        const first = rects[0], last = rects.at(-1)
        const rightEdge = box.width - markSize - 4
        // Outside the column at 1280, where it can't cover words or a row's own ⋯. At 390 there's no margin: after the last word, or for a line with none, a card say, left of its chevron.
        const left = wide ? box.width + 2 : last ? Math.min(rightEdge, last.right - box.left + 4) : rightEdge - 24
        const anchorBox = wide ? first : last
        const top = (anchorBox ? anchorBox.top + anchorBox.height / 2 : lineBox.top + markSize / 2) - box.top - markSize / 2
        next.push({ blockId, threadId: t.id, count: 1, top, left })
      }
      setMarks(next)
    }
    const later = () => requestAnimationFrame(measure), stop = onChange(later), seen = new ResizeObserver(later)
    // The editor may not be on the page yet, and its lines draw after it is. Each changes its height, which this hears.
    let waiting = 0
    const start = () => { const root = host(); if (root) { seen.observe(root); measure() } else waiting = requestAnimationFrame(start) }
    start()
    window.addEventListener('resize', later)
    return () => { cancelAnimationFrame(waiting); stop(); seen.disconnect(); window.removeEventListener('resize', later) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>{marks.map(m => <button key={m.blockId} type="button" className="comment-mark" style={{ top: m.top, left: m.left }} aria-label={m.count === 1 ? 'Comment on this line' : `${m.count} comments on this line`} onPointerDown={e => e.preventDefault()} onClick={() => openComments(pageId, { threadId: m.threadId })}><CommentIcon /></button>)}</>
}
