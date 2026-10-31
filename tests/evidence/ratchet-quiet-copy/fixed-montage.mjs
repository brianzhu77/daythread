// A "·" only between two items on one line: never at a line's start or end. Usage: node montage.mjs <base>.
// Renders the full signed-in row (every item at once) in the real sidebar styles at 150-300px.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = new URL('./screens/fixed/', import.meta.url).pathname, widths = [150, 194, 239, 260, 300, 350]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
for (const [name, br] of [['chromium', chromium], ['webkit', webkit]]) for (const scheme of ['light', 'dark']) for (const set of ['normal', 'failure']) {
  const b = await br.launch(); const p = await b.newPage({ viewport: { width: 1800, height: 900 }, colorScheme: scheme })
  await p.goto(`${base}/`); await p.waitForSelector('.account-row-sidebar .account-items'); await p.waitForTimeout(500)
  const res = await p.evaluate(([widths, set]) => {
    const src = document.querySelector('.account-row-sidebar')
    const item = h => `<span class="account-item">${h}</span> `
    // The real markup: a message and its action are two items (account-row.tsx, reminders.tsx, home-screen-hint.tsx).
    const normal = ['<span class="account-text account-email">reviewer@a-long-but-valid-company-domain.example</span>', '<select class="account-zone"><option>America/Vancouver</option></select>', '<button type="button" class="link">Templates</button>', '<button type="button" class="link">Export</button>',
      '<span class="account-text">Reminders on</span>', '<button type="button" class="link">Turn off</button>',
      '<span class="account-text">Add to Home Screen for the full-screen app: Share, then “Add to Home Screen”</span>', '<button type="button" class="link">Got it</button>',
      '<button type="button" class="link">Sign out</button>', '<button type="button" class="link">Delete account</button>']
    // Ratchet 9bc0e0c8: the failure states.
    const failure = ['<span class="account-text account-email">reviewer@a-long-but-valid-company-domain.example</span>', '<select class="account-zone"><option>America/Vancouver</option></select>', '<button type="button" class="link">Templates</button>',
      '<span class="account-text">Not exported\u00a0·\u00a0latest text not saved yet</span>', '<button type="button" class="link retry">Try again</button>',
      '<span class="account-text">Couldn’t turn on reminders</span>', '<button type="button" class="link">Turn on reminders</button>',
      '<span class="account-text">Add to Home Screen for the full-screen app: Share, then “Add to Home Screen”</span>', '<button type="button" class="link">Got it</button>',
      '<button type="button" class="link">Sign out</button>', '<button type="button" class="link">Delete account</button>']
    const html = (set === 'normal' ? normal : failure).map(item).join('')
    const box = document.createElement('div'); box.id = 'montage'; box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;gap:16px;align-items:flex-start;padding:16px'
    for (const w of widths) { const c = src.cloneNode(true); c.style.cssText = `width:${w}px;flex:none;outline:1px dashed #c33;padding:0`; c.querySelector('.account-items').innerHTML = html; const l = document.createElement('div'); l.textContent = w + 'px'; l.style.cssText = 'font-size:11px;color:#c33'; const wrap = document.createElement('div'); wrap.append(l, c); box.append(wrap) }
    document.body.append(box)
    return [...box.querySelectorAll('.account-row-sidebar')].map(row => {
      const pEl = row.querySelector('p'), clip = pEl.getBoundingClientRect().left, text = clip + 3, em = parseFloat(getComputedStyle(pEl).fontSize)
      const items = [...row.querySelectorAll('.account-item')].map(i => { const r = i.getClientRects()[0]; return { dot: r.left + 0.3 * em, textLeft: r.left + 0.9 * em, top: r.top } })
      // First on its line: text starts at the column's edge. Its dot must be clipped; every other dot must show.
      const bad = items.filter(i => (Math.abs(i.textLeft - text) < 1.5) !== (i.dot < clip))
      // Every line of text inside an item starts at or right of the column edge (nothing clipped).
      const cut = [...row.querySelectorAll('.account-item')].flatMap(i => { const rg = document.createRange(); rg.selectNodeContents(i); return [...rg.getClientRects()].filter(r => r.width > 0 && r.left < text - 0.5) }).length
      // No "·" inside an item may end or start a line either: each must share its line with a word on both sides.
      const lonely = [...row.querySelectorAll('.account-item')].flatMap(i => { const w = document.createTreeWalker(i, NodeFilter.SHOW_TEXT); const out = []; let n
        while ((n = w.nextNode())) for (let k = n.data.indexOf('·'); k >= 0; k = n.data.indexOf('·', k + 1)) { const rg = document.createRange(); rg.setStart(n, k); rg.setEnd(n, k + 1); const d = rg.getBoundingClientRect()
          const lineRects = [...(() => { const r2 = document.createRange(); r2.selectNodeContents(i); return r2.getClientRects() })()].filter(r => r.width > 0 && Math.abs(r.top - d.top) < 4)
          const left = Math.min(...lineRects.map(r => r.left)), right = Math.max(...lineRects.map(r => r.right)); if (d.left - left < 4 || right - d.right < 4) out.push(n.data) }
        return out }).length
      const overflow = Math.max(...[...row.querySelectorAll('.account-item, .account-item *')].map(e => e.getBoundingClientRect().right)) - row.getBoundingClientRect().right
      return { lonely, cut, w: row.getBoundingClientRect().width, lines: new Set(items.map(i => Math.round(i.top))).size, bad: bad.length, firstAtEdge: Math.abs(items[0].textLeft - text) < 1.5, overflow: Math.round(overflow * 100) / 100 }
    })
  }, [widths, set])
  for (const r of res) ok(r.bad === 0 && r.lonely === 0 && r.cut === 0 && r.firstAtEdge && r.overflow <= 0.5, `${name} ${scheme} ${set} ${r.w}px: ${r.lines} lines (bad ${r.bad}, cut ${r.cut}, lonely ${r.lonely}), no dot at a line start, text on the column edge, overflow ${r.overflow}px`)
  await p.locator('#montage').screenshot({ path: `${out}/montage-${name}-${scheme}-${set}.png` })
  await b.close()
}
process.exitCode = fail ? 1 : 0
