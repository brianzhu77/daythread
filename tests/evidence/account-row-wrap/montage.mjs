import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const widths = [150, 170, 194, 220, 240, 260, 300]
for (const [name, br] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await br.launch(); const p = await b.newPage({ viewport: { width: 1800, height: 900 } })
  await p.goto('http://127.0.0.1:3656/'); await p.waitForSelector('.account-row-sidebar p'); await p.waitForTimeout(600)
  await p.evaluate(widths => {
    const src = document.querySelector('.account-row-sidebar')
    const item = h => `<span class="account-item"><span>${h}</span><span class="account-sep" aria-hidden="true"> ·</span></span> `
    const html = ['brian.zhu77@gmail.com', '<select class="account-zone"><option>America/Vancouver</option></select>', '<button type="button" class="link">Templates</button>', '<button type="button" class="link">Export</button>',
      '<span class="reminders"><span class="account-text">Reminders on · </span><button type="button" class="link">Turn off</button></span>',
      '<span class="home-screen-hint"><span class="account-text">Add to Home Screen for the full-screen app: Share, then “Add to Home Screen” · </span><button type="button" class="link">Got it</button></span>',
      '<button type="button" class="link">Sign out</button>', '<button type="button" class="link">Delete account</button>'].map(item).join('')
    const box = document.createElement('div'); box.id = 'montage'; box.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;gap:16px;align-items:flex-start;padding:16px'
    for (const w of widths) { const c = src.cloneNode(true); c.style.cssText = `width:${w}px;flex:none;outline:1px dashed #c33;padding:0`; c.querySelector('p').innerHTML = html; const l = document.createElement('div'); l.textContent = w + 'px'; l.style.cssText = 'font-size:11px;color:#c33'; const wrap = document.createElement('div'); wrap.append(l, c); box.append(wrap) }
    document.body.append(box)
  }, widths)
  await p.waitForTimeout(300); await p.locator('#montage').screenshot({ path: `/tmp/jazz-acct-run/montage-${name}.png` })
  await b.close()
}
