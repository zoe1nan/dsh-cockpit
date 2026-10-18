/**
 * dsh-cockpit — Host half.
 *
 * A live, read-only command deck for everything DSH is doing on this machine:
 * the active session's plan, the agent team's roster and task board, the write
 * scopes they are moving, and the recent event stream.
 *
 * The plugin is a pure consumer of services the composition already runs:
 *
 *   - `ctx.sessions.list()`                       live Session instances
 *   - `ctx.sessionProjections.snapshot(...)`      `todos` / `title` / `sessionStats` /
 *                                                 `agentTeam` / `modelSelection`
 *   - `ctx.on('session/event', ...)`              turn / step / tool / team events
 *   - `ctx.webServer.register(...)`               static files + JSON + SSE
 *
 * The only thing written back into DSH is an approval decision: while at least
 * one deck client is connected the plugin answers `approval/request` itself,
 * holds the decision for a short window so it can be taken on the deck, and
 * falls through to the native asker (timeout, disconnect, or explicit hand-off)
 * so the workspace dialog still works. Aliases stay a display-only overlay in
 * `~/.dsh/cockpit/aliases.json`; the HTTP surface is local-only because the web
 * server binds a concrete loopback address.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { homedir, networkInterfaces } from 'node:os'
import { delimiter, extname, join, normalize, resolve } from 'node:path'

export const name = 'dsh-cockpit'
export const inject = ['agents', 'sessions', 'sessionProjections', 'webServer']

const COCKPIT_DIR = join(homedir(), '.dsh', 'cockpit')
const ALIAS_FILE = join(COCKPIT_DIR, 'aliases.json')
const PUBLIC_DIR = join(import.meta.dirname, 'public')
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'))
    return String(pkg.version ?? '') || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const MAX_ACTIVITY = 40
/** How long a deck answer may take before the request falls back to the native asker. */
const APPROVAL_HOLD_MS = Number(process.env.DSH_COCKPIT_APPROVAL_HOLD_MS) > 0 ? Number(process.env.DSH_COCKPIT_APPROVAL_HOLD_MS) : 25_000
const APPROVAL_MAX = 6
/** Dev aid: lets a test host mint a synthetic ask so the deck can be exercised. */
const APPROVAL_DEBUG = process.env.DSH_COCKPIT_APPROVAL_DEBUG === '1'
const MAX_BODY_BYTES = 64 * 1024
/** Longest message the deck may hand to an agent. */
const MAX_ACTION_TEXT = 4000
/** Append-only trail of user-initiated writes, kept local. */
const AUDIT_FILE = join(COCKPIT_DIR, 'audit.jsonl')
/** Desktop capsule bridge: a tiny, read-only summary the HUD polls. */
const HUD_FILE = join(COCKPIT_DIR, 'hud.json')
const SETTINGS_FILE = join(COCKPIT_DIR, 'settings.json')
const BRIDGE_MIN_MS = 2000
const BRIDGE_STALE_MS = 120000
/** Built-in desktop capsule (v0.8): the WPF overlay now ships inside this plugin. */
const CAPSULE_DIR = join(COCKPIT_DIR, 'capsule')
const CAPSULE_STATE_FILE = join(CAPSULE_DIR, 'state.json')
const CAPSULE_HEARTBEAT_FILE = join(CAPSULE_DIR, 'overlay.heartbeat')
const CAPSULE_SCRIPT = join(import.meta.dirname, 'capsule', 'overlay.ps1')
const LEGACY_HUD_HEARTBEAT = join(homedir(), '.dsh', 'dsh-hud', 'overlay.heartbeat')
const CAPSULE_MIN_MS = 150
const CAPSULE_TICK_MS = 1000
const CAPSULE_RESTART_MS = 5000
const CAPSULE_ENABLED_DEFAULT = process.platform === 'win32'
/** Test seam: never spawn a real overlay window during harness runs. */
const CAPSULE_DRY_RUN = process.env.DSH_COCKPIT_CAPSULE_DRY_RUN === '1'
const AUDIT_MAX_BYTES = 256 * 1024
const AUDIT_KEEP_LINES = 400
const SSE_HEARTBEAT_MS = 15000
const TICK_MS = 3000

/**
 * Remote access (v0.7): a second, deliberately tiny LAN listener for phones.
 * It only speaks the pairing page and the /cockpit prefix - never the DSH app -
 * and every request has to come from a private address with a paired session.
 * Pairing codes are six digits, single use and short lived; the sessions file
 * stores SHA-256 hashes only, so the file cannot be replayed as a credential.
 */
const REMOTE_FILE = join(COCKPIT_DIR, 'remote.json')
const REMOTE_PORT = Number(process.env.DSH_COCKPIT_REMOTE_PORT) > 0 ? Number(process.env.DSH_COCKPIT_REMOTE_PORT) : 6688
const REMOTE_PORT_TRIES = 24
const REMOTE_PAIR_TTL_MS = 120_000
const REMOTE_PAIR_ATTEMPTS = 5
const REMOTE_PAIR_WINDOW_MS = 5 * 60_000
const REMOTE_SESSION_IDLE_MS = 24 * 60 * 60_000
const REMOTE_SESSION_MAX_MS = 7 * 24 * 60 * 60_000
const REMOTE_MAX_SESSIONS = 16
const REMOTE_COOKIE = 'cockpit_remote'
const REMOTE_FLAG_COOKIE = 'cockpit_remote_flag'
const REMOTE_BODY_MAX = 16 * 1024

/**
 * Extension cards let other plugins put a small, structured panel inside the
 * deck without shipping any UI of their own. Two things keep that safe and
 * fast: payloads are JSON only (the deck decides how to draw them) and every
 * load is time-boxed and cached, so a slow or broken card can never stall a
 * state frame.
 */
const CARD_API_VERSION = 1
const CARD_LOAD_TTL_MS = 2000
const CARD_LOAD_TIMEOUT_MS = 800
const CARD_ACTION_TIMEOUT_MS = 4000
const CARD_MAX = 24
const CARD_ID = /^[a-z0-9][a-z0-9._-]{1,40}$/
const CARD_ICONS = new Set(['git', 'code', 'test', 'cost', 'note', 'shield', 'clock', 'spark', 'file'])

const COLORS = new Set(['blue', 'green', 'violet', 'orange', 'cyan'])
const EXT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// ---------------------------------------------------------------- utilities

function normalizeIp(value) {
  const ip = text(value)
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length)
  return ip
}

/** Only loopback and RFC1918 / ULA addresses may reach the remote listener. */
function isPrivateIp(value) {
  const ip = normalizeIp(value)
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true
  const parts = ip.split('.')
  if (parts.length !== 4) return ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')
  const [a, b] = parts.map((n) => Number(n))
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/** Prefer the address a phone is most likely to reach: 192.168 > 10 > 172.16/12. */
function detectLanIp() {
  const nets = safe(() => networkInterfaces(), {})
  let best = null
  let bestScore = 0
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.internal || net.family !== 'IPv4' || net.address === '') continue
      const score = net.address.startsWith('192.168.') ? 3 : net.address.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(net.address) ? 1 : 0
      if (score > bestScore) {
        best = net.address
        bestScore = score
      }
    }
  }
  return best
}

function parseCookies(header) {
  const out = {}
  for (const part of text(header).split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const key = part.slice(0, at).trim()
    if (key === '') continue
    out[key] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

/** Constant-time token/code comparison (hash both sides, compare fixed width). */
function sameSecret(a, b) {
  const left = Buffer.from(sha256(a), 'hex')
  const right = Buffer.from(sha256(b), 'hex')
  return timingSafeEqual(left, right)
}

function deviceLabel(req) {
  const ua = text(req.headers['user-agent'])
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '未知设备'
  return truncate(kind, 20) || '未知设备'
}

function safe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

function truncate(value, max) {
  const s = text(value).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function ensureDir() {
  try {
    mkdirSync(COCKPIT_DIR, { recursive: true })
  } catch {
    /* the deck simply loses persistence */
  }
}

function loadAliases() {
  const raw = safe(() => JSON.parse(readFileSync(ALIAS_FILE, 'utf8')), null)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof id !== 'string' || value === null || typeof value !== 'object') continue
    const alias = {
      name: truncate(value.name, 12),
      color: COLORS.has(value.color) ? value.color : 'blue',
      emoji: truncate(value.emoji, 8),
    }
    if (alias.name === '' && alias.emoji === '') continue
    out[id] = alias
  }
  return out
}

function loadSettings() {
  const raw = safe(() => JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')), null)
  const out = { hudBridge: true, capsule: CAPSULE_ENABLED_DEFAULT }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    if (typeof raw.hudBridge === 'boolean') out.hudBridge = raw.hudBridge
    if (typeof raw.capsule === 'boolean') out.capsule = raw.capsule
  }
  return out
}

function saveSettings(settings) {
  ensureDir()
  try {
    const tmp = `${SETTINGS_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(tmp, SETTINGS_FILE)
  } catch {
    /* settings are best effort; the bridge falls back to enabled */
  }
}

function saveAliases(aliases) {
  ensureDir()
  try {
    const tmp = `${ALIAS_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(aliases, null, 2), 'utf8')
    renameSync(tmp, ALIAS_FILE)
  } catch {
    /* aliases are a convenience; never break the page over them */
  }
}


// Tool names are machine identifiers; the deck shows what the agent is doing.
const TOOL_LABELS = {
  ops_bash: '运行命令',
  bash: '运行命令',
  shell: '运行命令',
  read_file: '读取文件',
  ops_inspect_local_file: '读取文件',
  write_file: '写入文件',
  write: '写入文件',
  edit_file: '编辑文件',
  edit: '编辑文件',
  ops_replace: '批量替换',
  glob: '查找文件',
  ops_glob: '查找文件',
  grep: '搜索内容',
  ops_grep: '搜索内容',
  list_dir: '查看目录',
  list_files: '查看目录',
  web_search: '联网搜索',
  web_fetch: '抓取网页',
  read_image: '查看图片',
  read_original_image: '查看图片',
  present: '展示文件',
  job_output: '读取后台任务',
  job_list: '查看后台任务',
  job_kill: '结束后台任务',
  todo_write: '更新计划',
  update_goal: '更新目标',
  create_goal: '创建目标',
  spawn_teammate: '派出代理',
  send_message: '发送消息',
  wait_agent: '等待代理',
  list_agents: '查看代理',
  interrupt_agent: '中断代理',
  team_task_create: '创建任务',
  team_task_update: '更新任务',
  team_task_list: '查看任务',
  subagent: '派出子代理',
  subagent_fork: '派出子代理',
  workflow: '编排工作流',
  ask_user_question: '询问用户',
  skill: '加载技能',
}

const ARG_KEYS = ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'subject', 'name', 'text', 'message', 'description', 'prompt', 'title']

function toolLabel(tool) {
  const key = text(tool)
  if (key === '') return '工具'
  const mapped = TOOL_LABELS[key]
  if (mapped !== undefined) return mapped
  return truncate(key.replace(/^(ops_|dsh_)/, '').replace(/[_-]+/g, ' '), 24) || '工具'
}

/** One readable line describing *what* the tool is touching. */
function toolDetail(name, rawArguments) {
  let args = rawArguments
  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (trimmed === '' || trimmed === '{}') return ''
    try {
      args = JSON.parse(trimmed)
    } catch {
      return truncate(trimmed, 100)
    }
  }
  if (args === null || typeof args !== 'object') return ''
  for (const key of ARG_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    if (key === 'command') {
      return truncate(value.split('\n')[0], 100)
    }
    return truncate(value, 100)
  }
  return ''
}

/** Turn a provider model id into a short human label: deepseek-v4-pro → V4 Pro. */
function prettifyModel(selection) {
  if (selection === null || typeof selection !== 'object') return null
  const model = text(selection.model) || text(selection.name) || text(selection.id)
  if (model === '') return null
  const cleaned = model.replace(/^deepseek-/, '').replace(/[-_]/g, ' ').trim()
  if (cleaned === '') return null
  return cleaned
    .split(' ')
    .map((word) => (word.length <= 2 && /^[a-z]+$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

const STATUS_LABEL = { pending: '待处理', in_progress: '进行中', completed: '已完成', deleted: '已删除' }

function debounce(fn, ms) {
  let timer = null
  return () => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      safe(fn)
    }, ms)
    timer.unref?.()
  }
}

// --------------------------------------------------------------- event fold

/** Live activity hints per Session id, folded from `session/event`. */
class Tracker {
  constructor() {
    this.sessions = new Map()
    this.activity = []
    this.calls = new Map()
    this.changed = () => {}
  }

  state(id) {
    let state = this.sessions.get(id)
    if (state === undefined) {
      state = {
        running: false,
        turn: null,
        startedAt: 0,
        lastAt: 0,
        current: '',
        lastType: '',
      }
      this.sessions.set(id, state)
    }
    return state
  }

  feed(session, event) {
    if (event === null || typeof event !== 'object') return
    const id = safe(() => String(session.id), '')
    if (id === '') return
    const state = this.state(id)
    const type = text(event.type)
    const at = Number(event.time) > 0 ? Number(event.time) : Date.now()
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    state.lastType = type
    state.lastAt = Math.max(state.lastAt, at)

    if (type === 'turn/start') {
      state.running = true
      state.turn = Number.isFinite(Number(data.turn)) ? Number(data.turn) : state.turn
      state.startedAt = at
      state.current = '开始新一轮'
      this.push({ at, kind: 'turn', sessionId: id, text: `开始第 ${state.turn ?? '?'} 轮`, detail: '' })
    } else if (type === 'turn/end') {
      state.running = false
      const reason = text(data.reason)
      state.current = reason === 'completed' ? '本轮完成' : `本轮${reason || '结束'}`
      this.push({ at, kind: 'turn', sessionId: id, text: `第 ${state.turn ?? '?'} 轮结束`, detail: reason })
    } else if (type === 'tool/call') {
      const tool = text(data.name) || text(data.tool) || text(data.toolName) || '工具'
      const detail = toolDetail(tool, data.arguments ?? data.args ?? data.input)
      const callId = text(data.callId) || text(data.id)
      if (callId !== '') {
        this.calls.set(callId, { tool, detail, sessionId: id })
        if (this.calls.size > 200) this.calls.delete(this.calls.keys().next().value)
      }
      state.current = `${toolLabel(tool)}${detail ? ' · ' + truncate(detail, 60) : ''}`
      this.push({ at, kind: 'tool', sessionId: id, text: toolLabel(tool), detail })
    } else if (type === 'tool/result') {
      const doneCall = text(data.callId) || text(data.id)
      if (doneCall !== '') this.calls.delete(doneCall)
      const tool = text(data.name) || text(data.tool) || ''
      const ms = Number(data.durationMs ?? data.ms)
      this.push({
        at,
        kind: 'done',
        sessionId: id,
        text: `${tool === '' ? '工具' : toolLabel(tool)}完成`,
        detail: Number.isFinite(ms) && ms > 0 ? `${Math.round(ms)} 毫秒` : '',
      })
    } else if (type === 'assistant/message') {
      // Content blocks include the model's private reasoning; only visible text
      // belongs on the deck.
      const content = data.content ?? data.message?.content
      const line = Array.isArray(content)
        ? content
          .filter((part) => part && (part.type === undefined || part.type === 'text'))
          .map((part) => text(part.text))
          .join(' ')
        : text(content)
      if (line !== '') {
        state.current = truncate(line, 60)
        this.push({ at, kind: 'message', sessionId: id, text: truncate(line, 90), detail: '' })
      }
    } else if (type === 'user/message') {
      state.current = '收到用户消息'
      this.push({ at, kind: 'message', sessionId: id, text: '收到用户消息', detail: '' })
    } else if (type === 'team/task') {
      const task = data.task && typeof data.task === 'object' ? data.task : {}
      const subject = truncate(task.subject, 40)
      this.push({
        at,
        kind: 'team',
        sessionId: id,
        text: `任务 ${text(task.id) || '?'} ${STATUS_LABEL[text(task.status)] || '更新'}${subject ? '：' + subject : ''}`,
        detail: text(task.ownerName),
      })
    } else if (type === 'team/member') {
      const member = data.member && typeof data.member === 'object' ? data.member : {}
      const who = text(member.name) || '成员'
      const phase = text(member.phase)
      const label = phase === 'active' ? '上线' : phase === 'failed' ? '失败' : phase === 'provisioning' ? '正在创建' : '更新'
      this.push({ at, kind: 'team', sessionId: id, text: `成员 ${who} ${label}`, detail: '' })
    } else if (type === 'team/message/queued') {
      const message = data.message && typeof data.message === 'object' ? data.message : {}
      this.push({
        at,
        kind: 'team',
        sessionId: id,
        text: `向 ${text(message.targetName) || text(message.targetId) || '代理'} 发送消息`,
        detail: truncate(message.text ?? message.body, 60),
      })
    } else if (type === 'step/start') {
      state.current = `步骤 ${data.step ?? '?'} 开始`
    }

    this.changed()
  }

  push(entry) {
    this.activity.unshift(entry)
    if (this.activity.length > MAX_ACTIVITY) this.activity.length = MAX_ACTIVITY
  }
}

// ---------------------------------------------------------------- extension cards

/**
 * Registry of cards contributed by other plugins.
 *
 * The host never trusts a card with presentation: it validates the descriptor,
 * time-boxes `load()`, caches the last good payload and exposes everything as
 * plain JSON in `state.cards`. Actions come back through one HTTP endpoint and
 * run in the owning plugin's code.
 */
class CardRegistry {
  constructor() {
    this.cards = new Map()
    this.cache = new Map()
  }

  register(definition) {
    const card = normalizeCard(definition)
    if (card === null) throw new Error('cockpit card: invalid definition')
    if (this.cards.size >= CARD_MAX && !this.cards.has(card.id)) {
      throw new Error('cockpit card: too many cards (max ' + CARD_MAX + ')')
    }
    this.cards.set(card.id, card)
    this.cache.delete(card.id)
    return () => {
      const current = this.cards.get(card.id)
      if (current === card) this.cards.delete(card.id)
      this.cache.delete(card.id)
    }
  }

  disposeAll() {
    this.cards.clear()
    this.cache.clear()
  }

  /** Load every card in parallel; never throws, never waits longer than the timeout. */
  async snapshot() {
    const now = Date.now()
    const out = []
    const pending = []
    for (const card of this.cards.values()) {
      const cached = this.cache.get(card.id)
      if (cached !== undefined && now - cached.at < CARD_LOAD_TTL_MS) {
        out.push(viewCard(card, cached))
        continue
      }
      const row = viewCard(card, { payload: cached?.payload ?? null, error: cached?.error ?? null, at: cached?.at ?? 0 })
      out.push(row)
      if (typeof card.load !== 'function') continue
      pending.push((async () => {
        let payload = null
        let error = null
        try {
          payload = await withTimeout(card.load(), CARD_LOAD_TIMEOUT_MS)
        } catch (issue) {
          error = issue instanceof Error ? issue.message : String(issue)
        }
        const next = { payload: normalizePayload(payload), error, at: Date.now() }
        this.cache.set(card.id, next)
        const index = out.findIndex((entry) => entry.id === card.id)
        if (index >= 0) out[index] = viewCard(card, next)
      })())
    }
    if (pending.length > 0) await Promise.allSettled(pending)
    out.sort((a, b) => Number(a.order) - Number(b.order) || a.id.localeCompare(b.id))
    return out
  }

  async runAction(id, actionId) {
    const card = this.cards.get(id)
    if (card === undefined) return { ok: false, status: 404, error: 'card not found' }
    const action = (card.actions ?? []).find((candidate) => candidate.id === actionId)
    if (action === undefined) return { ok: false, status: 404, error: 'action not found' }
    if (typeof card.onAction !== 'function') return { ok: false, status: 409, error: 'card has no handler' }
    try {
      const result = await withTimeout(card.onAction(actionId), CARD_ACTION_TIMEOUT_MS)
      this.cache.delete(card.id)
      return { ok: true, status: 200, result: result ?? null }
    } catch (issue) {
      return { ok: false, status: 409, error: issue instanceof Error ? issue.message : String(issue) }
    }
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out after ' + ms + 'ms')), ms)
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (issue) => { clearTimeout(timer); reject(issue) },
    )
  })
}

function normalizeCard(definition) {
  if (definition === null || typeof definition !== 'object') return null
  const id = String(definition.id ?? '').trim()
  const title = String(definition.title ?? '').trim()
  if (!CARD_ID.test(id) || title === '') return null
  const actions = Array.isArray(definition.actions)
    ? definition.actions.slice(0, 4).map((action) => {
      const actionId = String(action?.id ?? '').trim()
      const label = String(action?.label ?? '').trim()
      if (actionId === '' || label === '') return null
      const style = ['primary', 'ghost', 'danger'].includes(action?.style) ? action.style : 'ghost'
      const confirm = String(action?.confirm ?? '').trim()
      return { id: actionId, label, style, ...(confirm === '' ? {} : { confirm }) }
    }).filter(Boolean)
    : []
  return {
    id,
    title: title.slice(0, 24),
    subtitle: String(definition.subtitle ?? '').trim().slice(0, 40),
    icon: CARD_ICONS.has(definition.icon) ? definition.icon : 'spark',
    order: Number.isFinite(definition.order) ? Number(definition.order) : 100,
    load: typeof definition.load === 'function' ? definition.load : null,
    actions,
    onAction: typeof definition.onAction === 'function' ? definition.onAction : null,
  }
}

function normalizePayload(payload) {
  if (payload === null || typeof payload !== 'object') return null
  const kind = String(payload.kind ?? '')
  const footer = String(payload.footer ?? '').trim().slice(0, 80)
  if (kind === 'list' && Array.isArray(payload.items)) {
    return {
      kind,
      items: payload.items.slice(0, 8).map((item) => ({
        title: String(item?.title ?? '').trim().slice(0, 80),
        detail: String(item?.detail ?? '').trim().slice(0, 120),
        state: ['ok', 'warn', 'bad', 'idle'].includes(item?.state) ? item.state : 'idle',
      })).filter((item) => item.title !== ''),
      ...(footer === '' ? {} : { footer }),
    }
  }
  if (kind === 'metrics' && Array.isArray(payload.rows)) {
    return {
      kind,
      rows: payload.rows.slice(0, 6).map((row) => ({
        label: String(row?.label ?? '').trim().slice(0, 24),
        value: String(row?.value ?? '').trim().slice(0, 40),
        tone: ['ok', 'warn', 'bad', 'idle'].includes(row?.tone) ? row.tone : 'idle',
      })).filter((row) => row.label !== ''),
      ...(footer === '' ? {} : { footer }),
    }
  }
  if (kind === 'status') {
    return {
      kind,
      state: ['ok', 'warn', 'bad', 'idle'].includes(payload.state) ? payload.state : 'idle',
      label: String(payload.label ?? '').trim().slice(0, 60),
      detail: String(payload.detail ?? '').trim().slice(0, 120),
      ...(footer === '' ? {} : { footer }),
    }
  }
  if (kind === 'text') {
    return {
      kind,
      text: String(payload.text ?? '').trim().slice(0, 400),
      ...(footer === '' ? {} : { footer }),
    }
  }
  return null
}

function viewCard(card, state) {
  return {
    id: card.id,
    title: card.title,
    subtitle: card.subtitle,
    icon: card.icon,
    order: card.order,
    actions: card.actions,
    payload: state.payload ?? null,
    error: state.error ?? null,
    updatedAt: state.at ?? 0,
  }
}

// ------------------------------------------------------------------- plugin

export function apply(ctx) {
  if (process.env.DSH_COCKPIT_DISABLE === '1') return
  ensureDir()

  const tracker = new Tracker()
  const sseClients = new Map()
  const fileCache = new Map()
  const cards = new CardRegistry()
  let aliases = loadAliases()
  const settings = loadSettings()

  // Other plugins can inject 'cockpit' and contribute a card:
  //   ctx.cockpit.registerCard({ id, title, load, actions, onAction })
  const cardApi = { version: CARD_API_VERSION, registerCard: (definition) => cards.register(definition) }
  ctx.provide('cockpit', cardApi)
  ctx.effect(() => () => cards.disposeAll())

  // -- remote access (v0.7) ------------------------------------------------

  const remote = createRemoteAccess()

  function createRemoteAccess() {
    const sessions = new Map() // id -> { id, label, tokenHash, createdAt, lastSeenAt }
    const byToken = new Map() // tokenHash -> id
    const attempts = new Map() // ip -> { count, resetAt }
    const connections = new Set()
    let server = null
    let lanIp = null
    let port = null
    let pair = null
    let persistedAt = 0
    let starting = null
    let publicUrl = null
    const streams = new Set()

    load()
    purge()

    function load() {
      const raw = safe(() => JSON.parse(readFileSync(REMOTE_FILE, 'utf8')), null)
      if (raw === null || typeof raw !== 'object') return
      if (typeof raw.publicUrl === 'string' && /^https?:\/\//.test(raw.publicUrl)) publicUrl = raw.publicUrl
      const now = Date.now()
      for (const row of Array.isArray(raw.attempts) ? raw.attempts : []) {
        const ip = text(row?.ip)
        const resetAt = Number(row?.resetAt)
        if (ip === '' || !Number.isFinite(resetAt) || resetAt <= now) continue
        attempts.set(ip, { count: Math.max(0, Math.min(REMOTE_PAIR_ATTEMPTS, Number(row?.count) || 0)), resetAt })
      }
      if (!Array.isArray(raw.sessions)) return
      for (const row of raw.sessions.slice(0, REMOTE_MAX_SESSIONS)) {
        const id = text(row?.id)
        const tokenHash = text(row?.tokenHash)
        if (id === '' || !/^[0-9a-f]{64}$/.test(tokenHash)) continue
        const session = {
          id,
          label: truncate(row?.label, 40) || '未知设备',
          tokenHash,
          createdAt: Number(row?.createdAt) || Date.now(),
          lastSeenAt: Number(row?.lastSeenAt) || Date.now(),
        }
        sessions.set(id, session)
        byToken.set(tokenHash, id)
      }
    }

    function save(force = false) {
      const now = Date.now()
      if (!force && now - persistedAt < 60_000) return
      persistedAt = now
      ensureDir()
      try {
        const tmp = `${REMOTE_FILE}.tmp`
        const attemptsNow = [...attempts.entries()]
          .filter(([, row]) => row.resetAt > now)
          .map(([ip, row]) => ({ ip, count: row.count, resetAt: row.resetAt }))
        writeFileSync(tmp, JSON.stringify({ sessions: [...sessions.values()], attempts: attemptsNow, publicUrl }), { encoding: 'utf8', mode: 0o600 })
        renameSync(tmp, REMOTE_FILE)
      } catch {
        /* pairing still works for this run; it just will not survive a restart */
      }
    }

    function drop(id) {
      const session = sessions.get(id)
      if (session === undefined) return false
      sessions.delete(id)
      byToken.delete(session.tokenHash)
      return true
    }

    function purge() {
      const now = Date.now()
      let changed = false
      for (const session of [...sessions.values()]) {
        if (now - session.createdAt > REMOTE_SESSION_MAX_MS || now - session.lastSeenAt > REMOTE_SESSION_IDLE_MS) {
          drop(session.id)
          changed = true
        }
      }
      if (changed) save(true)
    }

    function newCode() {
      pair = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: Date.now() + REMOTE_PAIR_TTL_MS }
      return pair
    }

    function secureCookies() {
      return text(publicUrl).startsWith('https:') || process.env.DSH_COCKPIT_REMOTE_SECURE === '1'
    }

    function cookieSuffix() {
      return secureCookies() ? '; Secure' : ''
    }

    function normalizePublicUrl(value) {
      const raw = text(value).trim()
      if (raw === '') return { ok: true, value: null }
      let parsed = null
      try {
        parsed = new URL(raw)
      } catch {
        return { ok: false, error: '请填写完整的 https:// 地址' }
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: '只支持 http:// 或 https:// 地址' }
      }
      if (parsed.username !== '' || parsed.password !== '') return { ok: false, error: '地址里不能带账号密码' }
      if (parsed.pathname !== '/' && parsed.pathname !== '') return { ok: false, error: '只填域名和端口，不要带路径' }
      if (parsed.search !== '' || parsed.hash !== '') return { ok: false, error: '只填域名和端口，不要带参数' }
      return { ok: true, value: parsed.origin }
    }

    function setPublicUrl(value) {
      const result = normalizePublicUrl(value)
      if (!result.ok) return { ...status(), ok: false, error: result.error }
      publicUrl = result.value
      save(true)
      audit('remote/config', null, { publicUrl })
      return { ...status(), ok: true }
    }

    /**
     * Report which HTTPS tunnel helpers happen to be installed. Nothing is
     * spawned from here: the messages are copy-paste commands the user runs in
     * their own terminal, so a missing binary simply shows as unavailable.
     */
    function tunnelTools() {
      const wanted = [
        { id: 'cloudflared', label: 'Cloudflare Tunnel', file: 'cloudflared' },
        { id: 'tailscale', label: 'Tailscale', file: 'tailscale' },
      ]
      const dirs = String(process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '')
      const tools = []
      for (const tool of wanted) {
        let location = null
        for (const dir of dirs) {
          for (const candidate of [tool.file, `${tool.file}.exe`]) {
            const full = join(dir, candidate)
            if (existsSync(full)) {
              location = full
              break
            }
          }
          if (location !== null) break
        }
        tools.push({ id: tool.id, label: tool.label, available: location !== null, path: location })
      }
      const localPort = port ?? REMOTE_PORT
      const commands = [
        {
          id: 'cloudflared',
          label: '临时 HTTPS 隧道（无需账号）',
          command: `cloudflared tunnel --url http://127.0.0.1:${localPort}`,
          note: '运行后把输出的 https://xxx.trycloudflare.com 填入公网地址；关掉窗口隧道即断开。',
        },
        {
          id: 'tailscale',
          label: 'Tailscale 私有网（手机登录同一账号）',
          command: `tailscale serve --bg ${localPort}`,
          note: '手机和电脑登录同一 Tailnet，然后用 https://<机器名>.<tailnet>.ts.net 访问；只在你自己的设备间可达。',
        },
      ]
      return {
        ok: true,
        tools,
        commands,
        running: server !== null,
        lanUrl: server === null ? null : `http://${lanIp}:${port}`,
      }
    }

    function auth(req) {
      const token = parseCookies(req.headers.cookie)[REMOTE_COOKIE]
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null
      const hash = sha256(token)
      const id = byToken.get(hash)
      if (id === undefined) return null
      const session = sessions.get(id)
      if (session === undefined) return null
      const now = Date.now()
      if (now - session.createdAt > REMOTE_SESSION_MAX_MS || now - session.lastSeenAt > REMOTE_SESSION_IDLE_MS) {
        drop(id)
        save(true)
        return null
      }
      session.lastSeenAt = now
      save()
      return session
    }

    function securityHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    }

    function plain(res, status, message, withHome = false) {
      if (res.headersSent) return
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      })
      res.end(pairPageHtml(withHome ? message : message, withHome))
    }

    function redirect(res, location) {
      if (res.headersSent) return
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
      res.end()
    }

    function servePairPage(req, res) {
      let error = ''
      try {
        error = text(new URL(req.url ?? '/', 'http://remote.invalid').searchParams.get('e')) === '1'
          ? '配对码不正确或已过期，请在桌面上生成新的一枚。'
          : ''
      } catch {
        error = ''
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      })
      res.end(pairPageHtml(error))
    }

    function readPairCode(req) {
      return new Promise((ok) => {
        let size = 0
        const chunks = []
        let done = false
        const finish = (value) => {
          if (done) return
          done = true
          const raw = Buffer.concat(chunks).toString('utf8')
          let code = value
          if (code === '') {
            const params = new URLSearchParams(raw)
            code = params.get('code') ?? ''
            if (code === '') {
              const parsed = safe(() => JSON.parse(raw), null)
              code = text(parsed?.code)
            }
          }
          ok(code.replace(/\D/g, '').slice(0, 12))
        }
        req.on('data', (chunk) => {
          if (done) return
          size += chunk.length
          if (size > REMOTE_BODY_MAX) {
            finish('')
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => finish(''))
        req.on('error', () => finish(''))
      })
    }

    async function pairHook(req, res, ip) {
      const now = Date.now()
      let record = attempts.get(ip)
      if (record === undefined || record.resetAt <= now) {
        record = { count: 0, resetAt: now + REMOTE_PAIR_WINDOW_MS }
        attempts.set(ip, record)
      }
      if (record.count >= REMOTE_PAIR_ATTEMPTS) return plain(res, 429, '尝试次数过多，请稍后再试', true)

      const code = await readPairCode(req)
      const current = pair
      const valid = current !== null && current.expiresAt > now && code.length === 6 && sameSecret(code, current.code)
      if (!valid) {
        record.count += 1
        save(true)
        audit('remote/pair', null, { ok: false, ip })
        return redirect(res, '/?e=1')
      }

      pair = null
      record.count = 0
      purge()
      if (sessions.size >= REMOTE_MAX_SESSIONS) return plain(res, 409, '已配对设备过多，请先在桌面端断开一台。', true)

      const token = randomBytes(32).toString('base64url')
      const session = {
        id: randomUUID(),
        label: deviceLabel(req),
        tokenHash: sha256(token),
        createdAt: now,
        lastSeenAt: now,
      }
      sessions.set(session.id, session)
      byToken.set(session.tokenHash, session.id)
      save(true)
      audit('remote/pair', session.id, { ok: true, device: session.label, ip })
      res.setHeader('Set-Cookie', [
        `${REMOTE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${cookieSuffix()}`,
        `${REMOTE_FLAG_COOKIE}=1; Path=/; SameSite=Strict; Max-Age=604800${cookieSuffix()}`,
      ])
      return redirect(res, '/cockpit/?remote=1')
    }

    function forward(req, res) {
      const path = safe(() => new URL(req.url ?? '/', 'http://remote.invalid').pathname, '/')
      if (path === '/cockpit' || path === '/cockpit/') {
        req.cockpitRemote = true
        return indexRoute(req, res)
      }
      req.cockpitRemote = true
      if (path === '/cockpit/api/stream') {
        streams.add(res)
        res.on('close', () => streams.delete(res))
      }
      return cockpitRoute(req, res)
    }

    async function handleRequest(req, res) {
      const ip = normalizeIp(req.socket.remoteAddress)
      if (!isPrivateIp(ip)) return plain(res, 403, '只有局域网内的设备可以连接。', true)
      securityHeaders(res)
      const path = safe(() => new URL(req.url ?? '/', 'http://remote.invalid').pathname, '/')
      if (path === '/' || path === '/pair') {
        if (req.method === 'GET') {
          if (auth(req) !== null) return redirect(res, '/cockpit/')
          return servePairPage(req, res)
        }
        if (req.method === 'POST' && path === '/pair') return pairHook(req, res, ip)
        return plain(res, 405, '不支持的请求方式。', true)
      }
      if (path === '/cockpit' || path.startsWith('/cockpit/')) {
        if (path.startsWith('/cockpit/api/remote')) return plain(res, 403, '远程端不能管理配对。', true)
        /*
         * The manifest and the icons are static, already-public assets. Browsers
         * fetch the manifest without cookies, so requiring a session here only
         * produced a 302 -> pair-page HTML and a "Manifest: Syntax error" log.
         * Everything else under /cockpit still needs a paired session.
         */
        const publicAsset = req.method === 'GET' && (path === '/cockpit/manifest.webmanifest' ||
          path === '/cockpit/favicon.svg' || path === '/cockpit/whale.svg' ||
          path.startsWith('/cockpit/icons/'))
        if (!publicAsset && auth(req) === null) return redirect(res, '/')
        return forward(req, res)
      }
      return plain(res, 404, '页面不存在。', true)
    }

    function listenPort(srv, wanted, remaining) {
      return new Promise((ok, fail) => {
        const onError = (error) => {
          srv.removeListener('listening', onListening)
          if (error?.code === 'EADDRINUSE' && remaining > 1) {
            listenPort(srv, wanted + 1, remaining - 1).then(ok, fail)
            return
          }
          fail(error)
        }
        const onListening = () => {
          srv.removeListener('error', onError)
          ok(wanted)
        }
        srv.once('error', onError)
        srv.once('listening', onListening)
        srv.listen(wanted, lanIp)
      })
    }

    async function start() {
      if (server !== null) {
        newCode()
        return status()
      }
      if (starting !== null) return starting
      starting = open()
      try {
        return await starting
      } finally {
        starting = null
      }
    }

    async function open() {
      lanIp = detectLanIp()
      if (lanIp === null) throw new Error('没有找到局域网地址，请先连接 Wi-Fi 或网线')
      const srv = createServer((req, res) => {
        handleRequest(req, res).catch(() => {
          try {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('internal error')
          } catch {
            /* connection already gone */
          }
        })
      })
      srv.on('connection', (socket) => {
        connections.add(socket)
        socket.on('close', () => connections.delete(socket))
      })
      srv.keepAliveTimeout = 5000
      srv.headersTimeout = 10000
      srv.requestTimeout = 30000
      port = await listenPort(srv, REMOTE_PORT, REMOTE_PORT_TRIES)
      server = srv
      newCode()
      audit('remote/start', null, { port, lan: lanIp })
      return status()
    }

    /** Drop any live SSE streams a paired phone may still hold. */
    function closeStreams() {
      for (const res of streams) {
        try {
          res.end()
        } catch {
          /* already gone */
        }
      }
      streams.clear()
    }

    function close() {
      closeStreams()
      for (const socket of connections) {
        try {
          socket.destroy()
        } catch {
          /* already closed */
        }
      }
      connections.clear()
      if (server !== null) {
        const srv = server
        server = null
        try {
          srv.close()
        } catch {
          /* already closed */
        }
      }
      port = null
      pair = null
    }

    function stop(revoke = true) {
      const devices = sessions.size
      close()
      if (revoke) {
        sessions.clear()
        byToken.clear()
        attempts.clear()
        save(true)
        closeStreams()
      }
      audit('remote/stop', null, { revoked: revoke ? devices : 0 })
      return status()
    }

    function revoke(id) {
      purge()
      closeStreams()
      if (id === undefined || id === '') {
        const devices = sessions.size
        sessions.clear()
        byToken.clear()
        save(true)
        audit('remote/revoke', null, { all: true, devices })
      } else if (drop(id)) {
        save(true)
        audit('remote/revoke', id, { all: false })
      }
      return status()
    }

    function status() {
      const lanUrl = server === null ? null : `http://${lanIp}:${port}`
      return {
        ok: true,
        enabled: true,
        running: server !== null,
        url: lanUrl,
        publicUrl,
        secure: secureCookies(),
        urlForPhone: publicUrl ?? lanUrl,
        port: server === null ? null : port,
        pair: pair !== null && pair.expiresAt > Date.now() ? { code: pair.code, expiresAt: pair.expiresAt } : null,
        sessions: [...sessions.values()]
          .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
          .map(({ id, label, createdAt, lastSeenAt }) => ({ id, label, createdAt, lastSeenAt })),
      }
    }

    return { start, stop, revoke, status, newCode, close, handleRequest, pairHook, sessions, auth, setPublicUrl, tunnel: tunnelTools, secureCookies }
  }

  function pairPageHtml(message, withBack = false) {
    const safeMessage = escapeHtml(message)
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Cockpit · 配对</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:linear-gradient(170deg,#eef3ff,#f8fbff 55%,#eef3ff);font:15px/1.55 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Noto Sans SC",system-ui,sans-serif;color:#161b2b}
@media (prefers-color-scheme: dark){body{background:linear-gradient(170deg,#0f1524,#0b101d);color:#e8edf9}}
.card{width:100%;max-width:420px;border-radius:22px;padding:26px 24px;background:rgba(255,255,255,.86);border:1px solid rgba(22,32,64,.09);box-shadow:0 20px 60px rgba(22,32,64,.12);backdrop-filter:blur(18px)}
@media (prefers-color-scheme: dark){.card{background:rgba(22,29,46,.9);border-color:rgba(255,255,255,.08);box-shadow:0 20px 60px rgba(0,0,0,.45)}}
.brand{display:flex;align-items:center;gap:9px;font-weight:680;font-size:16px}
.dot{width:9px;height:9px;border-radius:99px;background:#4d6bfe;box-shadow:0 0 0 4px rgba(77,107,254,.16)}
h1{font-size:18px;margin:18px 0 6px}
p{margin:0;color:#5c6884;font-size:13px}
@media (prefers-color-scheme: dark){p{color:#9aa5be}}
form{display:flex;flex-direction:column;gap:12px;margin-top:20px}
input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid rgba(77,107,254,.28);background:rgba(77,107,254,.06);font:600 26px/1 "Consolas","Cascadia Mono",ui-monospace,monospace;letter-spacing:.34em;text-align:center;color:inherit;outline:none}
input:focus{border-color:#4d6bfe;box-shadow:0 0 0 4px rgba(77,107,254,.16)}
button{padding:13px 16px;border-radius:14px;border:0;background:#4d6bfe;color:#fff;font-size:14px;font-weight:650;cursor:pointer}
button:active{transform:translateY(1px)}
.err{padding:10px 12px;border-radius:12px;background:rgba(213,74,64,.1);color:#b3403a;font-size:12.5px}
a{color:#4d6bfe;text-decoration:none;font-size:13px}
.host{margin-top:16px;font:12px/1.4 "Consolas","Cascadia Mono",ui-monospace,monospace;color:#71809f;word-break:break-all}
@media (prefers-color-scheme: dark){.host{color:#8290ad}}
</style></head><body><div class="card">
<div class="brand"><span class="dot"></span>Cockpit</div>
<h1>连接到桌面端的 Cockpit</h1>
<p>在桌面端的「设置 → 远程接管」里生成配对码，然后在这里输入。配对码 2 分钟内有效，只能用一次。</p>
${safeMessage === '' ? '' : `<div class="err" style="margin-top:14px">${safeMessage}</div>`}
<form method="post" action="/pair" autocomplete="off">
<input name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="9" placeholder="••• •••" aria-label="六位配对码" required>
<button type="submit">连接</button>
</form>
<div class="host">${withBack ? '请在桌面端重新生成配对码' : 'Cockpit · 局域网直连'}</div>
</div></body></html>`
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  }

  // -- state building ------------------------------------------------------

  const projectionKeys = ['todos', 'title', 'sessionStats', 'agentTeam', 'modelSelection']

  function readSession(session) {
    const id = safe(() => String(session.id), '')
    const values = safe(() => ctx.sessionProjections.snapshot(session, projectionKeys)?.values ?? {}, {})
    const live = tracker.sessions.get(id) ?? null
    const todos = Array.isArray(values.todos) ? values.todos : []
    const steps = todos.map((todo) => ({
      text: truncate(todo?.content, 120),
      status: todo?.status === 'completed' ? 'completed' : todo?.status === 'in_progress' ? 'in_progress' : 'pending',
    }))
    const completed = steps.filter((step) => step.status === 'completed').length
    const total = steps.length
    const stats = values.sessionStats && typeof values.sessionStats === 'object' ? values.sessionStats : {}
    const selection = values.modelSelection && typeof values.modelSelection === 'object'
      ? values.modelSelection.lastUsed ?? values.modelSelection.next ?? null
      : null
    const team = values.agentTeam && typeof values.agentTeam === 'object' ? values.agentTeam : null
    const running = live === null ? false : live.running
    return {
      id,
      title: truncate(values.title, 60) || null,
      running,
      turn: live?.turn ?? null,
      startedAt: live?.startedAt ?? 0,
      lastAt: Math.max(live?.lastAt ?? 0, Number(safe(() => session.header?.createdAt, 0)) || 0),
      current: live?.current ?? '',
      model: prettifyModel(selection),
      steps,
      completed,
      total,
      percent: total === 0 ? null : Math.round((completed / total) * 100),
      stats: {
        turns: Number(stats.turns) || 0,
        steps: Number(stats.steps) || 0,
        llmMs: Number(stats.llmMs) || 0,
        toolMs: Number(stats.toolMs) || 0,
        tokens: Math.round(Number(stats.decodeTokens) || 0),
      },
      team,
    }
  }

  async function buildState(selection = null) {
    const now = Date.now()
    const sessions = safe(() => ctx.sessions.list(), [])
    const views = []
    for (const session of sessions) {
      const view = safe(() => readSession(session), null)
      if (view !== null && view.id !== '') views.push(view)
    }

    // Teammates run in their own sessions, which are not listed by the store but
    // can be reached through the agents registry. Read them so the roster shows
    // real token counts and live activity instead of empty placeholders.
    const seen = new Set(views.map((view) => view.id))
    const memberIds = []
    for (const view of views) {
      for (const member of Array.isArray(view.team?.members) ? view.team.members : []) {
        const id = text(member.id)
        if (id !== '' && !seen.has(id)) memberIds.push(id)
      }
    }
    for (const id of memberIds) {
      const child = safe(() => ctx.agents.get(id)?.session ?? null, null)
      const view = child === null ? null : safe(() => readSession(child), null)
      if (view !== null && view.id !== '') {
        agentToSession.set(id, view.id)
        sessionToAgent.set(view.id, id)
      }
      if (view !== null && view.id !== '' && !seen.has(view.id)) {
        seen.add(view.id)
        views.push(view)
      }
    }

    // A session carrying a real team wins; otherwise the busiest/most recent one.
    const teamViews = views.filter((view) => Array.isArray(view.team?.members) && view.team.members.length > 1)
    const ranked = [...views].sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1
      return b.lastAt - a.lastAt
    })
    const forced = typeof selection === 'string' && selection !== ''
      ? views.find((view) => view.id === selection) ?? null
      : null
    const active = forced
      ?? ranked.find((view) => view.running && (view.team?.members?.length ?? 0) > 1)
      ?? teamViews.sort((a, b) => b.lastAt - a.lastAt)[0]
      ?? ranked.find((view) => view.running)
      ?? ranked[0]
      ?? null

    const memberById = new Map()
    const team = active?.team ?? null
    const members = []
    if (team !== null && Array.isArray(team.members)) {
      for (const member of team.members) {
        const id = text(member.id)
        if (id === '') continue
        const mapped = agentToSession.get(id) ?? null
        const view = views.find((candidate) => candidate.id === id)
          ?? (mapped === null ? null : views.find((candidate) => candidate.id === mapped))
          ?? null
        const sessionId = view?.id ?? mapped ?? (id.startsWith('session-') ? id : null)
        const role = member.role === 'lead' ? 'lead' : 'teammate'
        const phase = text(member.phase) || 'active'
        const status = phase === 'failed' ? 'failed' : phase === 'provisioning' ? 'provisioning' : view?.running ? 'running' : 'idle'
        const entry = {
          id,
          sessionId,
          live: sessionId === null ? false : sessionToAgent.has(sessionId) || safe(() => ctx.agents.get(sessionId) != null, false),
          name: text(member.name) || (role === 'lead' ? 'lead' : 'member'),
          role,
          phase,
          model: view?.model ?? active?.model ?? null,
          status,
          running: Boolean(view?.running),
          tokens: view?.stats?.tokens ?? 0,
          current: truncate(view?.current, 80),
          lastAt: view?.lastAt ?? 0,
        }
        memberById.set(id, entry)
        members.push(entry)
      }
    }
    const nameById = new Map([...memberById].map(([id, member]) => [id, member.name]))
    const leadId = members.find((member) => member.role === 'lead')?.id ?? active?.id ?? null

    const tasks = Array.isArray(team?.tasks)
      ? team.tasks.map((task) => {
        const ownerName = text(task.ownerName)
        const owner = ownerName === '' ? null : [...memberById].find(([, member]) => member.name === ownerName)?.[0] ?? (ownerName === 'lead' ? leadId : null)
        return {
          id: text(task.id),
          revision: Number(task.revision) || 1,
          subject: truncate(task.subject, 80),
          status: ['pending', 'in_progress', 'completed'].includes(task.status) ? task.status : 'pending',
          owner,
          ownerName: ownerName || null,
          blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(text) : [],
          writeScopes: Array.isArray(task.writeScopes) ? task.writeScopes.map(text) : [],
          ready: task.status === 'completed' ? true : Boolean(task.ready),
          warnings: Array.isArray(task.writeScopeWarnings) ? task.writeScopeWarnings.map((warning) => truncate(warning, 120)) : [],
        }
      })
      : []

    // Write-scope collisions: a path claimed by two live owners is the signal
    // that two agents are about to edit the same file.
    const ownersByPath = new Map()
    for (const task of tasks) {
      if (task.status === 'completed' || task.ownerName === null) continue
      for (const scope of task.writeScopes) {
        const owners = ownersByPath.get(scope) ?? new Set()
        owners.add(task.ownerName)
        ownersByPath.set(scope, owners)
      }
    }
    const files = []
    for (const [path, owners] of ownersByPath) {
      files.push({ path, agents: [...owners], conflict: owners.size >= 2 })
    }
    files.sort((a, b) => Number(b.conflict) - Number(a.conflict))

    const activity = tracker.activity
      .filter((entry) => memberById.size === 0 || memberById.has(entry.sessionId) || entry.sessionId === leadId)
      .slice(0, MAX_ACTIVITY)
      .map((entry) => ({
        at: entry.at,
        kind: entry.kind,
        agent: nameById.get(entry.sessionId) ?? (entry.sessionId === leadId ? 'lead' : 'DSH'),
        agentId: entry.sessionId,
        text: entry.text,
        detail: entry.detail,
      }))

    // "What is this member responsible for in this project?" DSH does not
    // project the spawn description, so derive a short line from the work we
    // can observe: their task subjects, else the files they touched.
    const subjectsByOwner = new Map()
    for (const task of tasks) {
      if (task.owner === null || task.subject === '') continue
      const list = subjectsByOwner.get(task.owner) ?? []
      if (!list.includes(task.subject)) list.push(task.subject)
      subjectsByOwner.set(task.owner, list)
    }
    const pathsByAgent = new Map()
    const FILE_PATH = /^\/?[\w@.-]+(?:\/[\w@.-]+)+\/?$/
    for (const entry of tracker.activity) {
      if (entry.kind !== 'tool' || !entry.detail) continue
      // only real paths count: commands, JSON and prose must not become the
      // "responsible for" line
      const detail = entry.detail.trim()
      if (!FILE_PATH.test(detail)) continue
      const list = pathsByAgent.get(entry.sessionId) ?? []
      if (!list.includes(detail)) list.push(detail)
      if (list.length > 3) list.pop()
      pathsByAgent.set(entry.sessionId, list)
    }
    for (const member of members) {
      const subjects = subjectsByOwner.get(member.id) ?? []
      if (subjects.length > 0) {
        member.focus = truncate(subjects.slice(0, 2).join(' · '), 44)
        continue
      }
      const paths = (pathsByAgent.get(member.id) ?? []).slice(0, 2)
      member.focus = paths.length === 0 ? '' : truncate(paths.join(' · '), 44)
    }

    const session = active === null
      ? null
      : {
        id: active.id,
        title: active.title,
        running: active.running,
        turn: active.turn,
        startedAt: active.startedAt,
        elapsedMs: active.running && active.startedAt > 0 ? Math.max(0, now - active.startedAt) : 0,
        percent: active.percent,
        completed: active.completed,
        total: active.total,
        plan: { steps: active.steps },
        stats: active.stats,
        model: active.model,
        live: sessionToAgent.has(active.id) || safe(() => ctx.agents.get(active.id) != null, false),
      }

    return {
      ok: true,
      plugin: name,
      version: PLUGIN_VERSION,
      now,
      mode: 'desktop',
      session,
      team: { members, tasks },
      sessions: ranked.slice(0, 12).map((view) => ({
        id: view.id,
        title: view.title,
        running: view.running,
        percent: view.percent,
        lastAt: view.lastAt,
        live: sessionToAgent.has(view.id) || safe(() => ctx.agents.get(view.id) != null, false),
      })),
      activity,
      files,
      cards: await cards.snapshot(),
      approvals: [...approvals.values()].sort((a, b) => a.expiresAt - b.expiresAt).map(approvalView),
      aliases,
    }
  }

  // -- outbound actions ----------------------------------------------------

  /**
   * Append one user-initiated write to the local audit trail. Best effort: a
   * logging failure must never fail the action the user asked for.
   */
  function audit(action, sessionId, detail) {
    try {
      mkdirSync(COCKPIT_DIR, { recursive: true })
      appendFileSync(AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), action, sessionId, ...detail }) + '\n')
      const size = safe(() => statSync(AUDIT_FILE).size, 0)
      if (size > AUDIT_MAX_BYTES) {
        const lines = readFileSync(AUDIT_FILE, 'utf8').split('\n').filter(Boolean).slice(-AUDIT_KEEP_LINES)
        writeFileSync(AUDIT_FILE, lines.join('\n') + '\n')
      }
    } catch {
      /* audit is best effort */
    }
  }

  /** Resolve a live agent and reject sessions the deck must not write to. */
  function actionAgent(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null
    let agent = safe(() => ctx.agents.get(sessionId), null)
    if (agent === null || agent === undefined) {
      const memberId = sessionToAgent.get(sessionId) ?? null
      agent = memberId === null ? null : safe(() => ctx.agents.get(memberId), null)
    }
    if (agent === null || agent === undefined) return null
    return typeof agent === 'object' ? agent : null
  }

  /** Reject one action attempt and leave a line in the audit trail. */
  function rejectAction(res, action, sessionId, status, reason) {
    audit(action, sessionId, { ok: false, error: reason })
    return sendJson(res, status, { ok: false, error: reason })
  }

  // -- approvals -----------------------------------------------------------

  /**
   * Pending approval decisions. The plugin registers itself on the
   * `approval/request` waterfall ahead of the browser bridge, so a connected
   * deck can answer directly; everything else (no client, full queue, timeout,
   * signal abort) calls `next()` and the workspace dialog takes over.
   */
  const approvals = new Map()
  let approvalSeq = 0

  function approvalView(slot) {
    return {
      id: slot.id,
      sessionId: slot.sessionId,
      sessionTitle: slot.sessionTitle,
      toolName: slot.toolName,
      label: slot.label,
      memberId: slot.memberId,
      memberName: slot.memberName,
      callId: slot.callId,
      reason: slot.reason,
      detail: slot.detail,
      requestedAt: slot.requestedAt,
      expiresAt: slot.expiresAt,
    }
  }

  /** Look an agent id up in any live team roster, for the approval requester line. */
  function memberNameOf(agentId) {
    for (const session of safe(() => ctx.sessions.list(), [])) {
      const team = safe(() => ctx.sessionProjections.snapshot(session, ['agentTeam'])?.values?.agentTeam, null)
      for (const member of Array.isArray(team?.members) ? team.members : []) {
        if (text(member.id) === agentId) return text(member.name) || null
      }
    }
    return null
  }

  function settleApproval(id, decision) {
    const slot = approvals.get(id)
    if (slot === undefined) return false
    approvals.delete(id)
    clearTimeout(slot.timer)
    safe(() => slot.signal?.removeEventListener?.('abort', slot.onAbort))
    if (decision === 'allowed-once' || decision === 'rejected') {
      slot.resolve(decision)
    } else if (decision === 'cancelled') {
      slot.resolve('cancelled')
    } else {
      // timed out or explicitly handed back: let the native asker decide
      slot.resolve(safe(() => slot.next(), () => 'unavailable'))
    }
    scheduleBroadcast()
    scheduleBridge()
    return true
  }

  function handleApproval(request, next) {
    if (process.env.DSH_COCKPIT_APPROVALS === '0') return next()
    if (sseClients.size === 0) return next()
    if (approvals.size >= APPROVAL_MAX) return next()
    const session = safe(() => request?.agent?.session ?? null, null)
    if (session === null) return next()

    const id = `apr-${++approvalSeq}`
    const sessionId = safe(() => String(session.id), '')
    const title = safe(() => ctx.sessionProjections.snapshot(session, ['title'])?.values?.title, '')
    const callId = text(request.callId)
    const known = callId === '' ? null : tracker.calls.get(callId) ?? null
    const toolName = text(request.toolName) || known?.tool || ''
    const memberId = text(request?.agent?.id)
    const slot = {
      id,
      next,
      sessionId,
      sessionTitle: truncate(title, 40) || null,
      toolName,
      label: toolLabel(toolName),
      memberId,
      memberName: memberId === '' ? null : safe(() => memberNameOf(memberId), null),
      callId,
      reason: truncate(request.reason, 160),
      detail: known?.detail ?? '',
      requestedAt: Date.now(),
      expiresAt: Date.now() + APPROVAL_HOLD_MS,
      timer: null,
      signal: request?.signal,
      onAbort: null,
    }
    slot.timer = setTimeout(() => settleApproval(id, 'timeout'), APPROVAL_HOLD_MS)
    slot.timer.unref?.()
    slot.onAbort = () => settleApproval(id, 'cancelled')
    safe(() => slot.signal?.addEventListener?.('abort', slot.onAbort, { once: true }))
    approvals.set(id, slot)
    void broadcast()
    scheduleBridge()
    return new Promise((resolve) => {
      slot.resolve = resolve
    })
  }

  ctx.on('approval/request', handleApproval)

  // -- push ----------------------------------------------------------------

  async function broadcast() {
    if (sseClients.size === 0) return
    const frames = new Map()
    for (const [res, selection] of sseClients) {
      const key = typeof selection === 'string' ? selection : ''
      let frame = frames.get(key)
      if (frame === undefined) {
        try {
          frame = `event: state\ndata: ${JSON.stringify(await buildState(key === '' ? null : key))}\n\n`
        } catch {
          frame = ''
        }
        frames.set(key, frame)
      }
      if (frame === '') continue
      try {
        res.write(frame)
      } catch {
        sseClients.delete(res)
      }
    }
  }

  const scheduleBroadcast = debounce(broadcast, 120)

  // -- HUD bridge ----------------------------------------------------------
  //
  // The desktop capsule runs as its own process and cannot call into
  // the plugin, so it polls this small JSON file. Only aggregate counters and
  // the deck URL live here - no titles of files, no message text, no tokens.
  let bridgeAt = 0
  let bridgeLast = ''

  function bridgeOrigin() {
    const origin = safe(() => text(ctx.webServer.getOrigin()), '')
    return origin === '' ? '' : origin.replace(/\/+$/, '')
  }

  async function buildBridgePayload() {
    const origin = bridgeOrigin()
    if (settings.hudBridge === false) {
      return { v: 1, at: Date.now(), enabled: false, cockpitUrl: origin === '' ? '' : `${origin}/cockpit/` }
    }
    const state = await buildState(null)
    const members = Array.isArray(state.team?.members) ? state.team.members : []
    const running = members.filter((member) => member.running === true).length
    const session = state.session
    return {
      v: 1,
      at: Date.now(),
      enabled: true,
      cockpitUrl: origin === '' ? '' : `${origin}/cockpit/`,
      session: session === null
        ? null
        : { id: text(session.id), title: text(session.title), running: session.running === true },
      team: { running, total: members.length },
      approvals: Array.isArray(state.approvals) ? state.approvals.length : 0,
      round: session === null
        ? null
        : {
          title: text(session.title),
          percent: typeof session.percent === 'number' ? session.percent : null,
          done: Number(session.completed) || 0,
          total: Number(session.total) || 0,
          running: session.running === true,
        },
    }
  }

  async function pushBridge(force = false) {
    const now = Date.now()
    if (!force && now - bridgeAt < BRIDGE_MIN_MS) return
    bridgeAt = now
    try {
      const payload = await buildBridgePayload()
      const encoded = JSON.stringify(payload)
      if (encoded === bridgeLast) return
      bridgeLast = encoded
      ensureDir()
      const tmp = `${HUD_FILE}.tmp`
      writeFileSync(tmp, encoded, 'utf8')
      renameSync(tmp, HUD_FILE)
    } catch {
      /* the capsule simply keeps the previous snapshot */
    }
  }

  const scheduleBridge = debounce(() => { void pushBridge(true) }, 200)

  // -- built-in desktop capsule (v0.8) -------------------------------------
  //
  // The capsule used to be a separate plugin that owned its own
  // process and state file. It now ships inside this plugin: the host writes a
  // small state frame (active session, steps, percent, elapsed) every second
  // and on every event, then supervises the WPF overlay in capsule/overlay.ps1.
  // One install therefore gives both the deck and the desktop capsule.
  let capsuleChild = null
  let capsuleRestart = null
  let capsuleStopping = false
  let capsuleStartedAt = 0
  let capsuleWrittenAt = 0
  let capsuleWrites = 0
  let capsuleLastError = ''
  let capsuleLastFrame = ''
  let capsulePushedAt = 0

  const capsuleSupported = process.platform === 'win32' && existsSync(CAPSULE_SCRIPT)
  const capsuleEnabled = () => settings.capsule !== false

  function legacyOverlaySeen() {
    return safe(() => Date.now() - statSync(LEGACY_HUD_HEARTBEAT).mtimeMs < 20_000, false)
  }

  /** Fold the deck's state into the tiny frame the overlay understands. */
  function capsuleView(state) {
    const session = state.session
    if (session === null || typeof session !== 'object') return { active: null }
    const steps = Array.isArray(session.plan?.steps) ? session.plan.steps.slice(0, 12) : []
    const completed = Number(session.completed) || 0
    const total = Number(session.total) || 0
    const running = session.running === true
    const allDone = total > 0 && completed >= total
    const status = allDone ? 'done' : total === 0 ? 'noplan' : running ? 'charging' : 'waiting'
    const current = steps.find((step) => step.status === 'in_progress')
      ?? steps.find((step) => step.status === 'pending')
      ?? null
    return {
      active: {
        sessionId: text(session.id),
        title: text(session.title) || null,
        status,
        steps: steps.map((step) => ({
          text: text(step.text),
          status: step.status === 'in_progress' || step.status === 'completed' ? step.status : 'pending',
        })),
        total,
        completed,
        percent: typeof session.percent === 'number' ? session.percent : null,
        currentStep: current === null ? null : text(current.text),
        running,
        elapsedMs: Number(session.elapsedMs) || 0,
        lastAt: state.now,
      },
    }
  }

  function writeCapsuleState(state) {
    if (!capsuleSupported || !capsuleEnabled()) return
    try {
      mkdirSync(CAPSULE_DIR, { recursive: true })
      const encoded = JSON.stringify({ v: 1, at: state.now, ...capsuleView(state) })
      if (encoded === capsuleLastFrame) return
      capsuleLastFrame = encoded
      const tmp = `${CAPSULE_STATE_FILE}.tmp`
      writeFileSync(tmp, encoded, 'utf8')
      renameSync(tmp, CAPSULE_STATE_FILE)
      capsuleWrites += 1
      capsuleWrittenAt = Date.now()
    } catch {
      /* the capsule keeps the previous frame */
    }
  }

  async function pushCapsule(force = false) {
    if (!capsuleSupported || !capsuleEnabled()) return
    const now = Date.now()
    if (!force && now - capsulePushedAt < CAPSULE_MIN_MS) return
    capsulePushedAt = now
    try {
      writeCapsuleState(await buildState(null))
    } catch {
      /* best effort */
    }
  }

  const scheduleCapsule = debounce(() => { void pushCapsule(true) }, CAPSULE_MIN_MS)

  function capsuleStatus() {
    const heartbeat = safe(() => statSync(CAPSULE_HEARTBEAT_FILE).mtimeMs, 0)
    return {
      supported: capsuleSupported,
      enabled: capsuleEnabled(),
      running: capsuleChild !== null && capsuleChild.exitCode === null,
      pid: capsuleChild === null ? null : capsuleChild.pid ?? null,
      startedAt: capsuleStartedAt,
      statePath: CAPSULE_STATE_FILE,
      bridgePath: HUD_FILE,
      scriptPath: CAPSULE_SCRIPT,
      writtenAt: capsuleWrittenAt,
      heartbeatAt: Number(heartbeat) || 0,
      writes: capsuleWrites,
      legacyDetected: legacyOverlaySeen(),
      lastError: capsuleLastError,
    }
  }

  function scheduleCapsuleRestart() {
    if (capsuleRestart !== null || capsuleStopping || !capsuleEnabled()) return
    capsuleRestart = setTimeout(() => {
      capsuleRestart = null
      startCapsule()
    }, CAPSULE_RESTART_MS)
    capsuleRestart.unref?.()
  }

  function startCapsule() {
    if (!capsuleSupported || !capsuleEnabled()) return capsuleStatus()
    if (capsuleChild !== null && capsuleChild.exitCode === null) return capsuleStatus()
    // The legacy dsh-hud plugin may still be running its own overlay process;
    // a second capsule would show two HUDs, so wait for it to go away first.
    if (legacyOverlaySeen()) {
      capsuleLastError = 'legacy desktop HUD overlay is running'
      scheduleCapsuleRestart()
      return capsuleStatus()
    }
    if (!existsSync(CAPSULE_SCRIPT)) {
      capsuleLastError = 'capsule/overlay.ps1 is missing'
      return capsuleStatus()
    }
    try {
      mkdirSync(CAPSULE_DIR, { recursive: true })
      capsuleStopping = false
      if (CAPSULE_DRY_RUN) {
        capsuleChild = { pid: 4242, exitCode: null, kill() { this.exitCode = 0 }, on() { return this } }
        capsuleStartedAt = Date.now()
        capsuleLastError = ''
        return capsuleStatus()
      }
      capsuleChild = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        CAPSULE_SCRIPT,
        '-ParentPid',
        String(process.pid),
        '-RuntimeDir',
        CAPSULE_DIR,
      ], { stdio: 'ignore', windowsHide: true })
      capsuleStartedAt = Date.now()
      capsuleLastError = ''
      capsuleChild.on('exit', () => {
        capsuleChild = null
        scheduleCapsuleRestart()
      })
      capsuleChild.on('error', (error) => {
        capsuleLastError = String(error?.message ?? error)
        capsuleChild = null
        scheduleCapsuleRestart()
      })
    } catch (error) {
      capsuleLastError = String(error?.message ?? error)
      scheduleCapsuleRestart()
    }
    return capsuleStatus()
  }

  function stopCapsule() {
    capsuleStopping = true
    if (capsuleRestart !== null) {
      clearTimeout(capsuleRestart)
      capsuleRestart = null
    }
    if (capsuleChild !== null) {
      safe(() => capsuleChild.kill())
      capsuleChild = null
    }
    return capsuleStatus()
  }

  function setCapsuleEnabled(value) {
    settings.capsule = value
    saveSettings(settings)
    bridgeLast = ''
    capsuleLastFrame = ''
    capsuleWrittenAt = 0
    if (value) {
      void pushBridge(true)
      void pushCapsule(true)
      startCapsule()
    } else {
      stopCapsule()
    }
    return capsuleStatus()
  }

  tracker.changed = () => {
    scheduleBroadcast()
    scheduleBridge()
    scheduleCapsule()
  }

  // Root-session events arrive live through the hook; a teammate's session is
  // not observable that way, so those are tailed from their own session logs.
  const lastSeq = new Map()
  // member ids are agent ids; sessions are what the deck lists and what write
  // actions address. Keep both directions so either id can resolve an agent.
  const agentToSession = new Map()
  const sessionToAgent = new Map()

  /** Sessions worth watching: every live one, plus each team member's session. */
  function watchedSessions() {
    const out = new Map()
    for (const session of safe(() => ctx.sessions.list(), [])) out.set(String(session.id), session)
    for (const session of out.values()) {
      const team = safe(() => ctx.sessionProjections.snapshot(session, ['agentTeam'])?.values?.agentTeam, null)
      for (const member of Array.isArray(team?.members) ? team.members : []) {
        const id = text(member.id)
        if (id === '' || out.has(id)) continue
        const child = safe(() => ctx.agents.get(id)?.session ?? null, null)
        if (child !== null) {
          const childId = safe(() => String(child.id), '')
          if (childId !== '') {
            agentToSession.set(id, childId)
            sessionToAgent.set(childId, id)
          }
          out.set(id, child)
        }
      }
    }
    return [...out.values()]
  }

  ctx.on('session/event', (session, event) => {
    tracker.feed(session, event)
    lastSeq.set(safe(() => String(session.id), ''), safe(() => Number(session.seq) || 0, 0))
  })

  const poll = setInterval(() => {
    for (const session of watchedSessions()) {
      const id = safe(() => String(session.id), '')
      if (id === '') continue
      const known = lastSeq.get(id)
      const end = safe(() => Number(session.seq) || 0, 0)
      if (known === undefined) {
        lastSeq.set(id, end)
        continue
      }
      if (end <= known) continue
      const events = safe(() => session.snapshotEvents(known, end), null)
      if (Array.isArray(events)) {
        for (const event of events) tracker.feed(session, event)
      }
      lastSeq.set(id, end)
    }
  }, 500)
  poll.unref?.()

  const tick = setInterval(() => { void broadcast(); void pushBridge() }, TICK_MS)
  tick.unref?.()
  const capsuleTick = setInterval(() => { void pushCapsule() }, CAPSULE_TICK_MS)
  capsuleTick.unref?.()

  // -- HTTP ----------------------------------------------------------------

  function sendJson(res, status, value) {
    if (res.headersSent) return
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  function sameOrigin(req) {
    const origin = text(req.headers.origin)
    if (origin === '') return true
    const host = text(req.headers.host)
    return host !== '' && (origin === `http://${host}` || origin === `https://${host}`)
  }

  function readBody(req) {
    return new Promise((ok, fail) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          fail(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          ok(raw === '' ? {} : JSON.parse(raw))
        } catch {
          fail(new Error('invalid JSON'))
        }
      })
      req.on('error', fail)
    })
  }

  /** Serve one file from public/, with a small mtime cache. */
  function serveStatic(res, relPath) {
    const clean = normalize(relPath).replace(/^([/\\])+/, '')
    if (clean === '' || clean.split(/[/\\]/).includes('..')) return false
    const file = resolve(PUBLIC_DIR, clean)
    if (!file.startsWith(PUBLIC_DIR)) return false
    let stat = null
    try {
      stat = statSync(file)
    } catch {
      return false
    }
    if (!stat.isFile()) return false
    const type = EXT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream'
    let cached = fileCache.get(file)
    if (cached === undefined || cached.mtimeMs !== stat.mtimeMs) {
      cached = { mtimeMs: stat.mtimeMs, type, body: readFileSync(file) }
      fileCache.set(file, cached)
    }
    res.writeHead(200, {
      'Content-Type': cached.type,
      'Cache-Control': 'no-cache',
      'Content-Length': cached.body.length,
    })
    res.end(cached.body)
    return true
  }

  /** One dispatcher for the whole /cockpit/ prefix. */
  async function cockpitRoute(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      if (path === '/cockpit/api/state' && req.method === 'GET') {
        return sendJson(res, 200, await buildState(url.searchParams.get('s')))
      }
      if (path === '/cockpit/api/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        const selection = url.searchParams.get('s')
        res.write('retry: 2000\n\n')
        res.write(`event: state\ndata: ${JSON.stringify(await buildState(selection))}\n\n`)
        sseClients.set(res, selection)
        req.on('close', () => sseClients.delete(res))
        return
      }
      if (path === '/cockpit/api/approvals') {
        if (req.method !== 'GET') {
          res.writeHead(405)
          return res.end()
        }
        return sendJson(res, 200, { ok: true, approvals: [...approvals.values()].map(approvalView) })
      }
      if (path === '/cockpit/api/approvals/simulate' && req.method === 'POST') {
        if (!APPROVAL_DEBUG) return sendJson(res, 404, { ok: false, error: 'not found' })
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const active = safe(() => ctx.sessions.list(), []).find((session) => tracker.sessions.get(String(session.id))?.running)
          ?? safe(() => ctx.sessions.list(), [])[0]
          ?? null
        if (active === null) return sendJson(res, 409, { ok: false, error: 'no session to attach to' })
        // A simulated ask must not depend on a client already being attached;
        // a throwaway SSE slot satisfies the "deck can see it" gate.
        const fakeClient = { write() {} }
        sseClients.set(fakeClient, null)
        try {
          handleApproval({
            agent: { session: active },
            toolName: 'ops_bash',
            callId: 'call-simulated',
            reason: '演示：需要在工作区外写入 pnpm 依赖缓存',
            signal: new AbortController().signal,
          }, () => Promise.resolve('unavailable'))
        } finally {
          sseClients.delete(fakeClient)
        }
        return sendJson(res, 200, { ok: true })
      }
      if (path.startsWith('/cockpit/api/approvals/')) {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') {
          res.writeHead(405)
          return res.end()
        }
        const id = decodeURIComponent(path.slice('/cockpit/api/approvals/'.length))
        const body = await readBody(req)
        const decision = text(body.decision)
        if (decision !== 'allow-once' && decision !== 'reject') {
          return sendJson(res, 400, { ok: false, error: 'decision must be allow-once or reject' })
        }
        const settled = settleApproval(id, decision === 'allow-once' ? 'allowed-once' : 'rejected')
        audit('approval', id, { decision, remote: req.cockpitRemote === true, ok: settled })
        if (!settled) return sendJson(res, 404, { ok: false, error: 'unknown or expired approval' })
        return sendJson(res, 200, { ok: true, decision })
      }

      if (path === '/cockpit/api/remote') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'GET') {
          res.writeHead(405)
          return res.end()
        }
        return sendJson(res, 200, remote.status())
      }
      if (path === '/cockpit/api/remote/config' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const body = await readBody(req)
        const result = remote.setPublicUrl(body.publicUrl)
        return sendJson(res, result.ok ? 200 : 400, result)
      }
      if (path === '/cockpit/api/remote/tunnel') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'GET') {
          res.writeHead(405)
          return res.end()
        }
        return sendJson(res, 200, remote.tunnel())
      }
      if (path === '/cockpit/api/remote/start' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        try {
          return sendJson(res, 200, await remote.start())
        } catch (error) {
          return sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (path === '/cockpit/api/remote/stop' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        return sendJson(res, 200, remote.stop(true))
      }
      if (path === '/cockpit/api/remote/pair/new' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (!remote.status().running) return sendJson(res, 409, { ok: false, error: 'remote access is not running' })
        remote.newCode()
        return sendJson(res, 200, remote.status())
      }
      if (path === '/cockpit/api/remote/sessions') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'DELETE') {
          res.writeHead(405)
          return res.end()
        }
        return sendJson(res, 200, remote.revoke(text(url.searchParams.get('id'))))
      }

      if (path === '/cockpit/api/capsule') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (!capsuleSupported) {
          return sendJson(res, 501, {
            ok: false,
            supported: false,
            enabled: capsuleEnabled(),
            error: 'the desktop capsule is only available on Windows',
          })
        }
        if (req.method === 'GET') return sendJson(res, 200, { ok: true, ...capsuleStatus() })
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (typeof body.enabled !== 'boolean') {
            return sendJson(res, 400, { ok: false, error: 'enabled must be a boolean' })
          }
          return sendJson(res, 200, { ok: true, ...setCapsuleEnabled(body.enabled) })
        }
        res.writeHead(405)
        return res.end()
      }

      if (path === '/cockpit/api/hud-bridge') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method === 'GET') {
          const exists = safe(() => statSync(HUD_FILE).mtimeMs, 0)
          return sendJson(res, 200, {
            ok: true,
            enabled: settings.hudBridge !== false,
            path: HUD_FILE,
            writtenAt: Number(exists) || 0,
            staleMs: BRIDGE_STALE_MS,
            bridge: safe(() => JSON.parse(readFileSync(HUD_FILE, 'utf8')), null),
          })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (typeof body.enabled !== 'boolean') {
            return sendJson(res, 400, { ok: false, error: 'enabled must be a boolean' })
          }
          settings.hudBridge = body.enabled
          saveSettings(settings)
          bridgeLast = ''
          void pushBridge(true)
          return sendJson(res, 200, { ok: true, enabled: settings.hudBridge })
        }
        res.writeHead(405)
        return res.end()
      }

      if (path === '/cockpit/api/aliases') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method === 'GET') return sendJson(res, 200, { ok: true, aliases })
        if (req.method === 'POST') {
          const body = await readBody(req)
          const id = text(body.id).trim()
          if (id === '') return sendJson(res, 400, { ok: false, error: 'id is required' })
          const displayName = truncate(body.name ?? body.alias, 12)
          const color = COLORS.has(body.color) ? body.color : (aliases[id]?.color ?? 'blue')
          const emoji = truncate(body.emoji, 8)
          if (displayName === '' && emoji === '') delete aliases[id]
          else aliases[id] = { name: displayName, color, emoji }
          saveAliases(aliases)
          scheduleBroadcast()
          return sendJson(res, 200, { ok: true, aliases })
        }
        if (req.method === 'DELETE') {
          const id = text(url.searchParams.get('id')).trim()
          if (id !== '') delete aliases[id]
          saveAliases(aliases)
          scheduleBroadcast()
          return sendJson(res, 200, { ok: true, aliases })
        }
        res.writeHead(405)
        return res.end()
      }

      if (path === '/cockpit/api/actions/send' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const body = await readBody(req)
        const sessionId = text(body.sessionId).trim()
        const message = text(body.text).trim()
        const mode = body.mode === 'steer' ? 'steer' : 'queue'
        if (sessionId === '') return rejectAction(res, 'send', sessionId, 400, 'sessionId is required')
        if (message === '') return rejectAction(res, 'send', sessionId, 400, 'text is required')
        if (message.length > MAX_ACTION_TEXT) return rejectAction(res, 'send', sessionId, 400, 'text is too long')
        const agent = actionAgent(sessionId)
        if (agent === null) return rejectAction(res, 'send', sessionId, 404, 'session not found')
        const payload = {
          role: 'user',
          content: [{ type: 'text', text: message }],
          source: { kind: 'user' },
          id: randomUUID(),
        }
        try {
          if (mode === 'steer') agent.steer(payload)
          else agent.followup(payload)
        } catch (error) {
          audit('send', sessionId, { mode, ok: false, remote: req.cockpitRemote === true, error: text(error instanceof Error ? error.message : error) })
          return sendJson(res, 409, { ok: false, error: 'the session did not accept the message' })
        }
        audit('send', sessionId, { mode, ok: true, remote: req.cockpitRemote === true, length: message.length })
        scheduleBroadcast()
        return sendJson(res, 200, { ok: true, mode })
      }
      if (path === '/cockpit/api/actions/interrupt' && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const body = await readBody(req)
        const sessionId = text(body.sessionId).trim()
        if (sessionId === '') return rejectAction(res, 'interrupt', sessionId, 400, 'sessionId is required')
        const agent = actionAgent(sessionId)
        if (agent === null) return rejectAction(res, 'interrupt', sessionId, 404, 'session not found')
        if (typeof agent.cancel !== 'function') return rejectAction(res, 'interrupt', sessionId, 409, 'session cannot be interrupted')
        const live = tracker.sessions.get(sessionId) ?? null
        if (live !== null && live.running !== true) return rejectAction(res, 'interrupt', sessionId, 409, 'session is not running')
        try {
          agent.cancel({ kind: 'user' }, { keepInbox: true })
        } catch (error) {
          audit('interrupt', sessionId, { ok: false, remote: req.cockpitRemote === true, error: text(error instanceof Error ? error.message : error) })
          return sendJson(res, 409, { ok: false, error: 'the session did not accept the interrupt' })
        }
        audit('interrupt', sessionId, { ok: true, remote: req.cockpitRemote === true })
        scheduleBroadcast()
        return sendJson(res, 200, { ok: true })
      }

      const cardAction = /^\/cockpit\/api\/cards\/([a-z0-9][a-z0-9._-]{1,40})\/action$/.exec(path)
      if (cardAction !== null && req.method === 'POST') {
        if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const body = await readBody(req)
        const actionId = text(body.actionId).trim()
        if (actionId === '') return sendJson(res, 400, { ok: false, error: 'actionId is required' })
        const outcome = await cards.runAction(cardAction[1], actionId)
        if (outcome.ok) scheduleBroadcast()
        return sendJson(res, outcome.status, outcome.ok
          ? { ok: true, result: outcome.result }
          : { ok: false, error: outcome.error })
      }
      if (path === '/cockpit/api/cards' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          version: CARD_API_VERSION,
          cards: [...cards.cards.values()].map((card) => ({ id: card.id, title: card.title, order: card.order, actions: card.actions })),
        })
      }

      if (path === '/cockpit/data/mock' && req.method === 'GET') {
        // Dev aid: always 404 in the real plugin.
        res.writeHead(404)
        return res.end()
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        return res.end()
      }
      const rel = path.startsWith('/cockpit/') ? path.slice('/cockpit/'.length) : ''
      if (rel !== '' && serveStatic(res, rel)) return
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  function indexRoute(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      return res.end()
    }
    if (!serveStatic(res, 'index.html')) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('cockpit UI missing: public/index.html')
    }
  }

  // Trailing slash matters: the page uses relative asset URLs, so /cockpit must
  // bounce to /cockpit/ or ./app.js would resolve to /app.js.
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/cockpit',
      handler: (req, res) => {
        res.writeHead(302, { Location: '/cockpit/' })
        res.end()
      },
    }),
    'dsh-cockpit: /cockpit',
  )
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/cockpit/', handler: indexRoute }), 'dsh-cockpit: /cockpit/')
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/cockpit', handler: cockpitRoute }),
    'dsh-cockpit: /cockpit prefix',
  )

  // -- lifecycle -----------------------------------------------------------

  if (capsuleEnabled() && capsuleSupported) {
    void pushBridge(true)
    void pushCapsule(true)
    startCapsule()
  }

  ctx.effect(() => () => {
    remote.close()
    stopCapsule()
    clearInterval(tick)
    clearInterval(capsuleTick)
    for (const res of [...sseClients.keys()]) {
      try {
        res.end()
      } catch {
        /* already closed */
      }
    }
    sseClients.clear()
    fileCache.clear()
  }, 'dsh-cockpit: shutdown')

  // Log the mount point once so `dsh web` users can find the deck.
  safe(() => {
    const origin = ctx.webServer.getOrigin()
    ctx.logger?.info?.(`dsh-cockpit: ${origin}/cockpit`)
  })
}

/** Test seam; not part of the plugin surface. */
export const __internals = { Tracker, prettifyModel, toolLabel, toolDetail, isPrivateIp, detectLanIp, sameSecret }
