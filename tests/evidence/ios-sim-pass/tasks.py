import os,sys,time,re,json,subprocess; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sim.py')).read().split('# 1.')[0])
reseed(); web(); js("location.href=arguments[0]", [f'http://127.0.0.1:{PORT}/tasks?view=open']); time.sleep(5); clear()
def plan(title):
    out = subprocess.run(['node','--no-warnings','-e',f"const {{SqliteWorkspaceRepository:R}}=await import('{REPO}/src/server/sqlite-repository.ts'); const {{plannedOn}}=await import('{REPO}/src/domain/workspace.ts'); const w=await new R('{STORE}').load(); console.log(plannedOn(w, w.tasks.find(t=>t.title==='{title}').id))"], capture_output=True, text=True, cwd=REPO, env={**os.environ}).stdout.strip().split('\n')[-1]
    return out
print('before', plan('Umbrella'))
def wtap(sel):
    # standalone: the web view fills the screen from (0, 0), so page CSS px are screen points
    r = rect(sel); assert r, sel; ctx('NATIVE_APP'); mobile('tap', {'x': r['x'] + r['w'] / 2, 'y': r['y'] + r['h'] / 2})
wtap('[aria-label="Actions for Umbrella"]'); time.sleep(1.2)
web(); i = js("return [...document.querySelectorAll('[role=menuitem]')].findIndex(e=>e.innerText.trim().startsWith('Pick date'))"); r = js("const e=document.querySelectorAll('[role=menuitem]')[arguments[0]]; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}", [i]); ctx('NATIVE_APP'); mobile('tap', {'x': r['x'] + r['w'] / 2, 'y': r['y'] + r['h'] / 2}); time.sleep(2.5); snap('tasks-picker')
ctx('NATIVE_APP'); ok('XCUIElementTypeDatePicker' in call('source')['value'], 'Tasks Pick date… opens the calendar')
after = plan('Umbrella'); ok(after == '2026-11-15', f"nothing planned for him on opening (still {after})")
ntap("type == 'XCUIElementTypeButton' AND label CONTAINS 'November 18'"); time.sleep(2.5)
ok(plan('Umbrella') == '2026-11-18', f"the earliest day (today, Wed 18) can be picked ({plan('Umbrella')})")
print('DONE', fails)
