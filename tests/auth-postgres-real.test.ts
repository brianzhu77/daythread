import { test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { postgresClient } from '../src/server/db/sql.ts'
import { SessionStore, freeFailures } from '../src/server/auth/sessions.ts'

// The sign-in brake across instances (Ratchet e4da96ff): separate connection pools stand in for separate Vercel
// instances. Skipped unless DATABASE_TEST_URL points at a disposable database (its `daythread_test_*` schemas are dropped).
const url = process.env.DATABASE_TEST_URL
const skip = url ? false : 'DATABASE_TEST_URL not set'

test('brake: 20 simultaneous tries from 4 instances: only the free ones reach Supabase', { skip }, async () => {
  const schema = `daythread_test_brake_${process.pid}`
  const pools = Array.from({ length: 4 }, () => postgres(url!, { prepare: false, max: 3, onnotice: () => {} }))
  try {
    const stores = pools.map(sql => new SessionStore(postgresClient(sql), schema))
    let calls = 0
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      stores[i % stores.length]!.attempt(async () => { calls++; await new Promise(r => setTimeout(r, 20)); return false })))
    assert.equal(calls, freeFailures, 'no two tries read the same old count')
    assert.equal(results.filter(r => r.waitMs > 0).length, 20 - freeFailures)
    const [row] = await pools[0]!.unsafe(`select count(*)::int as n from ${schema}.sign_in_failures`)
    assert.equal(row!.n, freeFailures, 'refused tries recorded nothing')
  } finally {
    try { await pools[0]!.unsafe(`drop schema if exists ${schema} cascade`) }
    finally { await Promise.all(pools.map(p => p.end({ timeout: 1 }))) }
  }
})
