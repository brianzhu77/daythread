// Bumblebee's grounding check: an item the model proposes may only be applied without asking when it can be traced
// back to Brian's own text. Independent of the model and free per call. A failing item goes to "needs a look".
import type { CaptureItem } from './capture-prompt.ts'

/** Latin words of 2+ letters (lower-cased) and single CJK characters; enough to tell "his words" from invented ones. */
function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]+/g) ?? []) out.add(w)
  for (const c of text.match(/[㐀-鿿]/g) ?? []) out.add(c)
  return out
}
function shares(candidate: string, input: Set<string>, minShare = 0.5): boolean {
  const own = [...tokens(candidate)]
  return own.length > 0 && own.filter(t => input.has(t)).length / own.length >= minShare
}

export interface GroundingResult { grounded: boolean; reasons: string[] }

export function groundItem(item: CaptureItem, inputText: string, openTasks: { id: string; title: string }[]): GroundingResult {
  const input = tokens(inputText), reasons: string[] = []
  const timeIn = (t: string) => inputText.includes(t) || inputText.includes(t.replace(/^0/, ''))
  switch (item.kind) {
    case 'task':
      if (!shares(item.title, input)) reasons.push('title not from your text')
      break
    case 'event':
      if (!shares(item.title, input)) reasons.push('title not from your text')
      if (item.time && !timeIn(item.time)) reasons.push('time not in your text')
      break
    case 'note':
      if (!shares(item.text, input, 0.6)) reasons.push('note not from your text')
      break
    case 'material':
      if (!/^https?:\/\/\S+$/.test(item.url) || !inputText.includes(item.url)) reasons.push('link not in your text')
      break
    case 'update': {
      const target = openTasks.find(t => t.id === item.taskId)
      // The task must be one he named: enough of its title's words appear in what he typed.
      if (!target || !shares(target.title, input, 0.34)) reasons.push('not clearly the task you named')
      break
    }
  }
  return { grounded: reasons.length === 0, reasons }
}
