/**
 * Asset guards (v1.2, item D3).
 *
 * Catches the class of mistakes that syntax checks cannot see:
 *  - `capsule/overlay.ps1` losing its UTF-8 BOM / valid UTF-8 / CRLF endings
 *    (Windows PowerShell 5.1 would misread the Chinese literals; the editor
 *    tooling silently strips BOMs, so this is a real recurring hazard)
 *  - unbalanced braces / parentheses in `public/app.css`
 *  - version drift between package.json, CHANGELOG.md and README.md
 *
 *   node scripts/check-assets.mjs [root]
 *
 * Exits non-zero on the first failed guard so CI (and pre-release checks) fail
 * loudly. The optional root argument exists so the guard itself can be tested
 * against fixture trees.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
let failures = 0
let passes = 0

function ok(name, detail = '') {
  passes += 1
  console.log(`ok   ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

function fail(name, detail = '') {
  failures += 1
  console.log(`FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

// -- capsule/overlay.ps1: BOM + encoding + EOL ---------------------------------
const ps1Path = join(ROOT, 'capsule', 'overlay.ps1')
if (!existsSync(ps1Path)) {
  fail('capsule/overlay.ps1 exists', 'file is missing')
} else {
  const bytes = readFileSync(ps1Path)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (hasBom) ok('overlay.ps1 UTF-8 BOM')
  else fail('overlay.ps1 UTF-8 BOM', 'missing EF BB BF — Windows PowerShell 5.1 misreads the Chinese literals without it')

  let source = null
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('overlay.ps1 valid UTF-8', 'bytes are not valid UTF-8')
  }
  if (source !== null) {
    ok('overlay.ps1 valid UTF-8')
    if (source.includes('\uFFFD')) fail('overlay.ps1 no replacement characters', 'contains U+FFFD — re-save as UTF-8')
    else ok('overlay.ps1 no replacement characters')
    const newlines = (source.match(/\n/g) ?? []).length
    const crlf = (source.match(/\r\n/g) ?? []).length
    if (newlines === crlf) ok('overlay.ps1 consistent line endings', `${crlf} CRLF`)
    else if (crlf === 0) ok('overlay.ps1 consistent line endings', `${newlines} LF — .gitattributes checks this file out as CRLF; PowerShell 5.1 parses either`)
    else fail('overlay.ps1 consistent line endings', `mixed: ${crlf} CRLF, ${newlines - crlf} bare LF`)
    if (/^param\(/m.test(source)) ok('overlay.ps1 starts with a param block')
    else fail('overlay.ps1 starts with a param block', 'expected "param(" near the top; the WPF entry point may be broken')
  }
}

// -- public/app.css: brace / paren balance ------------------------------------
/** Strip CSS comments and quoted strings, then count bracket depth. */
function cssBalance(source) {
  let braces = 0
  let parens = 0
  let i = 0
  let inComment = false
  let quote = ''
  let escaped = false
  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1] ?? ''
    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (quote !== '') {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      i += 1
      continue
    }
    if (char === '/' && next === '*') {
      inComment = true
      i += 2
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      i += 1
      continue
    }
    if (char === '{') braces += 1
    else if (char === '}') braces -= 1
    else if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    if (braces < 0 || parens < 0) return { braces, parens, broken: true }
    i += 1
  }
  return { braces, parens, broken: inComment || quote !== '' }
}
const cssPath = join(ROOT, 'public', 'app.css')
if (!existsSync(cssPath)) {
  fail('public/app.css exists', 'file is missing')
} else {
  const balance = cssBalance(readFileSync(cssPath, 'utf8'))
  if (balance.broken) fail('app.css bracket balance', 'unterminated comment/string or a closing bracket without an opener')
  else if (balance.braces !== 0 || balance.parens !== 0) fail('app.css bracket balance', `braces ${balance.braces}, parens ${balance.parens} (both must be 0)`)
  else ok('app.css bracket balance')
}

// -- version consistency ------------------------------------------------------
const versionOf = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8')).version
let version = null
try {
  version = versionOf('package.json')
  ok('package.json parses', version)
} catch (error) {
  fail('package.json parses', error instanceof Error ? error.message : String(error))
}
if (version !== null) {
  const changelogPath = join(ROOT, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    fail('CHANGELOG.md exists', 'file is missing')
  } else {
    const changelog = readFileSync(changelogPath, 'utf8')
    const heading = /^##\s+(.+)$/m.exec(changelog)?.[1] ?? ''
    if (heading.includes(version)) ok('CHANGELOG top entry matches package version', heading.trim())
    else fail('CHANGELOG top entry matches package version', `top entry is "${heading.trim()}" but package.json says ${version}`)
  }
  const readmePath = join(ROOT, 'README.md')
  if (!existsSync(readmePath)) {
    fail('README.md exists', 'file is missing')
  } else {
    const readme = readFileSync(readmePath, 'utf8')
    const tgz = `dsh-cockpit-${version}.tgz`
    if (readme.includes(tgz)) ok('README install command matches package version', tgz)
    else fail('README install command matches package version', `README does not mention ${tgz}`)
  }
}

if (failures === 0) {
  console.log(`asset checks passed (${passes} guards)`)
  process.exit(0)
}
console.log(`asset checks FAILED (${passes} passed, ${failures} failed)`)
process.exit(1)
