import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelAllowed } from '../src/server/model/access.ts'

test('model access: with sign-in off, this machine has the model whatever the list says', () => {
  assert.equal(modelAllowed(false, null, undefined), true)
  assert.equal(modelAllowed(false, null, 'someone@example.com'), true)
})

test('model access: with sign-in on, only a listed email has it, compared without case or spaces', () => {
  const list = ' Owner@Example.com , second@example.com,'
  assert.equal(modelAllowed(true, { email: 'owner@example.com' }, list), true)
  assert.equal(modelAllowed(true, { email: 'SECOND@example.com' }, list), true)
  assert.equal(modelAllowed(true, { email: 'guest@example.com' }, list), false)
  assert.equal(modelAllowed(true, { email: 'owner@example.com' }, undefined), false)
  assert.equal(modelAllowed(true, { email: 'owner@example.com' }, ''), false)
})

test('model access: with sign-in on and no account read (a cookie the lookup could not match), nobody has it', () => {
  assert.equal(modelAllowed(true, null, 'owner@example.com'), false)
  assert.equal(modelAllowed(true, null, undefined), false)
})
