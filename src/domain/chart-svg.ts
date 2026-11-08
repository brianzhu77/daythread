// A chart as a standalone SVG, for Export (chart.md §5, G4-8): the same data the page draws, in the theme's ink and greys on its own
// solid paper, with its names written in. It's drawn from the data rather than copied from the page, which draws its bars as HTML.
import { donutSlices, type ChartData, type ChartPoint, type ChartSettings } from './chart.ts'

const W = 720, H = 420, PAD = 40, AXIS = 56
/** The theme it's exported from (Bumblebee 915d799e): a solid paper, never transparent, so a dark chart pasted on white still reads. */
export interface ChartPalette { paper: string; ink: string; muted: string; line: string; /** Series and slices, strongest first; Other is an outline (§4). */ greys: string[] }
export const lightPalette: ChartPalette = { paper: '#ffffff', ink: '#1f1f1f', muted: '#6b6b6b', line: '#d9d9d9', greys: ['#1f1f1f', '#5c5c5c', '#8f8f8f', '#bcbcbc'] }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, n: number) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s)
const text = (x: number, y: number, s: string, attrs = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${esc(s)}</text>`
const fill = (c: ChartPalette, grey: number | null | undefined) => (grey === null ? 'none' : c.greys[(grey ?? 0) % c.greys.length]!)

export interface ChartSvgInput { title: string; measureName: string; settings: ChartSettings; data: ChartData | null; number?: string; valueText: (p: ChartPoint) => string; palette?: ChartPalette }

export function chartSvg({ title, measureName, settings, data, number, valueText, palette = lightPalette }: ChartSvgInput): string {
  const c = palette
  const body: string[] = []
  body.push(text(PAD, 32, cut(title, 60), `font-size="18" font-weight="600" fill="${c.ink}"`))
  if (settings.form === 'number' || !data) {
    body.push(text(W / 2, H / 2, number ?? '', `font-size="64" font-weight="700" text-anchor="middle" fill="${c.ink}"`))
    body.push(text(W / 2, H / 2 + 36, measureName, `font-size="16" text-anchor="middle" fill="${c.muted}"`))
  } else if (settings.form === 'donut') body.push(...donut(data, c))
  else if (settings.form === 'barHorizontal') body.push(...horizontal(data, valueText, c))
  else body.push(...vertical(data, settings.form === 'line', valueText, c))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="${c.paper}"/>${body.join('')}</svg>`
}

const top = (data: ChartData) => Math.max(0, ...data.points.map(p => p.value ?? 0))
const bottom = (data: ChartData) => Math.min(0, ...data.points.map(p => p.value ?? 0))

function vertical(data: ChartData, line: boolean, valueText: (p: ChartPoint) => string, c: ChartPalette): string[] {
  const out: string[] = [], points = data.points, n = Math.max(1, points.length)
  const x0 = PAD, x1 = W - PAD, y0 = 60, y1 = H - AXIS, hi = top(data), lo = bottom(data), span = hi - lo || 1
  const y = (v: number) => y1 - ((v - lo) / span) * (y1 - y0), band = (x1 - x0) / n, bar = Math.max(2, band * 0.6)
  out.push(`<line x1="${x0}" y1="${y(0).toFixed(1)}" x2="${x1}" y2="${y(0).toFixed(1)}" stroke="${c.line}"/>`)
  const labelEvery = Math.max(1, Math.ceil(n / Math.floor((x1 - x0) / 70)))
  points.forEach((p, i) => {
    const cx = x0 + band * (i + 0.5)
    if (!line) {
      if (p.parts && data.series?.length && data.overlapping) {
        // A row in more than one series: side by side, as the parts don't add up to a whole (chart.md §3).
        const each = bar / p.parts.length
        p.parts.forEach((part, j) => {
          const v = part.value ?? 0, sr = data.series!.find(s => s.key === part.key)
          if (v) out.push(`<rect x="${(cx - bar / 2 + each * j).toFixed(1)}" y="${Math.min(y(0), y(v)).toFixed(1)}" width="${Math.max(1, each - 1).toFixed(1)}" height="${Math.abs(y(v) - y(0)).toFixed(1)}" fill="${fill(c, sr?.grey)}" stroke="${sr?.grey === null ? c.ink : 'none'}"/>`)
        })
      } else if (p.parts && data.series?.length) {
        let at = 0
        for (const part of p.parts) {
          const v = part.value ?? 0, sr = data.series.find(s => s.key === part.key)
          if (!v) continue
          const from = y(at), to = y(at + v)
          out.push(`<rect x="${(cx - bar / 2).toFixed(1)}" y="${Math.min(from, to).toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.abs(to - from).toFixed(1)}" fill="${fill(c, sr?.grey)}" stroke="${sr?.grey === null ? c.ink : 'none'}"/>`)
          at += v
        }
      } else if (p.value !== null) out.push(`<rect x="${(cx - bar / 2).toFixed(1)}" y="${Math.min(y(0), y(p.value)).toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.abs(y(p.value) - y(0)).toFixed(1)}" fill="${c.ink}"/>`)
    }
    if (p.value !== null && n <= 24) out.push(text(cx, y(Math.max(0, p.value)) - 6, valueText(p), `font-size="11" text-anchor="middle" fill="${c.muted}"`))
    if (i % labelEvery === 0) out.push(text(cx, y1 + 18, cut(p.name, Math.max(4, Math.floor((band * labelEvery) / 7))), `font-size="12" text-anchor="middle" fill="${c.ink}"`))
  })
  if (line) {
    const pts = points.map((p, i) => (p.value === null ? null : `${(x0 + band * (i + 0.5)).toFixed(1)},${y(p.value).toFixed(1)}`))
    // A missing value breaks the line, as on the page.
    let run: string[] = []
    const flush = () => { if (run.length) out.push(`<polyline points="${run.join(' ')}" fill="none" stroke="${c.ink}" stroke-width="2"/>`); run = [] }
    for (const pt of pts) { if (pt) run.push(pt); else flush() }
    flush()
  }
  out.push(...legend(data, H - 14, c))
  return out
}

function horizontal(data: ChartData, valueText: (p: ChartPoint) => string, c: ChartPalette): string[] {
  const out: string[] = [], points = data.points.slice(0, 20), labelW = 180, x0 = PAD + labelW, x1 = W - PAD - 60, y0 = 56
  const row = Math.min(28, (H - y0 - 30) / Math.max(1, points.length)), hi = top(data) || 1
  points.forEach((p, i) => {
    const cy = y0 + row * i + row / 2, w = p.value && p.value > 0 ? ((x1 - x0) * p.value) / hi : 0
    out.push(text(x0 - 10, cy + 4, cut(p.name, 26), `font-size="12" text-anchor="end" fill="${c.ink}"`))
    const bandY = cy - row * 0.32, bandH = row * 0.64
    if (p.parts && data.series?.length) {
      // Parts across, stacked, or one under another where a row is in several series, as on the page.
      let at = 0
      const each = bandH / p.parts.length
      p.parts.forEach((part, j) => {
        const v = part.value ?? 0, sr = data.series!.find(x => x.key === part.key), pw = v > 0 ? ((x1 - x0) * v) / hi : 0
        if (!pw) return
        const x = data.overlapping ? x0 : x0 + at, y = data.overlapping ? bandY + each * j : bandY, h = data.overlapping ? Math.max(1, each - 1) : bandH
        out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pw.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill(c, sr?.grey)}" stroke="${sr?.grey === null ? c.ink : 'none'}"/>`)
        at += pw
      })
    } else out.push(`<rect x="${x0}" y="${bandY.toFixed(1)}" width="${w.toFixed(1)}" height="${bandH.toFixed(1)}" fill="${c.ink}"/>`)
    if (p.value !== null) out.push(text(x0 + w + 6, cy + 4, valueText(p), `font-size="11" fill="${c.muted}"`))
  })
  if (data.points.length > points.length) out.push(text(W - PAD, H - 12, `${data.points.length - points.length} more not shown`, `font-size="11" text-anchor="end" fill="${c.muted}"`))
  out.push(...legend(data, H - 12, c))
  return out
}

function donut(data: ChartData, c: ChartPalette): string[] {
  const out: string[] = [], { slices, total } = donutSlices(data.points), cx = 210, cy = 230, r = 140, inner = 82
  let angle = -Math.PI / 2
  for (const sl of slices) {
    const a = total ? (sl.value / total) * Math.PI * 2 : 0, end = angle + a, large = a > Math.PI ? 1 : 0
    const p = (t: number, rad: number) => `${(cx + rad * Math.cos(t)).toFixed(2)} ${(cy + rad * Math.sin(t)).toFixed(2)}`
    if (a > 0) out.push(`<path d="M ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(end - 1e-6, r)} L ${p(end - 1e-6, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(angle, inner)} Z" fill="${fill(c, sl.grey)}" stroke="${sl.grey === null ? c.ink : c.paper}" stroke-width="1.5"/>`)
    angle = end
  }
  slices.forEach((sl, i) => {
    const ly = 110 + i * 26
    out.push(`<rect x="420" y="${ly - 11}" width="14" height="14" fill="${fill(c, sl.grey)}" stroke="${sl.grey === null ? c.ink : 'none'}"/>`)
    out.push(text(442, ly, `${cut(sl.name, 24)} · ${Math.round(sl.share * 100)}%`, `font-size="13" fill="${c.ink}"`))
  })
  return out
}

function legend(data: ChartData, y: number, c: ChartPalette): string[] {
  if (!data.series || data.series.length < 2) return []
  const out: string[] = []
  let x = PAD
  for (const sr of data.series.slice(0, 6)) {
    out.push(`<rect x="${x}" y="${y - 10}" width="12" height="12" fill="${fill(c, sr.grey)}" stroke="${sr.grey === null ? c.ink : 'none'}"/>`)
    out.push(text(x + 18, y, cut(sr.name, 16), `font-size="12" fill="${c.ink}"`))
    x += 26 + Math.min(16, [...sr.name].length) * 7
  }
  return out
}
