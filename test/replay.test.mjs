// v1.2.1 (D6): startup replay relies on the Tracker folding a tail of events in
// order. These tests pin the two properties that matter: a tail restores an
// in-flight turn, and a tail without a turn boundary never marks a conversation
// as running (the "ghost running" failure mode).
import assert from 'node:assert/strict'
import test from 'node:test'
import { __internals } from '../index.js'

const { Tracker } = __internals

const session = { id: 'sess-replay' }

function feedAll(tracker, events) {
  for (const event of events) tracker.feed(session, event)
  return tracker.state(session.id)
}

test('a replay tail without a turn boundary keeps the conversation idle', () => {
  const tracker = new Tracker()
  const state = feedAll(tracker, [
    { type: 'tool/call', time: 1000, data: { name: 'ops_bash', callId: 'c1', arguments: { command: 'npm test' } } },
    { type: 'assistant/message', time: 1100, data: { text: 'running the tests' } },
  ])
  assert.equal(state.running, false)
  assert.equal(state.lastAt, 1100)
})

test('a replay tail with turn/start restores the in-flight turn', () => {
  const tracker = new Tracker()
  const state = feedAll(tracker, [
    { type: 'turn/start', time: 1000, data: { turn: 7 } },
    { type: 'tool/call', time: 1100, data: { name: 'ops_bash', callId: 'c2', arguments: { command: 'npm test' } } },
  ])
  assert.equal(state.running, true)
  assert.equal(state.turn, 7)
  assert.equal(state.startedAt, 1000)
  assert.equal(state.lastAt, 1100)
  assert.match(state.current, /运行命令/)
})

test('a paired turn/end in the tail clears the turn again', () => {
  const tracker = new Tracker()
  const state = feedAll(tracker, [
    { type: 'turn/start', time: 1000, data: { turn: 3 } },
    { type: 'tool/call', time: 1100, data: { name: 'ops_edit' } },
    { type: 'turn/end', time: 1200, data: { reason: 'completed' } },
  ])
  assert.equal(state.running, false)
  assert.equal(state.current, '本轮完成')
  assert.equal(state.lastAt, 1200)
})

test('replaying a user message restores lastUserAt for HUD focus', () => {
  const tracker = new Tracker()
  const state = feedAll(tracker, [
    { type: 'user/message', time: 900, data: { text: 'hi' } },
    { type: 'tool/call', time: 1000, data: { name: 'ops_search' } },
  ])
  assert.equal(state.running, false)
  assert.equal(state.lastUserAt, 900)
})
