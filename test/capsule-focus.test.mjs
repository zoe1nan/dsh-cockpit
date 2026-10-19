/**
 * Regression tests for the desktop capsule's focus rule.
 *
 * The HUD is global to the machine, while every DSH conversation is its own
 * session. It used to follow the deck's team conversation, so the capsule sat on
 * 待命 while the user worked any other conversation. These tests pin the fix:
 * a running conversation always takes the capsule over, the team view only stays
 * in focus while nothing is running.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { __internals } from '../index.js'

const { Tracker, pickCapsuleSession, capsuleView } = __internals

function view(id, overrides = {}) {
  return {
    id,
    title: id,
    running: false,
    turn: null,
    startedAt: 0,
    lastAt: 0,
    lastUserAt: 0,
    current: '',
    model: null,
    steps: [],
    completed: 0,
    total: 0,
    percent: null,
    stats: {},
    team: null,
    ...overrides,
  }
}

/** The deck's old team-biased choice: it stays on the cockpit conversation. */
const team = view('session-cockpit', {
  title: 'cockpit for dsh',
  lastAt: 5_000,
  team: {
    members: [
      { id: 'session-cockpit', role: 'lead' },
      { id: 'agent-ui', role: 'teammate' },
    ],
  },
})

const chat = view('session-chat', {
  title: '修复 HUD 多对话状态同步',
  running: true,
  lastAt: 1_000,
  lastUserAt: 9_000,
})

const conversationIds = new Set(['session-cockpit', 'session-chat'])

test('a running conversation wins over the deck’s idle team session', () => {
  const focus = pickCapsuleSession([team, chat], conversationIds, team)
  assert.equal(focus.id, 'session-chat')
})

test('nothing running keeps the deck’s active session in focus', () => {
  const idleChat = view('session-chat', { lastAt: 2_000, lastUserAt: 9_000 })
  const focus = pickCapsuleSession([team, idleChat], conversationIds, team)
  assert.equal(focus.id, 'session-cockpit')
})

test('the conversation the user typed in last wins between running ones', () => {
  const a = view('session-a', { running: true, lastAt: 9_000, lastUserAt: 1_000 })
  const b = view('session-b', { running: true, lastAt: 2_000, lastUserAt: 8_000 })
  const focus = pickCapsuleSession([a, b], new Set(['session-a', 'session-b']), null)
  assert.equal(focus.id, 'session-b')
})

test('without user messages the newest event breaks the tie', () => {
  const a = view('session-a', { running: true, lastAt: 2_000 })
  const b = view('session-b', { running: true, lastAt: 7_000 })
  const focus = pickCapsuleSession([a, b], new Set(['session-a', 'session-b']), null)
  assert.equal(focus.id, 'session-b')
})

test('teammate agent sessions never take the capsule over', () => {
  const teammate = view('agent-ui', { running: true, lastAt: 9_000 })
  const focus = pickCapsuleSession([team, teammate], conversationIds, team)
  assert.equal(focus.id, 'session-cockpit')
})

test('no sessions at all yields no focus', () => {
  assert.equal(pickCapsuleSession([], new Set(), null), null)
})

test('the overlay frame follows the capsule session, not the deck session', () => {
  const state = {
    now: 1_234,
    session: { id: 'session-cockpit', title: 'cockpit for dsh', running: false, plan: { steps: [] }, completed: 0, total: 0, percent: null },
    capsule: { id: 'session-chat', title: '修复 HUD 多对话状态同步', running: true, plan: { steps: [] }, completed: 0, total: 0, percent: null },
  }
  const frame = capsuleView(state)
  assert.equal(frame.active.sessionId, 'session-chat')
  assert.equal(frame.active.status, 'noplan')
  assert.equal(frame.active.running, true)
  assert.equal(frame.active.lastAt, 1_234)
})

test('the frame falls back to the deck session when no capsule focus exists', () => {
  const state = {
    now: 1_234,
    session: { id: 'session-cockpit', title: 'cockpit for dsh', running: false, plan: { steps: [] }, completed: 0, total: 0, percent: null },
  }
  assert.equal(capsuleView(state).active.sessionId, 'session-cockpit')
  assert.equal(capsuleView({ now: 1_234, session: null }).active, null)
})

test('a running conversation with a plan reports charging progress', () => {
  const frame = capsuleView({
    now: 5_000,
    session: null,
    capsule: {
      id: 'session-chat',
      title: '修复 HUD 多对话状态同步',
      running: true,
      plan: {
        steps: [
          { text: '定位 HUD 待命原因', status: 'completed' },
          { text: '修正胶囊焦点规则', status: 'in_progress' },
        ],
      },
      completed: 1,
      total: 2,
      percent: 50,
      elapsedMs: 42_000,
    },
  })
  assert.equal(frame.active.status, 'charging')
  assert.equal(frame.active.currentStep, '修正胶囊焦点规则')
  assert.equal(frame.active.percent, 50)
  assert.equal(frame.active.elapsedMs, 42_000)
})

test('the tracker remembers when the user last typed in a session', () => {
  const tracker = new Tracker()
  const session = { id: 'session-chat' }
  tracker.feed(session, { type: 'turn/start', time: 1_000 })
  tracker.feed(session, { type: 'assistant/message', time: 2_000, data: { content: 'working' } })
  assert.equal(tracker.state('session-chat').lastUserAt, 0, 'only user messages count')
  tracker.feed(session, { type: 'user/message', time: 3_000 })
  assert.equal(tracker.state('session-chat').lastUserAt, 3_000)
  tracker.feed(session, { type: 'tool/call', time: 4_000, data: { name: 'read', arguments: {} } })
  assert.equal(tracker.state('session-chat').lastUserAt, 3_000, 'later events must not move it')
  tracker.feed(session, { type: 'user/message', time: 2_500 })
  assert.equal(tracker.state('session-chat').lastUserAt, 3_000, 'out-of-order events must not rewind it')
})
