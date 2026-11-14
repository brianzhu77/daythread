// A stand-in for the model's chat API on 127.0.0.1, for smart note browser checks: every answer cites the first lines it
// was given, so a note always has sources. Point the server at it with OPENROUTER_BASE_URL (loopback only, openrouter.ts).
// Usage: node tests/evidence/smart-note/stub-model.mjs <port>   (Jazz's stub from her native sweep, 01ec668c)
import http from 'node:http'
const [port] = process.argv.slice(2)
let n = 0
http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const ids = [...new Set(body.match(/\bL\d+\b/g) ?? [])], k = ++n
    const s = i => (ids.length ? [ids[i % ids.length]] : [])
    const blocks = [
      { kind: 'heading', text: 'Decisions', sources: [] },
      { kind: 'bullet', text: `Guest checkout stays out of the first release (answer ${k})`, sources: [...s(0), ...s(1)] },
      { kind: 'bullet', text: '地址表单改成一步完成', sources: s(1) },
      { kind: 'paragraph', text: 'Nothing new on shipping since last week.', sources: s(0) },
    ]
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `stub-${k}`, choices: [{ message: { content: JSON.stringify({ blocks }) } }], usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 } })), 300)
  })
}).listen(Number(port), '127.0.0.1', () => console.log(`stub model on ${port}`))
