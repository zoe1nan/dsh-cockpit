/**
 * Example Cockpit extension card — live git status of the workspace.
 *
 * This is the smallest useful card: it registers itself with the deck, returns
 * a plain JSON payload on every load, and reacts to one button. It never ships
 * HTML or CSS; the deck owns presentation.
 *
 * Install it next to dsh-cockpit in the same profile and restart DSH. The card
 * shows up on the deck's "extension cards" shelf.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const name = 'dsh-cockpit-example-git'
export const inject = ['cockpit']

const MAX_FILES = 5

async function readStatus() {
  try {
    const { stdout } = await run('git', ['status', '--porcelain', '-b'], {
      cwd: process.cwd(),
      timeout: 1200,
      windowsHide: true,
    })
    return parseStatus(stdout)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not a git repository/i.test(message)) {
      return { kind: 'status', state: 'idle', label: '不是 Git 仓库', detail: process.cwd() }
    }
    return { kind: 'status', state: 'bad', label: 'git 读取失败', detail: message.slice(0, 120) }
  }
}

function parseStatus(stdout) {
  const lines = String(stdout).split('\n').filter(Boolean)
  let branch = '(detached)'
  let ahead = 0
  let behind = 0
  const files = []
  for (const line of lines) {
    // v1 porcelain: "## main...origin/main [ahead 1]" then "XY path"
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const tracking = /^(?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?/.exec(head)
      branch = tracking?.[1] ?? head
      if (tracking?.[2] !== undefined) {
        const [aheadText, behindText] = head.split('ahead ')[1]?.split('behind ') ?? []
        ahead = Number.parseInt(aheadText, 10) || 0
        behind = behindText === undefined ? 0 : (Number.parseInt(behindText, 10) || 0)
      }
      continue
    }
    if (line.length < 3) continue
    const x = line[0]
    const y = line[1]
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ').pop()
    if (path === '') continue
    const staged = x !== ' ' && x !== '?'
    files.push({ path: path.trim(), staged })
  }
  const items = files.slice(0, MAX_FILES).map((file) => ({
    title: file.path,
    detail: file.staged ? '已暂存' : '有改动',
    state: 'warn',
  }))
  const footer = files.length === 0
    ? '工作区干净' + (ahead > 0 ? ' · 领先 ' + ahead : '') + (behind > 0 ? ' · 落后 ' + behind : '')
    : files.length + ' 个文件有改动' + (ahead > 0 ? ' · 领先 ' + ahead : '') + (behind > 0 ? ' · 落后 ' + behind : '')
  if (items.length === 0) {
    return { kind: 'status', state: ahead > 0 || behind > 0 ? 'warn' : 'ok', label: branch, detail: footer }
  }
  return { kind: 'list', items, footer: branch + ' · ' + footer }
}

export function apply(ctx) {
  const dispose = ctx.cockpit.registerCard({
    id: 'git-status',
    title: 'Git 状态',
    subtitle: '当前工作区',
    icon: 'git',
    order: 10,
    load: readStatus,
    actions: [{ id: 'refresh', label: '刷新', style: 'ghost' }],
    onAction: async () => readStatus(),
  })
  ctx.effect(() => () => dispose())
}
