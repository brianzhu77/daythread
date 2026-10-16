import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { LocalWorkspaceRepository } from '../src/server/local-repository.ts'

test('repository persists replay identity and rejects stale writes across independent processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daythread-review-'))
  const path = join(directory, 'workspace.json')
  try {
    const repository = new LocalWorkspaceRepository(path)
    const initial = await repository.load()
    assert.equal(initial.revision, 0)
    const command = { operationId: 'persist-once', expectedRevision: 0,
      action: { type: 'ensure-day' as const, date: '2026-10-16' } }
    const first = await repository.execute(command)
    const disk = await readFile(path, 'utf8')
    const replay = await repository.execute(command)
    assert.deepEqual(replay.workspace, first.workspace)
    assert.equal(await readFile(path, 'utf8'), disk)
    await assert.rejects(repository.execute({ operationId: 'stale', expectedRevision: 0,
      action: { type: 'ensure-day', date: '2026-10-17' } }))
    assert.equal(await readFile(path, 'utf8'), disk)
    // Each child has a fresh module cache and repository instance, not an in-memory reload.
    const moduleUrl = new URL('../src/server/local-repository.ts', import.meta.url).href
    const childSource = `import { LocalWorkspaceRepository } from ${JSON.stringify(moduleUrl)};
      const repository = new LocalWorkspaceRepository(process.argv[1]);
      const state = await repository.load();
      console.log(JSON.stringify(state));`
    for (let i = 0; i < 2; i++) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, path], { encoding: 'utf8' })
      assert.equal(child.status, 0, child.stderr)
      assert.deepEqual(JSON.parse(child.stdout), first.workspace)
    }
    await assert.rejects(repository.execute({ ...command, action: { type: 'ensure-day', date: '2026-10-18' } }))
    assert.equal(await readFile(path, 'utf8'), disk)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('repository serializes competing revisions and remains usable after rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'daythread-review-'))
  try {
    const repository = new LocalWorkspaceRepository(join(directory, 'workspace.json'))
    const results = await Promise.allSettled(['2026-10-16', '2026-10-17'].map((date, i) => repository.execute({
      operationId: `competing-${i}`, expectedRevision: 0, action: { type: 'ensure-day', date },
    })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(results.filter(r => r.status === 'rejected').length, 1)
    const state = await repository.load()
    assert.equal(state.pages.length, 1)
    await repository.execute({ operationId: 'after-rejection', expectedRevision: state.revision,
      action: { type: 'ensure-day', date: '2026-10-18' } })
    assert.equal((await repository.load()).pages.length, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
