import { Fragment } from 'react'
import { findTags } from '../domain/tags'

/** Text with its tags tinted the same way the editor tints them. Read-only: tags are not links. */
export function TagText({ text }: { text: string }) {
  const parts = []
  let at = 0
  for (const m of findTags(text)) {
    parts.push(<Fragment key={m.start}>{text.slice(at, m.start)}<span className="tag-mark">{text[m.start]}</span><span className="tag-ink">{m.tag}</span></Fragment>)
    at = m.end
  }
  return <>{parts}{text.slice(at)}</>
}
