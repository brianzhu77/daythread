import assert from 'node:assert/strict';
import * as pw from '@playwright/test';
const base=process.argv[2];
for(const engine of ['chromium','webkit']){
 const b=await pw[engine].launch();
 try{
  const p=await b.newPage();
  await p.addInitScript(()=>{window.positions=[];navigator.geolocation.getCurrentPosition=cb=>{window.positions.push(cb)}});
  await p.goto(`${base}/pages?page=eats`);
  const cell=id=>p.locator(`[data-cell*="|${id}|pl"]`).first();
  const f=()=>p.getByRole('textbox',{name:'Search Where'});
  const edit=async id=>{const c=cell(id);await c.waitFor();const r=await c.boundingBox();await p.mouse.click(r.x+r.width-10,r.y+r.height/2);await f().waitFor()};
  const geo=()=>p.getByRole('option').filter({hasText:'Use current location'});
  await edit('e3');await f().fill('x'.repeat(10001));assert.equal((await f().inputValue()).length,10000);
  await p.getByRole('option').filter({hasText:'Keep “'}).click();await f().waitFor({state:'hidden'});
  assert.equal((await cell('e3').innerText()).trim().length,10000);
  console.log(engine,'PASS field bound and Keep saves 10000');
  await edit('e4');await geo().click();assert.match(await geo().innerText(),/Finding your location/);
  await f().fill('京');assert.match(await geo().innerText(),/Saved as “京”/);
  await p.evaluate(()=>window.positions[0]({coords:{latitude:10,longitude:20}}));
  assert(await f().isVisible());assert.equal(await f().inputValue(),'京');
  console.log(engine,'PASS typing clears location wait and late callback cannot save');
  await f().fill('zzz-no-match');await p.getByText('No places for “zzz-no-match”').waitFor();
  assert(await p.locator('.property-empty').evaluate(e=>!!(e.compareDocumentPosition([...e.parentElement.querySelectorAll('[role=option]')].find(x=>x.textContent.startsWith('Keep'))) & Node.DOCUMENT_POSITION_FOLLOWING)));
  console.log(engine,'PASS state line precedes Keep');
 }finally{await b.close()}
}
