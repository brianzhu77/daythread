// Adds a fixed delay before each request reaches the app and keeps going if the browser cancels: a request already on the wire still lands.
import http from 'node:http'
const [listen, target, ms] = process.argv.slice(2).map(Number)
http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => setTimeout(() => {
    const up = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', () => { try { res.destroy() } catch {} })
    up.end(Buffer.concat(chunks))
  }, ms))
  res.on('error', () => {})
}).listen(listen, '127.0.0.1')
