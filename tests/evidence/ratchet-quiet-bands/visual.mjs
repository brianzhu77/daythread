import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,390]]) {
  for(const scheme of ['light','dark']) {
    execFileSync(process.execPath,['tests/evidence/ratchet-quiet-bands/seed.ts']);
    const b=await engine.launch();
    const p=await b.newPage({viewport:{width,height:1000},colorScheme:scheme,timezoneId:'America/Vancouver',serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}:{})});
    await p.clock.install({time:new Date('2026-10-31T18:00:00Z')});
    await p.goto('http://127.0.0.1:3689/day/2026-10-31');
    await p.locator('[data-draft-item=line]').waitFor();
    await p.evaluate(()=>document.activeElement?.blur());
    await p.mouse.move(1,1);
    await p.waitForTimeout(300);
    const state=await p.evaluate(()=>{
      const style=(s,pseudo)=>getComputedStyle(document.querySelector(s),pseudo);
      const base='[data-draft-item=new]';
      return {fill:style(base).backgroundColor,shadow:style(base).boxShadow,ink:style(base).color,normal:style('[data-id=notes] .bn-inline-content').color,box:style(`${base} .draft-box`).borderTopStyle,dot:style('[data-draft-item=bullet]','::before').borderTopStyle,line:style('[data-draft-item=line] .draft-text').textDecorationStyle,opacity:style(`${base} .draft-acts`).opacity};
    });
    assert.equal(state.fill,'rgba(0, 0, 0, 0)');
    assert.equal(state.shadow,'none');
    assert.notEqual(state.ink,state.normal);
    assert.deepEqual([state.box,state.dot,state.line],['dashed','dashed','dashed']);
    assert.equal(state.opacity,width===390?'1':'0');
    if(width===1280) {
      await p.locator('[data-draft-item=new]').hover();
      await p.waitForTimeout(250);
      assert.equal(await p.locator('[data-draft-item=new] .draft-acts').evaluate(e=>getComputedStyle(e).opacity),'1');
      await p.mouse.move(1,1);
      await p.locator('[data-draft-item=new] button[title=Apply]').focus();
      await p.waitForTimeout(250);
      assert.equal(await p.locator('[data-draft-item=new] .draft-acts').evaluate(e=>getComputedStyle(e).opacity),'1');
      await p.evaluate(()=>document.activeElement.blur());
      await p.waitForTimeout(250);
    }
    await p.screenshot({path:`tests/evidence/ratchet-quiet-bands/${name}-${scheme}.png`});
    await p.getByRole('button',{name:'Apply all',exact:true}).click();
    await p.waitForTimeout(600);
    assert.equal(await p.locator('.draft-band:not(.is-open-row)').count(),0);
    const applied=await p.locator('.bn-editor').innerText();
    for(const words of ['Original suggestion','10:30 Dentist','Proposed line'])assert.ok(applied.includes(words));
    assert.equal(await p.locator('.editor-task-title').filter({hasText:'Original suggestion'}).evaluate(e=>getComputedStyle(e).color),state.normal);
    assert.equal(await p.locator('.bn-editor .bn-inline-content').filter({hasText:'Proposed line'}).evaluate(e=>getComputedStyle(e).textDecorationStyle),'solid');
    await p.screenshot({path:`tests/evidence/ratchet-quiet-bands/${name}-${scheme}-applied.png`});
    console.log('PASS',name,scheme,JSON.stringify(state),'all three applied types return to ordinary rows');
    await b.close();
  }
}
