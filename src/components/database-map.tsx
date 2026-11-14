// The Map view (place.md §3, map-contract.md; D15 G8-9 to G8-12). Its own chunk with MapLibre, loaded only when a Map
// view is near the screen. Rows with a pin are drawn as our own layers over OpenFreeMap's grey style, at most 100, and
// one live map per page: any other shows its frame with "Show map". Every request MapLibre makes goes through
// `mapRequest`, so only tiles.openfreemap.org is asked, with no credentials and no referrer.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Map as MapLibre, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type RequestTransformFunction } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { cellValue, viewColumns, viewRows, type Database, type View } from '../domain/database.ts'
import { mapRows, shownLine, viewMapBy, type MapRow } from '../domain/map.ts'
import type { Page } from '../domain/types'
import { DatabaseHeader, useOpenRow, ViewNotes, type ChangeView, type DatabaseViewProps } from './database-block'
import { openDatabaseMenu } from './database-menu'
import { fetchMapStyle, mapRequest } from './map-boundary'
import { PropertyCell, useWide } from './property-editors'
import { todayIso } from './dates'
import { zoneCities } from './zone-cities'

setWorkerUrl(workerUrl)

type Props = DatabaseViewProps & { view: View; changeView: ChangeView }
type DatabasePage = Page & { database: Database }
type Scheme = 'light' | 'dark'
type MapState = 'loading' | 'ready' | 'unavailable' | 'nowebgl'

/** The style's own background, so the frame reads as the map before it draws (Jazz 754c8cf8). */
const backgrounds: Record<Scheme, string> = { light: '#F2F3F0', dark: '#0C0C0C' }
const loadLimitMs = 10_000

// ---------- One live map at a time (Lead 9f694596) ----------
let liveKey: string | null = null
const liveListeners = new Set<() => void>()
const setLive = (key: string | null) => { liveKey = key; for (const l of liveListeners) l() }
function useLive(key: string, near: boolean): [boolean, () => void] {
  const live = useSyncExternalStore(l => { liveListeners.add(l); return () => liveListeners.delete(l) }, () => liveKey === key, () => false)
  // The first map near the screen takes it; one that goes away gives it up.
  useEffect(() => { if (near && liveKey === null) setLive(key) }, [near, key])
  useEffect(() => () => { if (liveKey === key) setLive(null) }, [key])
  return [live, () => setLive(key)]
}

function useScheme(): Scheme {
  const query = '(prefers-color-scheme: dark)'
  return useSyncExternalStore(l => { const m = matchMedia(query); m.addEventListener('change', l); return () => m.removeEventListener('change', l) }, () => (matchMedia(query).matches ? 'dark' : 'light'), () => 'light')
}

/** Near the screen, as a dashboard widget is (300 px margin): only then is the map built. */
function useNear(el: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const node = el.current
    if (near || !node) return
    const seen = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setNear(true) }, { rootMargin: '300px 0px' })
    seen.observe(node)
    return () => seen.disconnect()
  }, [near, el])
  return near
}

const hasWebGL2 = (): boolean => { try { return Boolean(document.createElement('canvas').getContext('webgl2')) } catch { return false } }

/** Where the map was, on this device only: panning writes nothing to the workspace (map-contract.md §2). */
type Area = { center: [number, number]; zoom: number }
const areaKey = (blockId: string, viewId: string) => `daythread:map-area:${blockId}:${viewId}`
function savedArea(key: string): Area | null {
  try {
    const a = JSON.parse(localStorage.getItem(key) ?? 'null') as Area | null
    return a && Array.isArray(a.center) && a.center.every(Number.isFinite) && Number.isFinite(a.zoom) ? a : null
  } catch { return null }
}

export function DatabaseMap({ workspace, db, view, changeView, blockId, pageDate, showTitle = true, linked }: Props) {
  const context = useMemo(() => ({ today: todayIso(), pageDate, weekStart: workspace.weekStart ?? 0 }), [pageDate, workspace.weekStart])
  const rows = useMemo(() => viewRows(workspace, db.id, view, context), [workspace, db.id, view, context])
  const openRow = useOpenRow(view, rows, blockId)
  const property = viewMapBy(db.database, view)
  const m = useMemo(() => (property ? mapRows(rows, row => cellValue(db.database, row, property.id)) : null), [rows, property, db.database])
  const [noPlaceOpen, setNoPlaceOpen] = useState(false)
  const fullPage = blockId.startsWith('page:') && !blockId.includes('|widget:')
  const widget = blockId.includes('|widget:')
  const head = <DatabaseHeader db={db} view={view} changeView={changeView} blockId={blockId} showTitle={showTitle} linked={linked} onTitleEnter={() => {}} />
  if (!property || !m) return <div className="database-map">
    {head}
    <div className="map-frame is-empty"><button type="button" className="app-link" onClick={() => openDatabaseMenu(blockId, db.id, 'layout')}>Choose a Place property</button></div>
  </div>
  const line = shownLine(m)
  return <div className={`database-map${fullPage ? ' is-page' : ''}${widget ? ' is-widget' : ''}`}>
    {head}
    <MapFrame db={db} view={view} blockId={blockId} pinned={m.pinned} onOpen={openRow} zone={workspace.timezone} />
    {(line || m.noPlace.length > 0) && <p className="map-line">
      {line && <span>{line}</span>}
      {m.noPlace.length > 0 && <button type="button" className="database-undated-head" aria-expanded={noPlaceOpen} onClick={() => setNoPlaceOpen(o => !o)}>No place · {m.noPlace.length} ›</button>}
    </p>}
    {noPlaceOpen && <div className="map-no-place">
      {m.noPlace.slice(0, 50).map(row => <button key={row.id} type="button" className="database-day-row" onClick={() => openRow(row.id)}>{row.title || 'Untitled'}</button>)}
    </div>}
    <ViewNotes db={db} view={view} changeView={changeView} empty={rows.length === 0} />
  </div>
}

/** The map itself in its frame: drawn at full size at once, in the style's background, so nothing moves when it arrives. */
function MapFrame({ db, view, blockId, pinned, onOpen, zone }: { db: DatabasePage; view: View; blockId: string; pinned: MapRow<Page>[]; onOpen: (rowId: string) => void; /** His workspace's time zone: its city is where an empty map first opens. */ zone: string }) {
  const frame = useRef<HTMLDivElement>(null)
  const canvasHolder = useRef<HTMLDivElement>(null)
  const scheme = useScheme()
  const near = useNear(frame)
  const key = `${blockId}|${view.id}`
  const [live, takeLive] = useLive(key, near)
  const [state, setState] = useState<MapState>('loading')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<{ ids: string[]; at: [number, number] } | null>(null)
  const map = useRef<MapLibre | null>(null)
  const [, setMoved] = useState(0)
  const pinsRef = useRef(pinned)
  pinsRef.current = pinned

  // Build the map when this frame is live and near; take it down when it isn't.
  useEffect(() => {
    if (!live || !near || !canvasHolder.current) return
    if (!hasWebGL2()) { setState('nowebgl'); return }
    let gone = false
    setState('loading')
    const timer = setTimeout(() => { if (!gone && map.current && !map.current.loaded()) { map.current.remove(); map.current = null; setState('unavailable') } }, loadLimitMs)
    void fetchMapStyle(scheme).then(style => {
      if (gone) return
      if (!style) { setState('unavailable'); return }
      const area = savedArea(areaKey(blockId, view.id))
      const first = pinsRef.current
      const city = zoneCities[zone]
      const instance = new MapLibre({
        container: canvasHolder.current!,
        style: style as never,
        // `omit` where MapLibre's type only names `same-origin`: fetch takes it as given, and no cookie goes either way to another origin.
        transformRequest: ((url: string) => mapRequest(url)) as unknown as RequestTransformFunction,
        attributionControl: { compact: true },
        ...(area ? { center: area.center, zoom: area.zoom } : city ? { center: [city[1], city[0]] as [number, number], zoom: 10 } : { center: [0, 20] as [number, number], zoom: 1 }),
      })
      map.current = instance
      // For the browser checks: where a pin is drawn, without a global (tests/evidence/map/map.mjs).
      Object.defineProperty(canvasHolder.current!, 'mapForChecks', { value: instance, configurable: true })
      instance.on('load', () => {
        if (gone) return
        clearTimeout(timer)
        // Attribution starts folded to its ⓘ, linked and at the bottom right, so a small map isn't covered (G8-11).
        instance.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
        addPinLayers(instance)
        drawPins(instance, pinsRef.current)
        if (!area && first.length) fit(instance, first)
        setState('ready')
      })
      instance.on('moveend', () => {
        const c = instance.getCenter()
        try { localStorage.setItem(areaKey(blockId, view.id), JSON.stringify({ center: [c.lng, c.lat], zoom: instance.getZoom() })) } catch { /* private mode */ }
      })
      instance.on('move', () => setMoved(n => n + 1))
      instance.on('click', 'map-clusters', (e: MapLayerMouseEvent) => openCluster(instance, e, setSelected))
      instance.on('click', 'map-pins', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (f) setSelected({ ids: [String(f.properties?.id)], at: (f.geometry as unknown as { coordinates: [number, number] }).coordinates })
      })
      instance.on('click', e => { if (!instance.queryRenderedFeatures(e.point, { layers: ['map-pins', 'map-clusters'] }).length) setSelected(null) })
      for (const layer of ['map-pins', 'map-clusters']) {
        instance.on('mouseenter', layer, () => { instance.getCanvas().style.cursor = 'pointer' })
        instance.on('mouseleave', layer, () => { instance.getCanvas().style.cursor = '' })
      }
    })
    return () => { gone = true; clearTimeout(timer); map.current?.remove(); map.current = null; setSelected(null) }
  }, [live, near, scheme, attempt, blockId, view.id, zone])

  // New rows, a filter or a pick: the same map, its pins redrawn.
  useEffect(() => { if (map.current && state === 'ready') drawPins(map.current, pinned) }, [pinned, state])

  // Keys, cut, copy and paste meant for the map stay out of the page (R1-26). Native listeners on the frame, as the page
  // editor around an inline map listens natively on its own element, which React's own handlers would reach too late.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    const kinds = ['keydown', 'keyup', 'keypress', 'cut', 'copy', 'paste', 'beforeinput'] as const
    for (const k of kinds) el.addEventListener(k, stop)
    return () => { for (const k of kinds) el.removeEventListener(k, stop) }
  }, [])
  // Esc closes the card.
  const keep = (e: ReactKeyboardEvent) => { if (e.key === 'Escape' && selected) { e.preventDefault(); setSelected(null) } }
  const height = blockId.includes('|widget:') ? '100%' : undefined
  const card = selected && map.current && state === 'ready' ? (() => {
    const at = map.current!.project(selected.at)
    const rows = pinsRef.current.filter(p => selected.ids.includes(p.row.id))
    return rows.length ? <PinCard db={db} view={view} rows={rows} x={at.x} y={at.y} onOpen={onOpen} /> : null
  })() : null
  return <div ref={frame} className={`map-frame is-${state}${live ? ' is-live' : ''}`} style={{ background: state === 'unavailable' || state === 'nowebgl' ? undefined : backgrounds[scheme], ...(height ? { height } : {}) }}
    onKeyDownCapture={keep}>
    {live && state !== 'unavailable' && state !== 'nowebgl' && <div ref={canvasHolder} className="map-canvas" aria-label={`Map of ${view.name}`} />}
    {card}
    {!live && <button type="button" className="map-show" onClick={takeLive}>Show map</button>}
    {live && state === 'unavailable' && <p className="map-state">Map unavailable · <button type="button" className="app-link" onClick={() => { setState('loading'); setAttempt(n => n + 1) }}>Retry</button></p>}
    {live && state === 'nowebgl' && <p className="map-state">Map isn't available in this browser</p>}
  </div>
}

/** A pin's card (G8-9): its row's title and shown properties; at one address, every row there. A tap opens the row. */
function PinCard({ db, view, rows, x, y, onOpen }: { db: DatabasePage; view: View; rows: MapRow<Page>[]; x: number; y: number; onOpen: (rowId: string) => void }) {
  const wide = useWide()
  const columns = viewColumns(db.database, view).slice(0, 3)
  return <div className={`map-card${wide ? '' : ' is-phone'}`} style={wide ? { left: x, top: y } : undefined} role="dialog" aria-label={rows.length > 1 ? `${rows.length} places here` : rows[0]!.row.title || 'Untitled'}>
    {rows.map(({ row }) => <button key={row.id} type="button" className="map-card-row" onClick={() => onOpen(row.id)}>
      <span className="map-card-title">{row.title || 'Untitled'}</span>
      {rows.length === 1 && columns.map(c => <span key={c.property.id} className="map-card-value"><PropertyCell property={c.property} value={cellValue(db.database, row, c.property.id)} row={row} /></span>)}
    </button>)}
  </div>
}

// ---------- Our own layers, so neither style decides how pins look (Jazz 767879e2) ----------
const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1b1b1b'
const paper = () => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#ffffff'

function addPinLayers(map: MapLibre) {
  map.addSource('map-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 40, clusterMaxZoom: 16 })
  // Clusters: Ink circles of 28, 32 or 36 px by count, the count in Paper.
  map.addLayer({ id: 'map-clusters', type: 'circle', source: 'map-pins', filter: ['has', 'point_count'], paint: { 'circle-color': ink(), 'circle-radius': ['step', ['get', 'point_count'], 14, 10, 16, 50, 18] } })
  map.addLayer({ id: 'map-cluster-count', type: 'symbol', source: 'map-pins', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': paper() } })
  // A pin: a 12 px Ink dot with a 2 px Paper ring.
  map.addLayer({ id: 'map-pins', type: 'circle', source: 'map-pins', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ink(), 'circle-radius': 6, 'circle-stroke-color': paper(), 'circle-stroke-width': 2 } })
}

function drawPins(map: MapLibre, pinned: MapRow<Page>[]) {
  const source = map.getSource('map-pins') as GeoJSONSource | undefined
  source?.setData({ type: 'FeatureCollection', features: pinned.map(p => ({ type: 'Feature', properties: { id: p.row.id }, geometry: { type: 'Point', coordinates: [p.place.lon, p.place.lat] } })) })
}

function fit(map: MapLibre, pinned: MapRow<Page>[]) {
  if (pinned.length === 1) { map.jumpTo({ center: [pinned[0]!.place.lon, pinned[0]!.place.lat], zoom: 14 }); return }
  const lons = pinned.map(p => p.place.lon), lats = pinned.map(p => p.place.lat)
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 48, maxZoom: 14, duration: 0 })
}

/** A tap on a cluster zooms to fit it; at the deepest zoom, rows at one place open a card listing them. */
function openCluster(map: MapLibre, e: MapLayerMouseEvent, select: (s: { ids: string[]; at: [number, number] }) => void) {
  const f = e.features?.[0]
  if (!f) return
  const source = map.getSource('map-pins') as GeoJSONSource, clusterId = Number(f.properties?.cluster_id)
  const at = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
  void source.getClusterExpansionZoom(clusterId).then(zoom => {
    if (zoom <= 16 && zoom > map.getZoom()) { map.easeTo({ center: at, zoom }); return }
    void source.getClusterLeaves(clusterId, 100, 0).then(leaves => select({ ids: leaves.map(l => String(l.properties?.id)), at }))
  })
}
