/**
 * Preview server for the cockpit UI.
 *
 * Serves `public/` at http://127.0.0.1:6077/cockpit with the demo snapshot from
 * `public/mock-state.json`, a live SSE feed (elapsed clock keeps moving so the
 * layout can be judged while running), and an in-memory alias API so inline
 * renaming can be exercised without a DSH host.
 *
 *   node scripts/preview.mjs [port]
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PUBLIC = join(ROOT, 'public')
const MOCK_FILE = join(ROOT, 'mock', 'state.json')
const PORT = Number(process.argv[2] || 6077)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const mock = JSON.parse(readFileSync(MOCK_FILE, 'utf8'))

// Dev-only remote access mock: enough to build and screenshot the pairing UI.
const remoteState = {
  running: false,
  url: null,
  port: null,
  pair: null,
  sessions: [
    { id: 'demo-iphone', label: 'iPhone', createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now() - 90_000 },
    { id: 'demo-android', label: 'Android', createdAt: Date.now() - 3_600_000, lastSeenAt: Date.now() - 300_000 },
  ],
  publicUrl: null,
}
function remoteSnapshot() {
  const lanUrl = remoteState.running ? remoteState.url : null
  return {
    ok: true,
    enabled: true,
    running: remoteState.running,
    url: lanUrl,
    publicUrl: remoteState.publicUrl,
    secure: /^https:\/\//.test(String(remoteState.publicUrl ?? '')),
    urlForPhone: remoteState.publicUrl ?? lanUrl,
    port: remoteState.running ? remoteState.port : null,
    pair: remoteState.pair !== null && remoteState.pair.expiresAt > Date.now() ? remoteState.pair : null,
    sessions: remoteState.sessions,
  }
}
function normalizePublicUrlPreview(raw) {
  const value = String(raw ?? '').trim()
  if (value === '') return { ok: true, value: null }
  let parsed = null
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: '请填写完整的 https:// 地址' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { ok: false, error: '只支持 http:// 或 https:// 地址' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, error: '地址里不能带账号密码' }
  if (parsed.pathname !== '/' && parsed.pathname !== '') return { ok: false, error: '只填域名和端口，不要带路径' }
  if (parsed.search !== '' || parsed.hash !== '') return { ok: false, error: '只填域名和端口，不要带参数' }
  return { ok: true, value: parsed.origin }
}
const tunnelMock = () => ({
  ok: true,
  running: remoteState.running,
  lanUrl: remoteState.running ? remoteState.url : null,
  tools: [
    { id: 'cloudflared', label: 'Cloudflare Tunnel', available: true, path: 'C:\\Tools\\cloudflared.exe' },
    { id: 'tailscale', label: 'Tailscale', available: false, path: null },
  ],
  commands: [
    {
      id: 'cloudflared',
      label: '临时 HTTPS 隧道（无需账号）',
      command: `cloudflared tunnel --url http://127.0.0.1:${remoteState.port ?? 6688}`,
      note: '运行后把输出的 https://xxx.trycloudflare.com 填入公网地址；关掉窗口隧道即断开。',
    },
    {
      id: 'tailscale',
      label: 'Tailscale 私有网（手机登录同一账号）',
      command: `tailscale serve --bg ${remoteState.port ?? 6688}`,
      note: '手机和电脑登录同一 Tailnet，然后用 https://<机器名>.<tailnet>.ts.net 访问；只在你自己的设备间可达。',
    },
  ],
})
function newPair() {
  remoteState.pair = { code: String(100000 + Math.floor(Math.random() * 900000)), expiresAt: Date.now() + 120_000 }
}
// The demo snapshot was written once; shift every timestamp so relative labels
// ("3 秒前") stay meaningful no matter when the preview is opened.
const mockAge = Date.now() - (Number(mock.now) || Date.now())
/** Members are addressed by agent id; map that to a demo session id. */
function demoSessionId(id) {
  if (mock.session?.id === id) return id
  if ((mock.sessions ?? []).some((entry) => entry.id === id)) return id
  const member = (mock.team?.members ?? []).find((entry) => entry.id === id)
  return member?.sessionId ?? id
}

/** Flip the running flag everywhere the demo state mirrors it. */
function setRunning(sessionId, running) {
  if (mock.session?.id === sessionId) mock.session.running = running
  for (const session of mock.sessions ?? []) if (session.id === sessionId) session.running = running
  for (const member of mock.team?.members ?? []) {
    if (member.id === sessionId) member.status = running ? 'running' : 'idle'
  }
}

function shiftTimes(state) {
  const bump = (value) => (typeof value === 'number' && value > 0 ? value + mockAge : value)
  if (state.session) state.session.startedAt = bump(state.session.startedAt)
  for (const key of ['activity', 'sessions']) for (const row of state[key] ?? []) row.at = bump(row.at)
  for (const member of state.team?.members ?? []) member.lastAt = bump(member.lastAt)
  for (const session of state.sessions ?? []) {
    session.lastAt = bump(session.lastAt)
    session.live = true
  }
  return state
}
const aliases = { ...(mock.aliases ?? {}) }
// Built-in capsule (v0.8): the demo host pretends a WPF overlay is running.
let capsule = {
  supported: true,
  enabled: true,
  running: true,
  pid: 4242,
  startedAt: Date.now() - 10 * 60_000,
  statePath: '~/.dsh/cockpit/capsule/state.json',
  bridgePath: '~/.dsh/cockpit/hud.json',
  scriptPath: 'capsule/overlay.ps1',
  writtenAt: Date.now() - 2_000,
  heartbeatAt: Date.now() - 1_000,
  writes: 128,
  legacyDetected: false,
  lastError: '',
}

let hudBridge = {
  enabled: true,
  writtenAt: Date.now() - 8_000,
  staleMs: 120000,
  bridge: {
    v: 1,
    at: Date.now() - 8_000,
    enabled: true,
    cockpitUrl: 'http://127.0.0.1:6077/cockpit/',
    session: { id: 'sess-lead', title: '认证模块重构', running: true },
    team: { running: 2, total: 6 },
    approvals: 1,
    round: { title: '认证模块重构', percent: 60, done: 3, total: 5, running: true },
  },
}
/** Pending approvals; the demo seeds one so answer flows can be exercised. */
let approvals = (mock.approvals ?? []).map((entry) => ({ ...entry }))
/** When the preview first saw each ask; the demo countdown is anchored to it. */
const approvalAnchors = new Map()
const bootAt = Date.now()
const clients = new Map()

/** Build the frame a tab that selected one session would see. */
function selectSnapshot(state, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return state
  const entry = (state.sessions ?? []).find((row) => row.id === sessionId)
    ?? (state.session?.id === sessionId ? state.session : null)
  if (entry === null) return state
  const live = entry.live !== false
  const entryId = entry.id
  const isCurrent = state.session?.id === entryId
  state.session = {
    id: entry.id,
    title: entry.title,
    running: Boolean(entry.running),
    turn: isCurrent ? entry.turn : 0,
    startedAt: isCurrent ? state.session.startedAt : state.now - 600000,
    elapsedMs: isCurrent ? state.session.elapsedMs : 600000,
    percent: entry.percent ?? null,
    completed: isCurrent ? entry.completed ?? 0 : 0,
    total: isCurrent ? entry.total ?? 0 : 0,
    plan: { steps: isCurrent ? entry.plan?.steps ?? [] : [] },
    stats: isCurrent ? entry.stats ?? { tokens: 0, turns: 0 } : { tokens: 0, turns: 0 },
    model: isCurrent ? state.session.model : '—',
    live,
  }
  state.team = isCurrent && state.team ? state.team : { members: [], tasks: [] }
  state.activity = isCurrent ? state.activity : []
  state.files = isCurrent ? state.files : []
  return state
}

/** Advance the demo: elapsed time grows, tokens tick, activity stays. */
function snapshot(selection = null) {
  const now = Date.now()
  const drift = now - bootAt
  const state = shiftTimes(structuredClone(mock))
  state.now = now
  state.aliases = aliases
  state.cards = (mock.cards ?? []).map((card) => ({
    ...card,
    payload: card.payload ? structuredClone(card.payload) : null,
    updatedAt: now,
  }))
  // each ask is 12s old when it appears, then counts down for real
  state.approvals = approvals.map((entry) => {
    if (!approvalAnchors.has(entry.id)) approvalAnchors.set(entry.id, now)
    const anchor = approvalAnchors.get(entry.id)
    return { ...entry, requestedAt: anchor - 12000, expiresAt: anchor + 13000 }
  })
  if (state.session) {
    state.session.live = true
    state.session.elapsedMs = (state.session.elapsedMs ?? 0) + drift
    if (state.session.running) state.session.startedAt = now - state.session.elapsedMs
  }
  for (const member of state.team?.members ?? []) {
    if (member.running) member.lastAt = now
  }
  return selectSnapshot(state, selection)
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': buf.length })
  res.end(buf)
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        ok(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        fail(error)
      }
    })
    req.on('error', fail)
  })
}

function sendFile(res, path) {
  const file = resolve(join(PUBLIC, path))
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    return res.end('not found')
  }
  const body = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Content-Length': body.length,
  })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname

  // Trailing slash matters: the page uses relative asset URLs.
  if (path === '/cockpit') {
    res.writeHead(302, { Location: '/cockpit/' })
    return res.end()
  }
  if (path === '/cockpit/') return sendFile(res, 'index.html')
  if (path === '/cockpit/api/state') return sendJson(res, 200, snapshot(new URL(req.url ?? '/', 'http://localhost').searchParams.get('s')))
  if (path === '/cockpit/api/actions/send') {
    if (req.method !== 'POST') {
      res.writeHead(405)
      return res.end()
    }
    const body = await readBody(req)
    const sessionId = demoSessionId(String(body.sessionId ?? '').trim())
    const message = String(body.text ?? '').trim()
    const mode = body.mode === 'steer' ? 'steer' : 'queue'
    if (sessionId === '') return sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    if (message === '') return sendJson(res, 400, { ok: false, error: 'text is required' })
    if (message.length > 4000) return sendJson(res, 400, { ok: false, error: 'text is too long' })
    const known = (mock.sessions ?? []).some((entry) => entry.id === sessionId) || mock.session?.id === sessionId
    if (!known) return sendJson(res, 404, { ok: false, error: 'session not found' })
    mock.activity.unshift({ at: mock.now, kind: 'message', agent: null, text: mode === 'steer' ? '插话' : '排队一条消息', detail: message.slice(0, 100) })
    if (mock.activity.length > 40) mock.activity.pop()
    setRunning(sessionId, true)
    return sendJson(res, 200, { ok: true, mode })
  }
  if (path === '/cockpit/api/actions/interrupt') {
    if (req.method !== 'POST') {
      res.writeHead(405)
      return res.end()
    }
    const body = await readBody(req)
    const sessionId = demoSessionId(String(body.sessionId ?? '').trim())
    if (sessionId === '') return sendJson(res, 400, { ok: false, error: 'sessionId is required' })
    const target = mock.session?.id === sessionId ? mock.session : (mock.sessions ?? []).find((entry) => entry.id === sessionId)
    if (target === null || target === undefined) return sendJson(res, 404, { ok: false, error: 'session not found' })
    if (target.running !== true) return sendJson(res, 409, { ok: false, error: 'session is not running' })
    setRunning(sessionId, false)
    mock.activity.unshift({ at: mock.now, kind: 'turn', agent: null, text: '已中断当前轮', detail: '' })
    if (mock.activity.length > 40) mock.activity.pop()
    return sendJson(res, 200, { ok: true })
  }

  if (path === '/cockpit/api/remote') {
    if (req.method !== 'GET') {
      res.writeHead(405)
      return res.end()
    }
    return sendJson(res, 200, remoteSnapshot())
  }
  if (path === '/cockpit/api/remote/tunnel') {
    if (req.method !== 'GET') {
      res.writeHead(405)
      return res.end()
    }
    return sendJson(res, 200, tunnelMock())
  }
  if (path === '/cockpit/api/remote/config' && req.method === 'POST') {
    let value = ''
    try {
      value = (await readBody(req)).publicUrl ?? ''
    } catch {
      return sendJson(res, 400, { ok: false, error: 'invalid json' })
    }
    const result = normalizePublicUrlPreview(value)
    if (!result.ok) return sendJson(res, 400, { ...remoteSnapshot(), ok: false, error: result.error })
    remoteState.publicUrl = result.value
    return sendJson(res, 200, remoteSnapshot())
  }
  if (path === '/cockpit/api/remote/start' && req.method === 'POST') {
    remoteState.running = true
    remoteState.url = 'http://192.168.1.23:6688'
    remoteState.port = 6688
    remoteState.sessions = [
      { id: 'dev-preview-1', label: 'iPhone', createdAt: Date.now() - 42 * 60_000, lastSeenAt: Date.now() - 40_000 },
      { id: 'dev-preview-2', label: 'Android', createdAt: Date.now() - 26 * 60_000, lastSeenAt: Date.now() - 5 * 60_000 },
    ]
    newPair()
    return sendJson(res, 200, remoteSnapshot())
  }
  if (path === '/cockpit/api/remote/stop' && req.method === 'POST') {
    remoteState.running = false
    remoteState.url = null
    remoteState.port = null
    remoteState.pair = null
    remoteState.sessions = []
    return sendJson(res, 200, remoteSnapshot())
  }
  if (path === '/cockpit/api/remote/pair/new' && req.method === 'POST') {
    if (!remoteState.running) return sendJson(res, 409, { ok: false, error: 'remote access is not running' })
    newPair()
    return sendJson(res, 200, remoteSnapshot())
  }
  if (path === '/cockpit/api/remote/sessions') {
    if (req.method !== 'DELETE') {
      res.writeHead(405)
      return res.end()
    }
    const id = url.searchParams.get('id')
    remoteState.sessions = id === null ? [] : remoteState.sessions.filter((device) => device.id !== id)
    return sendJson(res, 200, remoteSnapshot())
  }

  if (path === '/cockpit/api/cards') {
    return sendJson(res, 200, {
      ok: true,
      version: 1,
      cards: (mock.cards ?? []).map((card) => ({ id: card.id, title: card.title, order: card.order, actions: card.actions })),
    })
  }
  const cardAction = /^\/cockpit\/api\/cards\/([a-z0-9][a-z0-9._-]{1,40})\/action$/.exec(path)
  if (cardAction !== null && req.method === 'POST') {
    const body = await readBody(req)
    const actionId = String(body.actionId ?? '').trim()
    const card = (mock.cards ?? []).find((entry) => entry.id === cardAction[1])
    if (card === undefined) return sendJson(res, 404, { ok: false, error: 'card not found' })
    const action = (card.actions ?? []).find((entry) => entry.id === actionId)
    if (action === undefined) return sendJson(res, 404, { ok: false, error: 'action not found' })
    if (actionId === 'run') {
      card.payload = { kind: 'metrics', rows: [{ label: '通过', value: '43/43', tone: 'ok' }, { label: '耗时', value: '8.1s', tone: 'ok' }, { label: '覆盖', value: '88%', tone: 'ok' }], footer: 'vitest · 刚刚重跑' }
    } else if (actionId === 'fail') {
      card.payload = { kind: 'status', state: 'bad', label: '1 个用例失败', detail: 'auth.spec.ts: 期望 200，收到 401' }
    } else if (actionId === 'refresh') {
      card.payload = { kind: 'list', items: [{ title: 'feature/cockpit-v06', detail: '与远端同步', state: 'ok' }, { title: 'server/session.ts', detail: '已修改 · +66 −12', state: 'warn' }], footer: '刚刚刷新 · 2 个文件有改动' }
    }
    mock.activity.unshift({ at: mock.now, kind: 'tool', agent: null, text: '卡片动作', detail: card.title + ' · ' + action.label })
    if (mock.activity.length > 40) mock.activity.pop()
    return sendJson(res, 200, { ok: true, result: null })
  }

  if (path === '/cockpit/api/approvals') {
    if (req.method !== 'GET') {
      res.writeHead(405)
      return res.end()
    }
    return sendJson(res, 200, { ok: true, approvals })
  }
  if (path.startsWith('/cockpit/api/approvals/')) {
    if (req.method !== 'POST') {
      res.writeHead(405)
      return res.end()
    }
    const id = decodeURIComponent(path.slice('/cockpit/api/approvals/'.length))
    const body = await readBody(req)
    const decision = String(body.decision ?? '')
    if (decision !== 'allow-once' && decision !== 'reject') {
      return sendJson(res, 400, { ok: false, error: 'decision must be allow-once or reject' })
    }
    const index = approvals.findIndex((entry) => entry.id === id)
    if (index < 0) return sendJson(res, 404, { ok: false, error: 'unknown or expired approval' })
    approvals.splice(index, 1)
    const frame = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`
    for (const [client] of clients) client.write(frame)
    return sendJson(res, 200, { ok: true, decision })
  }
  if (path === '/cockpit/api/capsule') {
    if (req.method === 'GET') {
      if (capsule.enabled) {
        capsule.writtenAt = Date.now() - 2_000
        capsule.heartbeatAt = Date.now() - 1_000
      }
      return sendJson(res, 200, { ok: true, ...capsule })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { ok: false, error: 'enabled must be a boolean' })
      capsule.enabled = body.enabled
      capsule.running = capsule.enabled
      capsule.lastError = capsule.enabled ? '' : 'capsule stopped by the user'
      if (capsule.enabled) {
        capsule.writtenAt = Date.now()
        capsule.heartbeatAt = Date.now()
        capsule.writes += 1
      }
      return sendJson(res, 200, { ok: true, ...capsule })
    }
    res.writeHead(405)
    return res.end()
  }

  if (path === '/cockpit/api/hud-bridge') {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        enabled: hudBridge.enabled,
        path: '~/.dsh/cockpit/hud.json',
        writtenAt: hudBridge.writtenAt,
        staleMs: hudBridge.staleMs,
        bridge: hudBridge.enabled ? hudBridge.bridge : null,
      })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { ok: false, error: 'enabled must be a boolean' })
      hudBridge.enabled = body.enabled
      capsule.enabled = body.enabled
      capsule.running = body.enabled
      hudBridge.writtenAt = Date.now()
      return sendJson(res, 200, { ok: true, enabled: hudBridge.enabled })
    }
    res.writeHead(405)
    return res.end()
  }
  if (path === '/cockpit/api/aliases') {
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, aliases })
    if (req.method === 'POST') {
      const body = await readBody(req)
      const id = String(body.id ?? '').trim()
      if (id === '') return sendJson(res, 400, { ok: false, error: 'id is required' })
      const name = String(body.name ?? body.alias ?? '').trim().slice(0, 12)
      if (name === '') delete aliases[id]
      else aliases[id] = { name, color: body.color ?? 'blue', emoji: body.emoji ?? '' }
      for (const client of clients) client.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`)
      return sendJson(res, 200, { ok: true, aliases })
    }
    if (req.method === 'DELETE') {
      delete aliases[url.searchParams.get('id') ?? '']
      return sendJson(res, 200, { ok: true, aliases })
    }
  }
  if (path === '/cockpit/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const selection = new URL(req.url ?? '/', 'http://localhost').searchParams.get('s')
    res.write('retry: 2000\n\n')
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(selection))}\n\n`)
    clients.set(res, selection)
    req.on('close', () => clients.delete(res))
    return
  }

  if (path.startsWith('/cockpit/')) return sendFile(res, path.slice('/cockpit/'.length))
  res.writeHead(404)
  res.end('not found')
})

setInterval(() => {
  const frames = new Map()
  for (const [client, selection] of clients) {
    const key = selection ?? ''
    let frame = frames.get(key)
    if (frame === undefined) {
      frame = `event: state\ndata: ${JSON.stringify(snapshot(key === '' ? null : key))}\n\n`
      frames.set(key, frame)
    }
    client.write(frame)
  }
}, 3000).unref()

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cockpit preview: http://127.0.0.1:${PORT}/cockpit`)
})
