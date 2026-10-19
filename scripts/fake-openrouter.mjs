// A local stand-in for OpenRouter, for browser checks of the model path with no network and no cost.
//   node scripts/fake-openrouter.mjs <port>      then start the app with
//   OPENROUTER_BASE_URL=http://127.0.0.1:<port>/api/v1 OPENROUTER_API_KEY=fake OPENROUTER_MODEL=fake/model
// Answers: a capture text starting with "fixture:" returns the receipt fixture (Jazz's check list); "timeout:" never
// answers; "http401:" returns 401; anything else comes back as one task with the text as its title.
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 3099)
const flat = i => ({ kind: 'task', title: null, text: null, detail: null, date: null, dateRole: null, time: null, partOfDay: null, url: null, note: null, followUpDate: null, taskId: null, markDone: null, newDate: null, ...i })
const fixture = [
  { kind: 'task', title: 'Book flights', date: '2026-10-20', dateRole: 'do' },
  { kind: 'event', title: 'Lunch with Kevin', date: '2026-10-26', time: '12:30' },
  { kind: 'material', url: 'https://example.com/essay', note: 'Calm tech essay' },
  { kind: 'event', title: 'Swim class', date: '2026-10-20', time: '14:00' },
  { kind: 'task', title: 'Renew passport', date: null },
  { kind: 'task', title: '示例' },
  { kind: 'task', title: 'Pay rent', date: '2026-10-31', dateRole: 'due' },
]
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'fake/model', pricing: { prompt: '0.0000003', completion: '0.0000012' } }] })
  if (!req.url.endsWith('/chat/completions')) return send(404, {})
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  const text = body.messages?.at(-1)?.content ?? ''
  if (text.startsWith('timeout:')) return // never answer
  if (text.startsWith('http401:')) return send(401, { error: { message: 'bad key' } })
  const items = text.startsWith('fixture:') ? fixture : [{ kind: 'task', title: text }]
  await new Promise(r => setTimeout(r, 400))
  send(200, { id: `gen-${Date.now()}`, choices: [{ message: { content: JSON.stringify({ items: items.map(flat) }) }, finish_reason: 'stop' }], usage: { cost: 0.0002, prompt_tokens: 600, completion_tokens: 200 } })
}).listen(port, '127.0.0.1', () => console.log(`fake OpenRouter on http://127.0.0.1:${port}/api/v1`))
