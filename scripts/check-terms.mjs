// Terminology guard: one word per concept across README, CHANGELOG, docs and
// the user-facing frontend strings. See docs/TERMS.md for the full table.
// Usage: node scripts/check-terms.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const DOC_PAGES = readdirSync(join(ROOT, 'docs'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => join('docs', name))
const FILES = ['README.md', 'CHANGELOG.md', ...DOC_PAGES, 'public/app.js']
const fileKey = (rel) => rel.split('\\').join('/')

// The glossary itself quotes the discouraged words on purpose.
const ALLOW = new Set(['docs/TERMS.md'])

const RULES = [
  { id: 'copy', re: /拷贝/g, hint: '统一用「复制」' },
  { id: 'stream', re: /活动流/g, hint: '统一用「实时流」' },
  { id: 'board', re: /看板/g, hint: '统一用「任务板」（界面整体称「指挥台」/「面板」）' },
  { id: 'chat', re: /正在运行的对话|该对话/g, hint: '统一用「会话」' },
  { id: 'hud-bridge', re: /HUD 桥(?! 接)/g, hint: '统一用「HUD 数据桥」' },
]

let failures = 0
for (const rel of FILES) {
  if (ALLOW.has(fileKey(rel))) continue
  const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    // Term-mapping lines quote "old→new" pairs on purpose (e.g. ROADMAP rows).
    if (line.includes('→')) return
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      if (!rule.re.test(line)) continue
      failures += 1
      console.log(`FAIL ${rel}:${index + 1} ${rule.id} — ${rule.hint}`)
      console.log(`     ${line.trim().slice(0, 120)}`)
    }
  })
}

if (failures > 0) {
  console.log(`\nterm checks failed (${failures} violation${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log(`term checks passed (${RULES.length} rules, ${FILES.length} files)`)
