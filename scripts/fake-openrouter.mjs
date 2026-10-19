// A local stand-in for OpenRouter, for browser checks of the model path with no network and no cost.
//   node scripts/fake-openrouter.mjs <port>      then start the app with
//   OPENROUTER_BASE_URL=http://127.0.0.1:<port>/api/v1 OPENROUTER_API_KEY=fake OPENROUTER_MODEL=fake/model
//
// What a capture text gets back (Jazz's receipt check list, capture-receipt-v2-check.md):
//   FIXTURE_TEXT (printed at start)  the seven receipt rows: grounded task with a do date · event with a time ·
//                                    titled saved link · invented time · lost date · dated update with no role
//                                    (capture "Tax Return" first so that open task exists) · one item the server rejects
//   "http401: …"                     key rejected (401)
//   "budget: …"                      one task, reported cost $10, so the next capture finds the budget used up
//   "slow: …"                        answers after 20 s, to see "Organizing…"
//   "timeout: …"                     never answers
//   anything else                    one task titled with the text
// "No key" is the app started without OPENROUTER_API_KEY.
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 3099)
const flat = i => ({ kind: 'task', title: null, text: null, detail: null, date: null, dateRole: null, time: null, partOfDay: null, url: null, note: null, followUpDate: null, taskId: null, markDone: null, newDate: null, ...i })
const day = offset => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10) }
export const FIXTURE_TEXT = 'Book flights tomorrow, Lunch with Kevin next Mon 12:30, https://example.com/essay Calm tech essay, Swim class tomorrow afternoon, Renew passport tomorrow, move Tax Return to tomorrow, Pay rent'
const fixture = (openTaskId) => [
  { kind: 'task', title: 'Book flights', date: day(1), dateRole: 'do' },                 // 1 grounded, do date
  { kind: 'event', title: 'Lunch with Kevin', date: day(7), time: '12:30' },             // 2 event with a time
  { kind: 'material', url: 'https://example.com/essay', note: 'Calm tech essay' },       // 3 titled saved link
  { kind: 'event', title: 'Swim class', date: day(1), time: '14:00' },                   // 4 invented time
  { kind: 'task', title: 'Renew passport', date: null },                                 // 5 date lost
  ...(openTaskId ? [{ kind: 'update', taskId: openTaskId, markDone: false, newDate: day(1), dateRole: null }] : []), // 6
  { kind: 'task', title: 'Pay rent', date: '2026-02-31', dateRole: 'due' },              // 7 rejected (no such date)
]
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'fake/model', pricing: { prompt: '0.0000003', completion: '0.0000012' } }] })
  if (!req.url.endsWith('/chat/completions')) return send(404, {})
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  const text = body.messages?.at(-1)?.content ?? '', system = body.messages?.[0]?.content ?? ''
  if (text.startsWith('timeout:')) return
  if (text.startsWith('http401:')) return send(401, { error: { message: 'bad key' } })
  if (text.startsWith('slow:')) await new Promise(r => setTimeout(r, 20_000))
  const taxReturn = system.match(/id=(\S+) · "Tax Return"/)?.[1]
  const items = text === FIXTURE_TEXT ? fixture(taxReturn) : [{ kind: 'task', title: text.replace(/^(slow|budget):\s*/, '') }]
  await new Promise(r => setTimeout(r, 400))
  send(200, { id: `gen-${Date.now()}`, choices: [{ message: { content: JSON.stringify({ items: items.map(flat) }) }, finish_reason: 'stop' }], usage: { cost: text.startsWith('budget:') ? 10 : 0.0002, prompt_tokens: 600, completion_tokens: 200 } })
}).listen(port, '127.0.0.1', () => console.log(`fake OpenRouter on http://127.0.0.1:${port}/api/v1\nFIXTURE_TEXT: ${FIXTURE_TEXT}`))
