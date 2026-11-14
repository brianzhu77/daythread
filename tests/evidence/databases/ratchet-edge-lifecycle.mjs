// Independent observer/lifecycle probe. Local dashboard seed, no production access.
import * as pw from '@playwright/test'
const [base, engine = 'webkit'] = process.argv.slice(2)
const browser = await pw[engine].launch()
try {
 const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'})
 await page.addInitScript(() => {
   const Native = window.ResizeObserver, active = new Map()
   window.ResizeObserver = class extends Native {
     observe(el, opts) { let set = active.get(this); if (!set) active.set(this,set=new Set()); set.add(el); return super.observe(el,opts) }
     unobserve(el) {active.get(this)?.delete(el); return super.unobserve(el)}
     disconnect() {active.delete(this); return super.disconnect()}
   }
   window.edgeObservers = () => [...active.values()].flatMap(set=>[...set]).filter(el=>el.matches('.database-scroll,.database-table')).map(el=>({connected:el.isConnected,tag:el.tagName}))
 })
 await page.goto(`${base}/pages?page=runs`)
 await page.locator('.database-scroll').first().waitFor({timeout:20000})
 await page.waitForTimeout(800)
 const check = async expected => {
  await page.waitForTimeout(150)
  const state = await page.locator('.database-scroll').first().evaluate(el=>({more:el.classList.contains('has-more-right'),left:el.scrollLeft,room:el.scrollWidth-el.clientWidth}))
  if (state.more !== expected) throw Error(JSON.stringify(state))
 }
 await check(false)
 // Change only content width: no window resize, no scroll event.
 await page.locator('.database-table').first().evaluate(el=>{el.dataset.originalWidth=el.style.width;el.style.width='2400px'})
 await check(true)
 await page.locator('.database-scroll').first().evaluate(el=>el.scrollLeft=el.scrollWidth)
 await check(false)
 await page.locator('.database-table').first().evaluate(el=>el.style.width=el.dataset.originalWidth)
 await check(false)
 // A client-side route change unmounts the first table. Detached observed tables would leak.
 for (const name of ['Home','Runs','Home','Runs']) {
   const link = page.getByRole('link',{name,exact:true}).first()
   if (!await link.count()) throw Error(`Missing navigation link ${name}`)
   await link.click(); await page.waitForTimeout(500)
   const observers = await page.evaluate(()=>window.edgeObservers())
   if (observers.some(x=>!x.connected)) throw Error(`Detached table retained: ${JSON.stringify(observers)}`)
 }
 console.log(`PASS ${engine}: content-only grow/shrink at end; repeated route unmounts retain no detached observed tables`)
} finally {await browser.close()}
