import * as pw from '@playwright/test'
import { readFileSync } from 'node:fs'
const dir = process.argv[2]
if (!dir) { console.error('Usage: node diff.mjs <out-dir>'); process.exit(2) }
 const r = JSON.parse(readFileSync(dir + '/results.json'))
const { results, ...head } = r; console.log(JSON.stringify(head))
const b = await pw.chromium.launch({ headless: true }); const p = await b.newPage()
let bad = 0
for (const x of results) {
  const u = f => 'data:image/png;base64,' + readFileSync(f).toString('base64')
  const d = await p.evaluate(async ([a, c]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s })
    const [A, C] = await Promise.all([load(a), load(c)])
    if (A.width !== C.width || A.height !== C.height) return { size: [A.width, A.height, C.width, C.height] }
    const data = I => { const k = document.createElement('canvas'); k.width = I.width; k.height = I.height; const g = k.getContext('2d'); g.drawImage(I, 0, 0); return g.getImageData(0, 0, I.width, I.height).data }
    const da = data(A), dc = data(C); let n = 0, minY = 1e9, maxY = -1
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - dc[i]) + Math.abs(da[i + 1] - dc[i + 1]) + Math.abs(da[i + 2] - dc[i + 2]) > 30) { n++; const y = Math.floor(i / 4 / A.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
    return { n, minY, maxY }
  }, [u(x.a), u(x.b)])
  if (d.size || d.n || !x.sameText || x.errPr > x.errMain) { bad++; console.log(x.engine, x.w, x.n, x.kind, JSON.stringify(d), 'sameText', x.sameText, JSON.stringify(x.textDiff ?? ''), 'err', x.errMain, x.errPr, JSON.stringify(x.newErrors ?? '').slice(0, 300)) }
}
console.log('compared', results.length, 'different', bad); await b.close()
