// Heavy work that can wait (the map's code and its first draw, map-contract.md §4): start it only once the page is
// idle and he hasn't typed or tapped for a moment, so a line he's typing in never waits on it (Lead cdc31250).
let lastInput = 0
if (typeof document !== 'undefined') for (const kind of ['keydown', 'input', 'pointerdown', 'compositionupdate']) document.addEventListener(kind, () => { lastInput = performance.now() }, true)

type Idle = (cb: () => void, opts: { timeout: number }) => number
const idle: Idle = (cb, opts) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, opts) : window.setTimeout(cb, 200))
const cancelIdle = (id: number) => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id))

/** Calls `run` once the page is idle and has had no input for `quietMs`; the returned function cancels it. */
export function whenQuiet(run: () => void, quietMs = 800, idleTimeoutMs = 2000): () => void {
  let idleId = 0, timer = 0, done = false
  const attempt = () => {
    idleId = idle(() => {
      if (done) return
      const since = performance.now() - lastInput
      if (lastInput && since < quietMs) { timer = window.setTimeout(attempt, quietMs - since); return }
      done = true
      run()
    }, { timeout: idleTimeoutMs })
  }
  attempt()
  return () => { done = true; cancelIdle(idleId); clearTimeout(timer) }
}
