/**
 * Preview smoke test (v1.2, item D2/D3).
 *
 * Boots `scripts/preview.mjs` on a throwaway port, then checks the contract the
 * UI depends on: the page, the state payload (v1.1 shape with `capsule`), the
 * diagnostics mock (8 probes + copyable report), the SSE stream, and that a
 * selected session (`?s=`) is echoed back. Exits non-zero on the first failed
 * check, so CI can run it as a guard.
 *
 *   node scripts/preview-smoke.mjs [port]
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] || process.env.PREVIEW_PORT || 6199)
const BASE = `http://127.0.0.1:${PORT}`
const EXPECTED_CHECKS = ['plugin', 'state', 'stream', 'capsule', 'bridge', 'remote', 'approvals', 'host-api']

let passed = 0
const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`ok   ${name}${detail === '' ? '' : ` — ${detail}`}`)
  } else {
    failures.push(name)
    console.log(`FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

async function fetchJson(path) {
  const response = await fetch(BASE + path, { headers: { accept: 'application/json' } })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: response.status, body, text }
}

async function waitForServer(child) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/cockpit/`)
      if (response.status === 200) return output
    } catch {
      /* not up yet */
    }
    await sleep(120)
  }
  throw new Error(`preview server did not start:\n${output}`)
}

const child = spawn(process.execPath, [join(ROOT, 'scripts', 'preview.mjs'), String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
try {
  serverLog = await waitForServer(child)

  const page = await fetch(`${BASE}/cockpit/`)
  check('page 200', page.status === 200, `HTTP ${page.status}`)
  check('page html', (await page.text()).includes('Cockpit'))

  const state = await fetchJson('/cockpit/api/state')
  check('state 200', state.status === 200, `HTTP ${state.status}`)
  check('state ok', state.body?.ok === true)
  check('state version', state.body?.version === '1.2.1', String(state.body?.version))
  check('state capsule', typeof state.body?.capsule?.id === 'string' && state.body.capsule.id !== '', String(state.body?.capsule?.id))
  check('state session', typeof state.body?.session?.id === 'string' && state.body.session.id !== '', String(state.body?.session?.id))

  const sessions = Array.isArray(state.body?.sessions) ? state.body.sessions : []
  const otherSession = sessions.find((entry) => entry.id !== state.body?.session?.id)
  check('state sessions rail', sessions.length > 1, `${sessions.length} sessions`)
  if (otherSession !== undefined) {
    const selected = await fetchJson(`/cockpit/api/state?s=${encodeURIComponent(otherSession.id)}`)
    check('state ?s= selects session', selected.body?.session?.id === otherSession.id, String(selected.body?.session?.id))
  }

  const hudBridge = await fetchJson('/cockpit/api/hud-bridge')
  check('hud-bridge 200', hudBridge.status === 200, `HTTP ${hudBridge.status}`)
  check('hud-bridge enabled', hudBridge.body?.enabled === true)

  const capsule = await fetchJson('/cockpit/api/capsule')
  check('capsule 200', capsule.status === 200, `HTTP ${capsule.status}`)
  check('capsule supported', capsule.body?.supported === true)

  const diagnostics = await fetchJson('/cockpit/api/diagnostics')
  check('diagnostics 200', diagnostics.status === 200, `HTTP ${diagnostics.status}`)
  check('diagnostics ok', diagnostics.body?.ok === true)
  const checks = Array.isArray(diagnostics.body?.checks) ? diagnostics.body.checks : []
  check('diagnostics 8 checks', checks.length === EXPECTED_CHECKS.length, `${checks.length}`)
  check('diagnostics check ids', JSON.stringify(checks.map((item) => item.id)) === JSON.stringify(EXPECTED_CHECKS), checks.map((item) => item.id).join(','))
  check('diagnostics status', ['ok', 'warn', 'fail'].includes(diagnostics.body?.status), String(diagnostics.body?.status))
  check('diagnostics report', String(diagnostics.body?.report).startsWith(`dsh-cockpit 1.2.0 诊断报告`))
  check('diagnostics totals', diagnostics.body?.totals?.sessions === sessions.length, String(diagnostics.body?.totals?.sessions))
  check('diagnostics stream warn', checks.find((item) => item.id === 'stream')?.status === 'warn')
  check('diagnostics deck', diagnostics.body?.deck?.id === state.body?.session?.id, String(diagnostics.body?.deck?.id))

  // An open SSE client must flip the stream probe to ok; abort afterwards.
  const controller = new AbortController()
  const stream = await fetch(`${BASE}/cockpit/api/stream`, { signal: controller.signal }).catch(() => null)
  check('stream 200', stream?.status === 200, `HTTP ${stream?.status}`)
  const streamed = stream === null ? '' : await stream.body.getReader().read().then((part) => (part.done ? '' : new TextDecoder().decode(part.value))).catch(() => '')
  check('stream first frame', streamed.includes('event: state'), streamed.slice(0, 40).replaceAll('\n', '\\n'))
  await sleep(150)
  const diagnosticsWithClient = await fetchJson('/cockpit/api/diagnostics')
  check('diagnostics stream ok with client', diagnosticsWithClient.body?.checks?.find((item) => item.id === 'stream')?.status === 'ok')
  controller.abort()

  const missing = await fetch(`${BASE}/cockpit/api/nope`)
  check('unknown route 404', missing.status === 404, `HTTP ${missing.status}`)
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`)
} finally {
  child.kill()
}

if (failures.length === 0) {
  console.log(`preview smoke passed (${passed} checks)`)
  process.exit(0)
}
console.log(`preview smoke FAILED (${passed} passed, ${failures.length} failed): ${failures.join('; ')}`)
if (serverLog !== '') console.log(serverLog)
process.exit(1)
