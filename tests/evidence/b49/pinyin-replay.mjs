// B49: replays iOS pinyin as Mobile Safari did it in Ratchet's Simulator trace (9876f2c, main-native-trace-v2.json),
// in WebKit with an iPhone profile (ProseMirror takes its iOS paths). Picking the first candidate on an empty line:
// insertCompositionText 万, then deleteCompositionText, where WebKit removes the line's whole bn-block-outer and
// leaves a bare <br> in its group, then insertFromComposition 万 and compositionend. On main the line is replaced by a
// new paragraph holding 万 and a line break. Built server, sign-in off, a fresh store per run:
//   DB=/tmp/rb-b49/<store>.sqlite node tests/evidence/b49/pinyin-replay.mjs <base> <bullet|nested|todo|second>
import { webkit, devices } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, scenario = 'bullet'] = process.argv.slice(2), DB = process.env.DB
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000' || !DB?.startsWith('/tmp/')) throw Error('Use a disposable loopback server and a /tmp store')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const browser = await webkit.launch(), context = await browser.newContext({ ...devices['iPhone 13'] }), p = await context.newPage()
const errors = []; p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${scenario}: ${what}${detail ? ` (${detail})` : ''}`) }
const saved = () => { const d = new DatabaseSync(DB, { readOnly: true }); try { return JSON.parse(d.prepare("SELECT editorJSON FROM pages WHERE snapshot='current' AND date=?").get(today)?.editorJSON ?? '[]') } finally { d.close() } }
const deep = ns => ns.flatMap(n => [n, ...deep(n.children ?? [])])
const textOf = n => (Array.isArray(n.content) ? n.content.map(c => c.text ?? '').join('') : '')

/** One word through the iOS sequence, on the caret's line. `structural`: the line was empty (WebKit drops its block). */
const compose = (marks, word, structural) => p.evaluate(async ({ marks, word, structural }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const ed = document.querySelector('.bn-editor'), sel = getSelection()
  const line = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('.bn-inline-content')
  const fire = (type, data) => ed.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
  const input = (type, inputType, data) => ed.dispatchEvent(new InputEvent(type, { inputType, data, isComposing: true, bubbles: true }))
  const caret = (node, offset) => { const r = document.createRange(); r.setStart(node, offset); sel.removeAllRanges(); sel.addRange(r) }
  fire('compositionstart', '')
  let text
  for (const marked of [...marks, word]) {
    fire('compositionupdate', marked); input('beforeinput', 'insertCompositionText', marked)
    if (!text) { text = document.createTextNode(marked); if (structural) line.replaceChildren(text); else line.append(text) } else text.data = marked
    caret(text, marked.length); input('input', 'insertCompositionText', marked); await wait(structural ? 60 : 40)
  }
  input('beforeinput', 'deleteCompositionText', null)
  if (structural) { const outer = line.closest('.bn-block-outer'), br = document.createElement('br'); outer.replaceWith(br); caret(br.parentElement, [...br.parentElement.childNodes].indexOf(br)) }
  else { const at = text.previousSibling; text.remove(); at ? caret(at, at.length ?? 0) : caret(line, 0) }
  input('input', 'deleteCompositionText', null)
  await wait(5)
  const a = sel.anchorNode, live = (a?.nodeType === 1 ? a : a?.parentElement)?.closest('.bn-inline-content') ?? line
  input('beforeinput', 'insertFromComposition', word)
  const again = document.createTextNode(word)
  if (structural) live.prepend(again); else live.append(again)
  caret(again, word.length); input('input', 'insertFromComposition', word)
  fire('compositionend', word)
  await wait(300)
}, { marks, word, structural })
const caretLine = () => p.evaluate(() => { const a = getSelection().anchorNode, b = (a?.nodeType === 1 ? a : a?.parentElement)?.closest('[data-node-type="blockContainer"]'); return { id: b?.dataset.id, type: b?.querySelector('[data-content-type]')?.dataset.contentType, text: b?.querySelector('.bn-inline-content')?.textContent, focused: Boolean(document.activeElement?.closest('.bn-editor')) } })

await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const notes = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first()
await notes.tap()
await notes.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r) })
await p.keyboard.type('明天'); await p.keyboard.press('Enter'); await p.waitForTimeout(400)
if (scenario === 'nested') { await p.keyboard.press('Tab'); await p.waitForTimeout(300) }
if (scenario === 'todo') { await p.keyboard.type('[] '); await p.waitForTimeout(600) }
const before = await caretLine()
await compose(['w', 'wa', 'wan'], '万', true)
await p.waitForTimeout(300)
const after = await caretLine()
log(after.id === before.id && after.type === before.type && after.text === '万', 'the word stays on his new line, its id and kind kept', JSON.stringify({ before, after }))
const lines = await p.evaluate(() => [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].map(b => ({ type: b.querySelector('[data-content-type]')?.dataset.contentType, text: b.querySelector('.bn-inline-content')?.textContent })))
log(!lines.some(l => l.type === 'paragraph' && l.text === '万') && lines.filter(l => l.text === '万').length === 1, 'no second line with the word, no paragraph in its place')
log(after.focused, 'the caret is still in the editor')
if (scenario === 'todo') log(await p.getByText('Removed from tasks').count() === 0, 'no "Removed from tasks" notice: the to-do stays a to-do')
if (scenario === 'second') {
  await compose(['h', 'he'], '和', false)
  const next = await caretLine()
  log(next.id === before.id && next.text === '万和', 'a second word goes on the same line', JSON.stringify(next))
}
await p.keyboard.type('x'); await p.waitForTimeout(200)
const typed = await caretLine()
log(typed.id === before.id && typed.text.endsWith('x'), 'typing carries on in that line', JSON.stringify(typed))
await p.waitForTimeout(1500)
const row = deep(saved()).find(n => n.id === before.id)
log(row && row.type === before.type && textOf(row).startsWith('万') && !textOf(row).includes('\n'), 'saved: his line with the word, no line break', JSON.stringify(row && { type: row.type, text: textOf(row) }))
log(!deep(saved()).some(n => n.id !== before.id && textOf(n).includes('万')), 'saved: the word nowhere else')
if (scenario === 'nested') log(deep(saved()).some(n => n.id === 'day:' + today + ':notes:template:0' && n.children?.some(c => c.id === before.id)), 'saved: still nested under 明天')
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
