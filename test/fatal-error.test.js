import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/claude-jobs.js', import.meta.url))
const SRC = fileURLToPath(new URL('../src', import.meta.url))
const BIN = fileURLToPath(new URL('../bin', import.meta.url))
const REPORT_URL = /issues\/new\?template=bug_report\.yml/

/** Run the CLI and return { status, stdout, stderr } without throwing. */
function run(args, { home, env = {} } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_JOBS_HOME: home, ...env },
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' }
  }
}

function scratch() {
  return mkdtempSync(join(tmpdir(), 'claude-jobs-fatal-'))
}

test('an unexpected failure names the diagnostic command and where to report it', () => {
  const dir = scratch()
  // A regular file where the job root should be. Nothing the caller passed can
  // be blamed for the EEXIST that comes back out of mkdir, which is exactly the
  // class of failure a user cannot turn into an issue on their own.
  const home = join(dir, 'occupied')
  writeFileSync(home, 'not a directory\n')

  try {
    const { status, stderr } = run(['init', 'demo', '--task', 'hi'], { home })

    assert.equal(status, 1)
    assert.match(stderr, /EEXIST/)
    assert.match(stderr, /unexpected failure/)
    assert.match(stderr, /claude-jobs doctor/)
    assert.match(stderr, REPORT_URL)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a usage mistake stays one line and is not turned into a bug report', () => {
  const dir = scratch()
  try {
    const { status, stderr } = run(['run'], { home: join(dir, 'home') })

    assert.equal(status, 1)
    assert.equal(stderr.trimEnd(), 'claude-jobs: run needs a job name. Run "claude-jobs list" to see them.')
    assert.doesNotMatch(stderr, REPORT_URL)
    assert.doesNotMatch(stderr, /claude-jobs doctor/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a broken job.json says which file is broken instead of quoting a JSON parser', () => {
  const dir = scratch()
  const home = join(dir, 'home')
  const jobFile = join(home, 'jobs', 'demo', 'job.json')
  mkdirSync(join(home, 'jobs', 'demo'), { recursive: true })
  writeFileSync(jobFile, '{oops')

  try {
    const { status, stderr } = run(['status', 'demo'], { home })

    assert.equal(status, 1)
    assert.match(stderr, /job "demo" has an unreadable job\.json/)
    assert.ok(stderr.includes(jobFile), `stderr should name ${jobFile}, got:\n${stderr}`)
    assert.match(stderr, /claude-jobs init demo/)
    // It is a state problem with a stated way out, so it does not ask for an issue.
    assert.doesNotMatch(stderr, REPORT_URL)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLAUDE_JOBS_DEBUG=1 swaps the hint for the stack trace', () => {
  const dir = scratch()
  const home = join(dir, 'occupied')
  writeFileSync(home, 'not a directory\n')

  try {
    const quiet = run(['init', 'demo', '--task', 'hi'], { home })
    const loud = run(['init', 'demo', '--task', 'hi'], { home, env: { CLAUDE_JOBS_DEBUG: '1' } })

    assert.match(quiet.stderr, /Set CLAUDE_JOBS_DEBUG=1/)
    assert.doesNotMatch(quiet.stderr, /at .*node:/)
    assert.doesNotMatch(loud.stderr, /Set CLAUDE_JOBS_DEBUG=1/)
    assert.match(loud.stderr, /Error: EEXIST[\s\S]*\n\s+at /)
    // The report channel survives either way — it is the point of the footer.
    assert.match(loud.stderr, REPORT_URL)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every deliberate throw in the shipped code declares which side it is on', () => {
  // The footer is only correct because the deliberate failures opt out of it.
  // A plain `new Error` added later would inherit the bug-report text and tell
  // a user to file an issue about their own typo, and nothing else would catch
  // that — the message still reads fine on its own.
  const files = [SRC, BIN].flatMap(listJs)
  assert.ok(files.length >= 6, `expected to scan the shipped modules, found ${files.length}`)

  const offenders = []
  for (const file of files) {
    const body = readFileSync(file, 'utf8')
    body.split('\n').forEach((line, i) => {
      if (/throw new Error\(/.test(line)) offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    `use UsageError for a caller mistake, or throw a typed error for a real bug:\n${offenders.join('\n')}`,
  )
})

function listJs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => join(dir, e.name))
}
