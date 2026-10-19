/**
 * Tests for the v1.1 write-cadence helpers and the diagnostics card.
 *
 * The host used to rewrite `hud.json` / `capsule/state.json` on every timer
 * tick because their frames carry a timestamp. Those frames are now compared
 * without the volatile `at` / `lastAt` keys, so an idle desktop stops paying
 * for JSON serialisation, atomic renames and overlay repaints. `formatAge` and
 * `formatSpan` feed the settings diagnostics card and its copyable report.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { __internals } from '../index.js'

const { signatureWithout, formatAge, formatSpan } = __internals

test('signatureWithout ignores the volatile timestamp', () => {
  const first = { v: 1, at: 100, active: { sessionId: 'session-1', status: 'noplan' } }
  const second = { v: 1, at: 999, active: { sessionId: 'session-1', status: 'noplan' } }
  assert.equal(signatureWithout(first, ['at']), signatureWithout(second, ['at']))
  assert.equal(signatureWithout(first, ['at']), JSON.stringify({ v: 1, active: first.active }))
})

test('signatureWithout keeps real changes visible', () => {
  const idle = { v: 1, at: 100, active: { sessionId: 'session-1', status: 'noplan', running: false } }
  const busy = { v: 1, at: 100, active: { sessionId: 'session-1', status: 'charging', running: true } }
  assert.notEqual(signatureWithout(idle, ['at']), signatureWithout(busy, ['at']))
})

test('signatureWithout drops every listed key', () => {
  const frame = { v: 1, at: 100, lastAt: 500, active: { sessionId: 'session-1' } }
  const signature = signatureWithout(frame, ['at', 'lastAt'])
  assert.equal(signature, JSON.stringify({ v: 1, active: frame.active }))
  assert.equal(signature, signatureWithout({ v: 1, at: 900, lastAt: 900, active: frame.active }, ['at', 'lastAt']))
})

test('signatureWithout supports one nested path', () => {
  const first = { v: 1, active: { sessionId: 'session-1', running: false, lastAt: 100 } }
  const second = { v: 1, active: { sessionId: 'session-1', running: false, lastAt: 900 } }
  assert.equal(signatureWithout(first, ['active.lastAt']), signatureWithout(second, ['active.lastAt']))
  assert.equal(
    signatureWithout(first, ['active.lastAt']),
    JSON.stringify({ v: 1, active: { sessionId: 'session-1', running: false } }),
  )
  const busy = { v: 1, active: { sessionId: 'session-1', running: true, lastAt: 900 } }
  assert.notEqual(signatureWithout(busy, ['active.lastAt']), signatureWithout(second, ['active.lastAt']))
  // Idle frame from the host: only the nested clock and top-level write clock move.
  const idle = { v: 1, at: 1, active: { sessionId: 'session-2', title: null, status: 'noplan', steps: [], lastAt: 1 } }
  const later = { v: 1, at: 2, active: { ...idle.active, lastAt: 2 } }
  assert.equal(signatureWithout(idle, ['at', 'active.lastAt']), signatureWithout(later, ['at', 'active.lastAt']))
})

test('signatureWithout ignores a missing or scalar parent', () => {
  assert.equal(signatureWithout({ v: 1 }, ['active.lastAt']), JSON.stringify({ v: 1 }))
  assert.equal(signatureWithout({ v: 1, active: null }, ['active.lastAt']), JSON.stringify({ v: 1, active: null }))
  assert.equal(signatureWithout({ v: 1, active: 'x' }, ['active.lastAt']), JSON.stringify({ v: 1, active: 'x' }))
})

test('signatureWithout tolerates empty values', () => {
  assert.equal(signatureWithout(null, ['at']), '{}')
  assert.equal(signatureWithout(undefined, ['at']), '{}')
  assert.equal(signatureWithout({ at: 1 }, ['at']), '{}')
})

test('formatAge renders human ages', () => {
  const cases = [
    [Number.NaN, '—'],
    [-1, '—'],
    [0, '刚刚'],
    [999, '刚刚'],
    [1_000, '1s 前'],
    [59_400, '59s 前'],
    [60_000, '1 分钟前'],
    [3_600_000, '1 小时前'],
    [169_200_000, '47 小时前'], // just under two days
    [176_400_000, '2 天前'],
  ]
  for (const [ms, expected] of cases) {
    assert.equal(formatAge(ms), expected, `formatAge(${ms})`)
  }
})

test('formatSpan renders compact spans', () => {
  const cases = [
    [Number.NaN, '—'],
    [0, '—'],
    [-5, '—'],
    [1_500, '2s'],
    [61_000, '1m 1s'],
    [3_725_000, '1h 2m'],
  ]
  for (const [ms, expected] of cases) {
    assert.equal(formatSpan(ms), expected, `formatSpan(${ms})`)
  }
})
