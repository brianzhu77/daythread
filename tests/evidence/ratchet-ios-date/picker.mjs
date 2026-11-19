import{chromium,webkit}from'@playwright/test';let fails=0;const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c)fails++};
for(const[name,e]of Object.entries({chromium,webkit})){
const b=await e.launch(),p=await b.newPage();await p.goto('http://127.0.0.1:43963/');await p.locator('.draft-band').first().waitFor();await p.evaluate(async()=>{window.pick=(await import('/src/components/row-actions.tsx')).pickDate;window.picks=[];const b=document.createElement('button');b.id='review-picker';b.textContent='Review picker';b.onclick=()=>window.pick('2026-12-01',v=>window.picks.push(v));document.body.prepend(b);});
const open=async()=>{await p.evaluate(()=>window.picks=[]);await p.locator('#review-picker').click();await p.keyboard.press('Escape');};
await open();const props=await p.locator('input[type=date]').evaluate(el=>({min:el.min,value:el.value}));ok(props.min==='2026-12-01'&&props.value==='2026-11-30'&&(await p.evaluate(()=>window.picks.length))===0,`${name} opening month boundary ${JSON.stringify(props)} causes no callback`);
await p.locator('input[type=date]').fill('2026-12-01',{force:true});await p.waitForTimeout(100);ok(JSON.stringify(await p.evaluate(()=>window.picks))==='["2026-12-01"]',`${name} earliest date is accepted once`);
await open();await p.locator('input[type=date]').evaluate(el=>{el.value='2026-11-29';el.dispatchEvent(new Event('change',{bubbles:true}))});ok((await p.evaluate(()=>window.picks.length))===0,`${name} below-min value refused`);
await open();await p.locator('input[type=date]').evaluate(el=>el.blur());await p.waitForTimeout(650);ok((await p.evaluate(()=>window.picks.length))===0&&await p.locator('input[type=date]').count()===0,`${name} blur/cancel removes input without callback`);await b.close();}
process.exitCode=fails?1:0;
