// Chart, a layout of a view (docs/design/chart.md): bars or one number from the view's rows, read-only. Loaded only when a chart is on screen.
// Bars are elements, not a picture: each is a button with its value, labels get real ellipses, and it costs nothing to measure.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { axisLabels, axisStep, chartData, chartMeasure, chartSettings, chartTicks, chartValue, shortNumber, type ChartPoint } from '../domain/chart'
import { calcLabels, cellValue, databaseRows, valueText, viewRows, type CalcKind, type CalcResult, type View } from '../domain/database'
import type { Page } from '../domain/types'
import { DatabaseHeader, useOpenRow, ViewNotes, type ChangeView, type DatabaseViewProps } from './database-block'
import { openDatabaseMenu } from './database-menu'
import { todayIso } from './dates'
import { displayPageTitle } from './page-title'
import { calcText } from './property-values'

const openedLimit = 100
/** The room left of the plot, for the axis's numbers. */
const plotLeft = 44

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const seen = new ResizeObserver(() => setWidth(el.clientWidth))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  return { ref, width }
}

// Coming back from a row finds its bar still open, as someone may be working down the list. Until a reload, as a fold is.
const openedBars = new Map<string, string>()

export default function DatabaseChart({ workspace, db, view, changeView, blockId, pageDate, showTitle = true, linked }: DatabaseViewProps & { view: View; changeView: ChangeView }) {
  const today = todayIso(), weekStart = workspace.weekStart ?? 0
  const context = useMemo(() => ({ today, pageDate, weekStart }), [today, pageDate, weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const settings = chartSettings(view), measure = chartMeasure(db.database, view)
  const data = useMemo(() => chartData(db.database, view, rows, weekStart), [db.database, view, rows, weekStart])
  const openKey = `${blockId}|${view.id}`
  const [opened, setOpenedState] = useState<string | null>(() => openedBars.get(openKey) ?? null)
  const setOpened = (build: (now: string | null) => string | null) => setOpenedState(now => { const next = build(now); if (next) openedBars.set(openKey, next); else openedBars.delete(openKey); return next })
  const [showData, setShowData] = useState(false)
  const openRow = useOpenRow(view, rows, blockId)
  const kind: CalcKind = measure && measure !== 'gone' ? measure.kind : 'countAll', property = measure && measure !== 'gone' ? measure.property : null
  const textOf = (result: CalcResult) => calcText(kind, result, property?.format, today, property?.prefix).value
  const named = property ? `${calcLabels[kind]} of ${property.name}` : 'Count'
  const choose = () => openDatabaseMenu(blockId, db.id, 'layout')
  const point = data && data !== 'choose' ? data.points.find(p => p.key === opened) : undefined
  return <>
    <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => {}} />
    <div className="database-chart">
      {measure === 'gone' ? <p className="database-empty"><button type="button" className="app-link" onClick={choose}>Choose what to measure</button></p>
        : settings.form === 'number' ? <div className="database-chart-number" role="img" aria-label={`${named}: ${textOf(chartValue(db.database, rows, measure))}`}><strong>{textOf(chartValue(db.database, rows, measure))}</strong><span>{named}</span></div>
        : data === 'choose' || !data ? <p className="database-empty"><button type="button" className="app-link" onClick={choose}>Choose what to show</button></p>
        : data.tooMany ? <p className="database-empty">Too many values to draw · {data.points.length.toLocaleString('en-US')}, 200 at most</p>
        : settings.form === 'barHorizontal' ? <HorizontalBars points={data.points} opened={opened} onOpen={key => setOpened(now => (now === key ? null : key))} textOf={textOf} />
        : <VerticalBars points={data.points} dateAxis={data.dateAxis} opened={opened} onOpen={key => setOpened(now => (now === key ? null : key))} textOf={textOf} />}
      {rows.length === 0 && databaseRows(workspace, db.id).length === 0 && <p className="database-empty">No rows</p>}
      <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
      {point && <OpenedRows point={point} text={textOf(point.result)} db={db} openRow={openRow} measureId={property?.id} />}
      {data && data !== 'choose' && <>
        <button type="button" className="database-chart-toggle" aria-expanded={showData} onClick={() => setShowData(now => !now)}>{showData ? 'Hide data' : 'Data'}</button>
        {showData && <table className="database-chart-table"><thead><tr><th scope="col">{data.property.name}</th><th scope="col">{named}</th></tr></thead><tbody>
          {data.points.map(p => <tr key={p.key}><td>{p.name}</td><td>{textOf(p.result)}</td></tr>)}
        </tbody></table>}
      </>}
    </div>
  </>
}

function VerticalBars({ points, dateAxis, opened, onOpen, textOf }: { points: ChartPoint[]; dateAxis: boolean; opened: string | null; onOpen: (key: string) => void; textOf: (r: CalcResult) => string }) {
  const { ref, width } = useWidth()
  const values = points.flatMap(p => (p.value === null ? [] : [p.value]))
  const ticks = chartTicks(values), low = ticks[0]!, high = ticks.at(-1)!, span = high - low || 1
  const at = (n: number) => ((n - low) / span) * 100
  const band = width ? (width - plotLeft) / Math.max(points.length, 1) : 0
  const step = axisStep(points, band, dateAxis)
  // A date can be counted along from the labels either side, but an option can't, so bars that can't all be named go across, for this width only.
  if (!dateAxis && step > 1) return <div ref={ref}><HorizontalBars points={points} opened={opened} onOpen={onOpen} textOf={textOf} /></div>
  const shown = axisLabels(points, step, dateAxis)
  return <div className={`database-chart-vertical${band && band < 6 ? ' is-dense' : ''}`} ref={ref}>
    <div className="database-chart-plot">
      {ticks.map(t => <div key={t} className={`database-chart-tick${t === 0 ? ' is-zero' : ''}`} style={{ bottom: `${at(t)}%` }}><span>{shortNumber(t)}</span></div>)}
      <div className="database-chart-bars">
        {points.map(p => {
          const value = p.value, from = at(Math.min(0, value ?? 0)), to = at(Math.max(0, value ?? 0)), text = textOf(p.result)
          return <button key={p.key} type="button" className={`database-chart-bar${opened === p.key ? ' is-open' : ''}${opened && opened !== p.key ? ' is-dim' : ''}`} title={`${p.name}: ${text}`} aria-label={`${p.name}: ${text}`} aria-pressed={opened === p.key} onClick={() => onOpen(p.key)}>
            {value ? <i style={{ bottom: `${from}%`, height: `${to - from}%` }} /> : null}
            {band >= 34 && value !== null && <b style={{ bottom: `${to}%` }}>{shortNumber(value)}</b>}
          </button>
        })}
      </div>
    </div>
    <div className="database-chart-labels" aria-hidden="true">
      {/* A label shown takes the room of the bars whose labels gave way to it. */}
      {shown.map((l, i) => <span key={l.key} className={step > 1 ? (i === shown.length - 1 ? 'is-spanning is-last' : 'is-spanning') : undefined} title={l.full} style={{ flexGrow: step }}>{l.label}</span>)}
    </div>
  </div>
}

function HorizontalBars({ points, opened, onOpen, textOf }: { points: ChartPoint[]; opened: string | null; onOpen: (key: string) => void; textOf: (r: CalcResult) => string }) {
  const values = points.flatMap(p => (p.value === null ? [] : [p.value]))
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1
  const at = (n: number) => ((n - low) / span) * 100
  return <div className="database-chart-horizontal">
    {points.map(p => {
      const value = p.value, from = at(Math.min(0, value ?? 0)), to = at(Math.max(0, value ?? 0)), text = textOf(p.result)
      return <button key={p.key} type="button" className={`database-chart-line${opened === p.key ? ' is-open' : ''}${opened && opened !== p.key ? ' is-dim' : ''}`} title={`${p.name}: ${text}`} aria-label={`${p.name}: ${text}`} aria-pressed={opened === p.key} onClick={() => onOpen(p.key)}>
        <span className="database-chart-line-name">{p.name}</span>
        <span className="database-chart-line-track">{value ? <i style={{ left: `${from}%`, width: `${to - from}%` }} /> : null}</span>
        <span className="database-chart-line-value">{value === null ? text : shortNumber(value)}</span>
      </button>
    })}
  </div>
}

/** The rows behind a bar: a plain table, read-only, and a row opens as a page (§5). */
function OpenedRows({ point, text, db, openRow, measureId }: { point: ChartPoint; text: string; db: DatabaseViewProps['db']; openRow: (rowId: string) => void; measureId?: string }) {
  const [limit, setLimit] = useState(openedLimit)
  const measured = measureId ? db.database.properties.find(p => p.id === measureId) : undefined
  const cell = (row: Page) => (measured ? valueText(db.database, measured.id, cellValue(db.database, row, measured.id)) : null)
  return <section className="database-chart-opened" aria-label={point.name}>
    <h4>{point.name} · {text}</h4>
    {point.rows.length === 0 ? <p className="database-menu-quiet">No rows</p> : <table className="database-chart-table"><tbody>
      {point.rows.slice(0, limit).map(row => <tr key={row.id}><td><button type="button" className="database-chart-row" onClick={() => openRow(row.id)}>{displayPageTitle(row)}</button></td>{measured && <td>{cell(row)}</td>}</tr>)}
    </tbody></table>}
    {point.rows.length > limit && <button type="button" className="database-chart-toggle" onClick={() => setLimit(n => n + openedLimit)}>Show more</button>}
  </section>
}
