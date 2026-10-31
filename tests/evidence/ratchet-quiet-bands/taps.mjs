import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
for (const [name, engine, width] of [['chromium', chromium, 1280], ['webkit', webkit, 390]]) {
  for (const action of ['apply', 'skip', 'all', 'more', 'edit']) {
    execFileSync(process.execPath, ['tests/evidence/ratchet-quiet-bands/seed.ts']);
    const browser = await engine.launch();
    const p = await browser.newPage({viewport:{width,height:900}, timezoneId:'America/Vancouver', serviceWorkers:'block', ...(width===390?{isMobile:true,hasTouch:true}:{})});
    await p.clock.install({time:new Date('2026-10-31T18:00:00Z')});
    await p.goto('http://127.0.0.1:3689/day/2026-10-31');
    await p.locator('[data-draft-item=new]').waitFor();
    await p.waitForTimeout(400);
    const tap = async loc => {await p.evaluate(()=>document.activeElement?.blur()); if(width===390)await loc.tap();else await loc.click();await p.waitForTimeout(700);};
    const unfocused = async label => assert.equal(await p.evaluate(()=>!!document.activeElement?.closest('.continuous-editor')), false, `${name} ${label} must not focus editor`);
    if(action==='apply') {
      await tap(p.locator('[data-draft-item=new] button[title=Apply]'));
      await unfocused('real Apply');
      assert.ok((await p.locator('.editor-task-title').allTextContents()).includes('Original suggestion'));
    } else if(action==='skip') {
      await tap(p.locator('[data-draft-item=new] button[title=Skip]'));
      await unfocused('real Skip');
      assert.equal(await p.locator('[data-draft-item=new]').count(),0);
    } else if(action==='all') {
      await tap(p.getByRole('button',{name:'Apply all',exact:true}));
      await unfocused('real Apply all');
      assert.ok((await p.locator('.editor-task-title').allTextContents()).includes('Existing carry'));
    } else if(action==='more') {
      const more=await p.locator('.draft-more-toggle').boundingBox();
      const line=await p.locator('.bn-block-outer[data-id=drop-line]').boundingBox();
      const divider=await p.locator('.bn-block-outer[data-id=divider]').boundingBox();
      assert.ok(more.y >= line.y+line.height-1 && more.y+more.height <= divider.y+1,'paragraph and - line: more open before divider');
      await tap(p.locator('.draft-more-toggle'));
      await unfocused('real more-open toggle');
      await tap(p.locator('.draft-more .is-open-row button').first());
      await unfocused('real plus');
      assert.ok((await p.locator('.editor-task-title').allTextContents()).includes('Extra task'));
      await p.screenshot({path:`tests/evidence/ratchet-quiet-bands/${name}.png`});
    } else {
      const field=p.locator('[data-draft-item=new] .draft-text');
      await tap(field);
      assert.ok(await p.evaluate(()=>document.activeElement?.closest('[data-draft-item=new]')),'new suggestion accepts focus');
      await p.keyboard.type(' EDITED');
      await tap(p.getByRole('button',{name:'Apply all',exact:true}));
      await unfocused('Apply all after editing');
      assert.ok((await p.locator('.editor-task-title').allTextContents()).some(t=>t.includes('EDITED')),'actual applied task keeps edited words');
    }
    console.log('PASS',name,action);
    await browser.close();
  }
}
