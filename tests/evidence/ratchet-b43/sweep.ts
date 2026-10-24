// Lead's malformed-response sweep for B43 (ac69ff6): every case must end as a value (never a throw or a crash),
// within the 4 s budget plus slack, and leave no socket open. Raw TCP so the responses can be truly broken.
import net from 'node:net'
import zlib from 'node:zlib'
import { fetchLinkPreview } from '../../../src/server/link-preview.ts'
process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK = '1'
const html = (body: string, extra = '') => `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n${extra}Connection: close\r\n\r\n${body}`
const cases: Record<string, (s: net.Socket, port: number) => void> = {
  'not http at all': s => s.end('NOTHTTP garbage\r\n\r\n'),
  'empty reply': s => s.end(),
  'reset mid-headers': s => { s.write('HTTP/1.1 200 OK\r\nContent-Ty'); s.destroy() },
  'reset mid-body': s => { s.write(html('<html><head><title>Half')); setTimeout(() => s.resetAndDestroy?.() ?? s.destroy(), 50) },
  'content-length lies': s => s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 99999\r\n\r\n<title>Short</title>'),
  'broken chunked': s => s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\nZZZ\r\n<title>x</title>\r\n'),
  'headers never end': s => { s.write('HTTP/1.1 200 OK\r\n'); const t = setInterval(() => s.write('X-A: b\r\n'), 200); s.on('close', () => clearInterval(t)) },
  'body trickles forever': s => { s.write(html('<html><head>')); const t = setInterval(() => s.write(' '), 100); s.on('close', () => clearInterval(t)); s.on('error', () => clearInterval(t)) },
  'huge header': s => s.end(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Big: ${'a'.repeat(200_000)}\r\n\r\n<title>t</title>`),
  'gzip garbage': s => s.end(html('this is not gzip', 'Content-Encoding: gzip\r\n')),
  'real gzip': s => { const b = zlib.gzipSync('<title>Zipped</title>'); s.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\nContent-Length: ${b.length}\r\nConnection: close\r\n\r\n`); s.end(b) },
  'bogus charset': s => s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=klingon\r\nConnection: close\r\n\r\n<title>Hi</title>'),
  'utf-16 charset': s => { const b = Buffer.from('﻿<title>Sixteen</title>', 'utf16le'); s.write('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-16\r\nConnection: close\r\n\r\n'); s.end(b) },
  'title of controls and bidi': s => s.end(html('<title>‮evil\u0000\u0007 ​ title</title>')),
  'giant title': s => s.end(html(`<title>${'长'.repeat(50_000)}</title>`)),
  'nested og tags and entities': s => s.end(html('<meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp;"><title>t</title>')),
  'redirect to itself': (s, port) => s.end(`HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${port}/\r\nConnection: close\r\n\r\n`),
  'redirect empty': s => s.end('HTTP/1.1 302 Found\r\nLocation: \r\nConnection: close\r\n\r\n'),
  'redirect javascript:': s => s.end('HTTP/1.1 302 Found\r\nLocation: javascript:alert(1)\r\nConnection: close\r\n\r\n'),
  'redirect file:': s => s.end('HTTP/1.1 302 Found\r\nLocation: file:///etc/passwd\r\nConnection: close\r\n\r\n'),
  'redirect to metadata': s => s.end('HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/\r\nConnection: close\r\n\r\n'),
  'redirect to ::ffff:127.0.0.1 hex': s => s.end('HTTP/1.1 302 Found\r\nLocation: http://[::ffff:7f00:1]/\r\nConnection: close\r\n\r\n'),
  'redirect to decimal ip': s => s.end('HTTP/1.1 302 Found\r\nLocation: http://2130706433/\r\nConnection: close\r\n\r\n'),
  'redirect bad port': s => s.end('HTTP/1.1 302 Found\r\nLocation: http://example.com:99999/\r\nConnection: close\r\n\r\n'),
  'invalid header bytes': s => s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Bad: a\u0000b\r\n\r\n<title>t</title>'),
  'HTTP/0.9 style': s => s.end('<title>no status line</title>'),
}
const handles = () => (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles().length
let failed = 0
process.on('uncaughtException', e => { failed++; console.log('UNCAUGHT', String(e).slice(0, 120)) })
process.on('unhandledRejection', e => { failed++; console.log('UNHANDLED', String(e).slice(0, 120)) })
for (const [name, respond] of Object.entries(cases)) {
  const sockets = new Set<net.Socket>()
  const server = net.createServer(s => { sockets.add(s); s.on('error', () => {}); s.once('data', () => respond(s, (server.address() as net.AddressInfo).port)) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as net.AddressInfo).port
  const before = handles(), t0 = Date.now()
  let out: string
  try { out = JSON.stringify(await fetchLinkPreview(`http://127.0.0.1:${port}/`)).slice(0, 110) } catch (e) { failed++; out = 'THREW ' + String(e).slice(0, 100) }
  const ms = Date.now() - t0
  await new Promise(r => setTimeout(r, 300))
  const open = [...sockets].filter(s => !s.destroyed).length
  const slow = ms > 4800
  if (slow || open) failed++
  console.log(`${slow || open || out.startsWith('THREW') ? 'FAIL' : 'ok  '} ${name.padEnd(32)} ${String(ms).padStart(5)}ms open=${open} ${out}`)
  for (const s of sockets) s.destroy()
  await new Promise(r => server.close(r))
  void before
}
console.log(failed ? `${failed} failed` : 'all passed')
