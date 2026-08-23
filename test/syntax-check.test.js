import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkSyntax, findScripts } from '../scripts/syntax-check.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const gate = fileURLToPath(new URL('../scripts/syntax-check.mjs', import.meta.url))

// `scripts/syntax-check.mjs` is a gate, and an unexercised gate is
// indistinguishable from no gate: narrowing its file filter to a single
// directory leaves the whole suite green (#40 one layer out). These tests are
// what make that mutation fail.

test('findScripts reaches the two files the old hand-written check missed', () => {
  const found = findScripts(repoRoot)

  // The literal reason #40 shipped: `node --check bin/... && node --check
  // src/cli.js` named two files, and neither of these is imported by anything,
  // so a break in either reached the registry.
  assert.ok(found.includes('src/index.js'), 'src/index.js is not discovered')
  assert.ok(
    found.includes('examples/openclaw/apply-claude-cli-backend.mjs'),
    'examples/openclaw/apply-claude-cli-backend.mjs is not discovered',
  )
  assert.ok(
    found.includes('scripts/syntax-check.mjs'),
    'the checker does not check itself',
  )
})

test('findScripts skips node_modules', () => {
  const found = findScripts(repoRoot)

  assert.deepEqual(
    found.filter((file) => file.split('/').includes('node_modules')),
    [],
  )
})

test('findScripts takes .js and .mjs and nothing else', () => {
  const found = findScripts(repoRoot)

  assert.ok(found.length > 0, 'the repository has tracked scripts to find')
  assert.deepEqual(
    found.filter((file) => !file.endsWith('.js') && !file.endsWith('.mjs')),
    [],
  )
})

test('checkSyntax reports a parse error and passes a valid file', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'claude-jobs-syntax-'))
  t.after(() => rmSync(directory, {recursive: true, force: true}))

  // The gate's own detection, verified rather than assumed. If `node --check`
  // is ever swapped for something that reports success on stderr-only output,
  // this is what notices.
  writeFileSync(path.join(directory, 'broken.js'), 'const broken = {\n')
  const broken = checkSyntax('broken.js', directory)
  assert.equal(broken.ok, false, 'an unterminated object literal must not pass')
  assert.match(broken.stderr, /SyntaxError/)

  writeFileSync(path.join(directory, 'valid.mjs'), 'export const ok = 1\n')
  const valid = checkSyntax('valid.mjs', directory)
  assert.equal(valid.ok, true, 'a valid module must pass')
  assert.equal(valid.stderr, '')
})

test('a scan that finds no files is a failure, not a pass', (t) => {
  // A directory rename must not quietly turn the gate into a no-op that exits
  // 0 having checked nothing. Asserted end to end, on the real exit code,
  // because that is the only thing CI reads.
  const empty = mkdtempSync(path.join(tmpdir(), 'claude-jobs-empty-'))
  t.after(() => rmSync(empty, {recursive: true, force: true}))

  execFileSync('git', ['init', '--quiet'], {cwd: empty})

  assert.deepEqual(findScripts(empty), [], 'an empty repository has no scripts')

  const run = spawnSync(process.execPath, [gate], {cwd: empty, encoding: 'utf8'})
  assert.equal(run.status, 1, 'an empty scan must exit non-zero')
  assert.match(run.stderr, /refusing to pass on an empty scan/)
})
