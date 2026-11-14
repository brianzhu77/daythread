// A stand-in for Photon's /api on 127.0.0.1, for place.mjs: canned answers by query, and every request it gets written
// to a log (one JSON line: path, query fields, headers), so a check can see exactly what the Worker sent.
// Usage: node tests/evidence/place/mock-photon.mjs <port> <log-file>
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
const [port, log] = process.argv.slice(2)
writeFileSync(log, '')
const f = (name, lon, lat, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, ...extra } })
const answers = {
  'stanley park': [f('Stanley Park', -123.1443, 49.3017, { osm_type: 'R', osm_id: 2048, city: 'Vancouver', state: 'British Columbia', country: 'Canada' }), f('Stanley Park', -3.0336, 53.8113, { city: 'Blackpool', country: 'United Kingdom' })],
  '西湖': [f('西湖', 120.1445, 30.2427, { osm_type: 'W', osm_id: 77, city: '杭州市', state: '浙江省', country: '中国' })],
  '外滩': [f('外滩', 121.4903, 31.2397, { city: '上海市', country: '中国' })],
  '京': [f('北京市', 116.4, 39.9, { country: '中国' })],
  'ab': [f('Abbotsford', -122.3, 49.05, { state: 'British Columbia', country: 'Canada' })],
}
createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const q = url.searchParams.get('q') ?? ''
  appendFileSync(log, JSON.stringify({ path: url.pathname, params: [...url.searchParams.keys()], q, headers: Object.keys(req.headers).sort(), ua: req.headers['user-agent'] }) + '\n')
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body) }
  if (q.startsWith('fail')) return send(500, '{}')
  if (q.startsWith('slow')) return setTimeout(() => send(200, JSON.stringify({ features: [f(`Late ${q}`, 1, 1, { city: 'Lateville' })] })), 2500)
  const key = q.toLowerCase()
  send(200, JSON.stringify({ type: 'FeatureCollection', features: answers[key] ?? (key.startsWith('zzz') ? [] : [f(`${q} Cafe`, -123.1, 49.2, { city: 'Vancouver', country: 'Canada' })]) }))
}).listen(Number(port), '127.0.0.1', () => console.log(`mock photon on ${port}`))
