import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// B43 (Lead, Ratchet): the fetcher reaches only the public internet and returns plain text or nothing. Local servers
// stand in for sites; loopback is allowed only through the test flag (refused on Vercel).
process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK = '1'
const { checkedLookup, decodeHtml, fetchLinkPreview, isPublicAddress, previewLimits, readPreview } = await import('../src/server/link-preview.ts')

let server: http.Server, base = ''
const routes: Record<string, (res: http.ServerResponse) => void> = {}
before(async () => {
  server = http.createServer((req, res) => (routes[req.url ?? ''] ?? ((r: http.ServerResponse) => { r.statusCode = 404; r.end() }))(res))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())
const html = (body: string, type = 'text/html; charset=utf-8') => (res: http.ServerResponse) => { res.setHeader('content-type', type); res.end(body) }

test('public addresses only: private, loopback, link-local, CGNAT, multicast and their IPv6 forms are refused', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip)
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2001:db8::1', 'not-an-ip'])
    assert.equal(isPublicAddress(ip), false, ip)
})

test('refused before any connection: other schemes, credentials, odd hosts, private literals', async () => {
  delete process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK
  try {
    for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://example.com:8080/', 'http://localhost/', 'http://intranet/', 'http://printer.local/',
      'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/', 'javascript:alert(1)', 'not a url'])
      assert.deepEqual(await fetchLinkPreview(url), { title: null, description: null }, url)
  } finally { process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK = '1' }
})

test('the connection itself refuses a name that resolves to a private address (no gap for DNS to change)', async () => {
  delete process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK
  try {
    const error = await new Promise<Error | null>(resolve => checkedLookup('localhost', { all: true }, e => resolve(e)))
    assert.match(String(error?.message), /public/)
  } finally { process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK = '1' }
})

test('the test flag is ignored on Vercel', async () => {
  process.env.VERCEL = '1'
  routes['/v'] = html('<title>Should not load</title>')
  try { assert.deepEqual(await fetchLinkPreview(`${base}/v`), { title: null, description: null }) } finally { delete process.env.VERCEL }
})

test('og:title before <title>; <title> kept whole; og:description; entities decoded, tags stripped, plain text', async () => {
  routes['/og'] = html(`<html><head><title>Foo – Medium</title><meta content="How to be &amp; stay &quot;ambitious&quot;" property="og:title"><meta property='og:description' content='A <b>tutorial</b> for humans&#x2014;with models'></head></html>`)
  assert.deepEqual(await fetchLinkPreview(`${base}/og`), { title: 'How to be & stay "ambitious"', description: 'A tutorial for humans—with models' })
  routes['/t'] = html('<title>\n  skills/pull/1316 · mattpocock/skills · GitHub </title>')
  assert.deepEqual(await fetchLinkPreview(`${base}/t`), { title: 'skills/pull/1316 · mattpocock/skills · GitHub', description: null })
})

test('charsets: GBK and GB18030 decode; an unknown charset or bad bytes give nothing (Lead)', async () => {
  const gbk = Buffer.from([0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, 0xd6, 0xd0, 0xce, 0xc4, 0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e]) // <title>中文</title>
  routes['/gbk'] = res => { res.setHeader('content-type', 'text/html; charset=GBK'); res.end(gbk) }
  assert.equal((await fetchLinkPreview(`${base}/gbk`)).title, '中文')
  routes['/meta-gb'] = res => { res.setHeader('content-type', 'text/html'); res.end(Buffer.concat([Buffer.from('<meta charset="gb18030">'), gbk])) }
  assert.equal((await fetchLinkPreview(`${base}/meta-gb`)).title, '中文')
  routes['/unknown'] = res => { res.setHeader('content-type', 'text/html; charset=x-made-up'); res.end('<title>x</title>') }
  assert.equal((await fetchLinkPreview(`${base}/unknown`)).title, null)
  routes['/bad'] = res => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(gbk) }
  assert.equal((await fetchLinkPreview(`${base}/bad`)).title, null, 'GBK bytes declared as UTF-8: no garbled title')
  assert.equal(decodeHtml(Buffer.from('<title>ok</title>'), 'text/html'), '<title>ok</title>')
})

test('redirects: followed up to 3 and checked each time; a 4th, or one to a private address, gives nothing', async () => {
  const hop = (to: string) => (res: http.ServerResponse) => { res.statusCode = 302; res.setHeader('location', to); res.end() }
  routes['/end'] = html('<title>Arrived</title>')
  routes['/r1'] = hop('/end'); routes['/r2'] = hop('/r1'); routes['/r3'] = hop('/r2'); routes['/r4'] = hop('/r3')
  assert.equal((await fetchLinkPreview(`${base}/r3`)).title, 'Arrived')
  assert.equal((await fetchLinkPreview(`${base}/r4`)).title, null, 'four redirects')
  routes['/to-meta'] = hop('http://169.254.169.254/latest/meta-data/')
  assert.equal((await fetchLinkPreview(`${base}/to-meta`)).title, null)
  routes['/to-file'] = hop('file:///etc/passwd')
  assert.equal((await fetchLinkPreview(`${base}/to-file`)).title, null)
})

test('only HTML, only a success; a slow site times out; a huge page is read only to the cap', async () => {
  routes['/json'] = html('{"title":"x"}', 'application/json')
  routes['/500'] = res => { res.statusCode = 500; res.setHeader('content-type', 'text/html'); res.end('<title>err</title>') }
  assert.equal((await fetchLinkPreview(`${base}/json`)).title, null)
  assert.equal((await fetchLinkPreview(`${base}/500`)).title, null)
  const timeout = previewLimits.timeoutMs; previewLimits.timeoutMs = 300
  routes['/slow'] = () => { /* never answers */ }
  const started = Date.now()
  try { assert.equal((await fetchLinkPreview(`${base}/slow`)).title, null) } finally { previewLimits.timeoutMs = timeout }
  assert.ok(Date.now() - started < 2000, 'gave up at the timeout')
  routes['/huge'] = res => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.write('<head><title>Big</title></head>'); const chunk = 'x'.repeat(64 * 1024); for (let i = 0; i < 64; i++) res.write(chunk); res.end() }
  assert.equal((await fetchLinkPreview(`${base}/huge`)).title, 'Big')
})

test('long text is cut to its limit; control and invisible characters go', () => {
  const long = 'é'.repeat(400)
  const out = readPreview(`<meta property="og:title" content="${long}"><meta property="og:description" content="a‮bc\u0000d">`)
  assert.equal([...out.title!].length, previewLimits.title)
  assert.ok(out.title!.endsWith('…'))
  assert.equal(out.description, 'a bc d')
})

test('a description that is only the site\'s name is dropped (Bumblebee)', () => {
  assert.deepEqual(readPreview('<meta property="og:title" content="A post"><meta property="og:site_name" content="GitHub"><meta property="og:description" content="github">'), { title: 'A post', description: null })
})
