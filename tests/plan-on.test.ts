// The command and the notice of "plan on a day" from the strip and the rows (docs/design/native-phase-1.md §12.5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planOnAction, planOnNotice } from '../src/components/plan-on.ts'

test('planOnAction keeps the web key order, with from last when given', () => {
  assert.equal(JSON.stringify(planOnAction('t', '2026-11-26', '2026-11-26')), '{"type":"plan-task","taskId":"t","date":"2026-11-26","today":"2026-11-26"}')
  assert.equal(JSON.stringify(planOnAction('t', '2026-11-26', '2026-11-26', '2026-11-25')), '{"type":"plan-task","taskId":"t","date":"2026-11-26","today":"2026-11-26","from":"2026-11-25"}')
})

test('planOnNotice says On today for today and Moved to a short day otherwise', () => {
  assert.equal(planOnNotice('2026-11-26', '2026-11-26'), 'On today')
  assert.equal(planOnNotice('2026-11-28', '2026-11-26'), 'Moved to Sat 11/28')
})
