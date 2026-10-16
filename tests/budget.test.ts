import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reserveBudget, settleBudget } from '../src/domain/budget.ts'

const day = '2026-10-16'
test('reserve before call and replay reserves only once', () => {
  const first = reserveBudget({ attempts: [] }, 'a', day, 3)
  assert.equal(first.attempts.length, 1)
  assert.equal(first.attempts[0].reserved, 3)
  assert.deepEqual(reserveBudget(first, 'a', day, 3), first)
})
test('another call cannot start while one is unresolved', () => {
  const ledger = reserveBudget({ attempts: [] }, 'a', day, 3)
  assert.throws(() => reserveBudget(ledger, 'b', day, 1))
})
test('unknown timeout retains reserved budget and blocks retry', () => {
  const ledger = settleBudget(reserveBudget({ attempts: [] }, 'a', day, 4), 'a', null)
  assert.equal(ledger.attempts[0].state, 'unknown')
  assert.equal(ledger.attempts[0].reserved, 4)
  assert.throws(() => reserveBudget(ledger, 'b', day, 1))
})
test('settled actual costs plus next bound cannot exceed ten dollars', () => {
  const ledger = settleBudget(reserveBudget({ attempts: [] }, 'a', day, 8), 'a', 7)
  assert.throws(() => reserveBudget(ledger, 'b', day, 3.01))
  assert.equal(reserveBudget(ledger, 'b', day, 3).attempts.length, 2)
})
test('settlement stays attributed to original day', () => {
  const ledger = settleBudget(reserveBudget({ attempts: [] }, 'a', day, 8), 'a', 7)
  assert.equal(ledger.attempts[0].day, day)
  assert.equal(reserveBudget(ledger, 'b', '2026-10-17', 10).attempts[1].day, '2026-10-17')
})
test('invalid upper bounds fail closed', () => {
  for (const bound of [NaN, Infinity, -1, 10.01]) {
    assert.throws(() => reserveBudget({ attempts: [] }, 'a', day, bound))
  }
})
