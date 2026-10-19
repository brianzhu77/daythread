import { useEffect, useRef } from 'react'
import type { Page } from '../domain/types'
import { useWorkspace } from './use-day'

/** An empty title stays empty in the data and reads "Untitled" everywhere it's shown (Jazz f69dd341). */
export function displayPageTitle(page: Pick<Page, 'title'>): string {
  return page.title || 'Untitled'
}

export function focusAtEnd(el: HTMLElement) {
  el.focus()
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}

/**
 * The large title is the field (Jazz f69dd341): click to edit, "Untitled" placeholder, Enter goes to the first
 * body line, Esc puts back the title from before editing, saves on pause like the body.
 */
export function PageTitleField({ page, autoFocus }: { page: Page; autoFocus?: boolean }) {
  const { run } = useWorkspace()
  const el = useRef<HTMLHeadingElement>(null)
  const before = useRef(page.title)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saved = useRef(page.title)
  const save = () => {
    clearTimeout(timer.current)
    const title = (el.current?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (title === saved.current) return
    saved.current = title
    void run({ type: 'rename-page', pageId: page.id, title })
  }
  useEffect(() => {
    // Only follow outside changes while Brian isn't typing here.
    if (el.current && document.activeElement !== el.current && el.current.textContent !== page.title) { el.current.textContent = page.title; saved.current = page.title }
  }, [page.title])
  useEffect(() => { if (autoFocus && el.current) focusAtEnd(el.current) }, [autoFocus])
  useEffect(() => () => clearTimeout(timer.current), [])
  return <h1 ref={el} className="large-title page-title-field" contentEditable="plaintext-only" suppressContentEditableWarning
    role="textbox" aria-label="Page title" data-placeholder="Untitled" spellCheck
    onFocus={() => { before.current = el.current?.textContent ?? '' }}
    onInput={() => { clearTimeout(timer.current); timer.current = setTimeout(save, 600) }}
    onBlur={save}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault(); save()
        const first = document.querySelector<HTMLElement>('.bn-editor .bn-inline-content')
        const editable = document.querySelector<HTMLElement>('.bn-editor')
        if (first && editable) { editable.focus(); const r = document.createRange(); r.setStart(first, 0); r.collapse(true); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r) }
      } else if (e.key === 'Escape') {
        e.preventDefault(); if (el.current) el.current.textContent = before.current; save(); el.current?.blur()
      }
    }}>{page.title}</h1>
}
