import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as entryPoint from '../src/index.js'
import { checkSyntax, findScripts } from '../scripts/syntax-check.mjs'

// The published surface, pinned. `src/index.js` is what `import 'claude-jobs'`
// resolves to and no other test goes through it, so a re-export that stops
// resolving -- a rename in schedulers.js, say -- would break every consumer
// while the suite stayed green.
const PUBLISHED_EXPORTS = [
  'buildJob',
  'cronLine',
  'crontabWithout',
  'defaultScheduler',
  'isInstalled',
  'main',
  'parseArgs',
  'parseTime',
  'render',
  'renderTemplate',
  'shellQuote',
  'writeRunner',
  'writeSchedulerFiles',
]

test('src/index.js exports exactly the published names', () => {
  // Equality, not containment, and so failing in both directions on purpose:
  // a name that disappears is a breaking change for consumers, and a name that
  // appears is a public commitment that should be made deliberately rather
  // than by re-export drift.
  assert.deepEqual([...Object.keys(entryPoint)].sort(), [...PUBLISHED_EXPORTS].sort())
})

test('every published name resolves to something callable', () => {
  // Object.keys() alone would pass on a name bound to undefined, which is what
  // a re-export of a renamed symbol looks like from the outside.
  for (const name of PUBLISHED_EXPORTS) {
    assert.equal(typeof entryPoint[name], 'function', `${name} is not a function`)
  }
})

test('findScripts reaches the two files the old hand-written check missed', () => {
  const found = findScripts(process.cwd()).map((file) =>
    path.relative(process.cwd(), file).split(path.sep).join('/'),
  )

  assert.ok(found.includes('src/index.js'), 'src/index.js is not discovered')
  assert.ok(
    found.includes('examples/openclaw/apply-claude-cli-backend.mjs'),
    'examples/openclaw/apply-claude-cli-backend.mjs is not discovered',
  )
  assert.ok(found.includes('scripts/syntax-check.mjs'), 'the checker does not check itself')
})

test('findScripts skips node_modules', () => {
  const found = findScripts(process.cwd())
  assert.equal(
    found.filter((file) => file.split(path.sep).includes('node_modules')).length,
    0,
  )
})

test('checkSyntax reports a parse error and passes a valid file', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'claude-jobs-syntax-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const broken = path.join(directory, 'broken.js')
  writeFileSync(broken, 'const broken = {\n')
  assert.match(checkSyntax(broken) ?? '', /SyntaxError/)

  const valid = path.join(directory, 'valid.mjs')
  writeFileSync(valid, 'export const ok = 1\n')
  assert.equal(checkSyntax(valid), null)
})

test('a scan that finds no files is a failure, not a pass', (t) => {
  // The whole reason the check discovers files instead of listing them: a
  // directory rename must not quietly turn the gate into a no-op.
  const empty = mkdtempSync(path.join(tmpdir(), 'claude-jobs-empty-'))
  t.after(() => rmSync(empty, { recursive: true, force: true }))

  assert.deepEqual(findScripts(empty), [])
})
