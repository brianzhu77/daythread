// Export from a chart's `⋯` (chart.md §5, G4-8): copy or download a PNG or an SVG of what the chart shows. In the Home Screen app on an
// iPhone a download goes nowhere he can see, so there it hands the file to the share sheet, or says why it can't.
import { chartData, chartMeasure, chartSettings, chartValue } from '../domain/chart'
import { chartSvg, lightPalette, pictureName, type ChartPalette } from '../domain/chart-svg'
import { calcLabels, viewRows, type CalcKind, type CalcResult, type Database, type View, type ViewContext } from '../domain/database'
import { safeName } from '../domain/export'
import type { Page, Workspace } from '../domain/types'
import { saveFile } from './database-export'
import { calcText } from './property-values'

/** What the chart draws now, as an SVG, or null where it has nothing to draw (no measure, nothing chosen, too many values). */
export function chartPicture(workspace: Workspace, db: Page & { database: Database }, view: View, context: ViewContext, palette: ChartPalette): string | null {
  const measure = chartMeasure(db.database, view), settings = chartSettings(view)
  if (measure === 'gone') return null
  const rows = viewRows(workspace, db.id, view, context)
  const kind: CalcKind = measure ? measure.kind : 'countAll', property = measure ? measure.property : null
  const textOf = (result: CalcResult) => calcText(kind, result, property?.format, context.today, property?.prefix).value
  const measureName = property ? `${calcLabels[kind]} of ${property.name}` : 'Count'
  const title = pictureName(db.title, view.name, ' · ')
  if (settings.form === 'number') return chartSvg({ title, measureName, settings, data: null, number: textOf(chartValue(db.database, rows, measure)), valueText: () => '', palette })
  const data = chartData(db.database, view, rows, context.weekStart ?? 0)
  if (!data || data === 'choose' || data.tooMany) return null
  return chartSvg({ title, measureName, settings, data, valueText: p => textOf(p.result), palette })
}

export const chartFileName = (db: Page, view: View, extension: 'png' | 'svg') => `${safeName(pictureName(db.title, view.name, ' - '))}.${extension}`

/** The theme it's exported from, as plain sRGB colours any app reads: the page's own colours may be written in a space an SVG viewer doesn't know. */
export function themePalette(): ChartPalette {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const paper = solid(read('--paper', lightPalette.paper), lightPalette.paper)
  const greys = [read('--ink', lightPalette.greys[0]!), read('--ink-2', lightPalette.greys[1]!), read('--ink-3', lightPalette.greys[2]!), read('--chart-grey-4', lightPalette.greys[3]!)]
  return { paper, ink: solid(greys[0]!, lightPalette.ink), muted: solid(greys[1]!, lightPalette.muted), line: solid(read('--line', lightPalette.line), lightPalette.line), greys: greys.map((g, i) => solid(g, lightPalette.greys[i]!)) }
}

let pixel: CanvasRenderingContext2D | null = null
/** A colour as `#rrggbb`, by painting one pixel with it; a see-through one is laid on white, as a background must be solid (Bumblebee 915d799e). */
function solid(color: string, fallback: string): string {
  pixel ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  if (!pixel) return fallback
  pixel.globalCompositeOperation = 'copy'
  pixel.fillStyle = '#ffffff'; pixel.fillRect(0, 0, 1, 1)
  pixel.globalCompositeOperation = 'source-over'
  pixel.fillStyle = fallback; pixel.fillStyle = color
  pixel.fillRect(0, 0, 1, 1)
  const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map(n => (n ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/** The SVG drawn at twice its size, sharp on a phone's screen. */
export function pngOf(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth * scale, height: image.naturalHeight * scale })
      const draw = canvas.getContext('2d')
      if (!draw) { reject(new Error('No canvas')); return }
      draw.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('No PNG'))), 'image/png')
    }
    image.onerror = () => reject(new Error('The SVG did not load'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const homeScreen = () => Boolean((navigator as { standalone?: boolean }).standalone) || window.matchMedia('(display-mode: standalone)').matches
/** True where a download would go nowhere visible, so the file goes to the share sheet. */
export const sharesInstead = () => iPhone() && homeScreen()

export type ExportResult = 'done' | 'cancelled' | { problem: string }

/** Downloads the file, or in the Home Screen app hands it to the share sheet. Called straight from the tap: a share needs the tap's permission. */
export function saveChart(file: File): Promise<ExportResult> {
  if (!sharesInstead()) { saveFile(file.name, file, file.type); return Promise.resolve('done') }
  if (!navigator.canShare?.({ files: [file] })) return Promise.resolve({ problem: "This phone can't pass a file on from the Home Screen app. Open Daythread in Safari to download it." })
  return navigator.share({ files: [file] }).then(
    () => 'done' as const,
    (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' as const : { problem: 'The picture wasn’t shared. Try again.' }),
  )
}

export async function copyChart(png: Blob): Promise<ExportResult> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return { problem: "This browser can't copy a picture. Save the PNG instead." }
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); return 'done' } catch { return { problem: 'The picture wasn’t copied. Save the PNG instead.' } }
}
