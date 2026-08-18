import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LOG_MAX_BYTES, buildJob, shouldRotateLog } from '../src/commands.js'
import { renderTemplate } from '../src/render.js'

/**
 * The rotation ships as bash inside the generated runner, so the cases that
 * execute it need a bash. The pure-function and rendering cases do not.
 */
const HAS_BASH = (() => {
  try {
    execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' })
    return true
  } catch (error) {
    return error.code !== 'ENOENT'
  }
})()
const needsBash = HAS_BASH ? false : 'no bash on PATH'

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-jobs-rot-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The shipped rotation block, lifted out of the rendered runner verbatim. */
function rotationBlock(logMaxBytes) {
  const script = renderTemplate('run.sh', {
    JOB_NAME: 'demo', JOB_NAME_Q: "'demo'", JOB_DIR_Q: "'/tmp/demo'",
    WORKDIR_Q: "'/tmp'", CLAUDE_BIN_Q: "'claude'", LOG_FILE_Q: "'/tmp/demo.log'",
    SUMMARY_FILE_Q: "'/tmp/demo-summary.md'", PATH_VALUE: "'/usr/bin'", HOME_VALUE: "'/tmp'",
    JITTER: 0, LOG_MAX_BYTES: logMaxBytes, PERMISSION_MODE_Q: "'bypassPermissions'",
    MODEL_Q: "''", PRECHECK_Q: "''", NOTIFY_Q: "''",
  })
  const match = script.match(/^if \[ "\$LOG_MAX_BYTES" -gt 0 \].*?^fi$/ms)
  assert.ok(match, 'rotation block not found in the rendered runner')
  return match[0]
}

/** Run the shipped rotation block against a real file. */
function runRotation(dir, { size, cap }) {
  const log = join(dir, 'demo.log')
  if (size > 0) writeFileSync(log, 'x'.repeat(size))
  const script = [
    'set -uo pipefail',
    `LOG="${log.replaceAll('\\', '/')}"`,
    `LOG_MAX_BYTES=${cap}`,
    'log() { echo "$*" >> "$LOG"; }',
    rotationBlock(cap),
  ].join('\n')
  execFileSync('bash', ['-c', script], { stdio: 'pipe' })
  return {
    files: readdirSync(dir).sort(),
    rotated: existsSync(`${log}.1`),
  }
}

test('shouldRotateLog: at or above the cap rotates, below does not', () => {
  assert.equal(shouldRotateLog(1000, 1000), true, 'exactly at the cap rotates')
  assert.equal(shouldRotateLog(1001, 1000), true)
  assert.equal(shouldRotateLog(999, 1000), false)
})

test('shouldRotateLog: a cap of 0 disables rotation at any size', () => {
  assert.equal(shouldRotateLog(0, 0), false)
  assert.equal(shouldRotateLog(10_000_000, 0), false)
})

test('shouldRotateLog: a missing or absurd cap disables rotation', () => {
  for (const cap of [undefined, null, NaN, -1, 'big', Infinity]) {
    assert.equal(shouldRotateLog(10_000_000, cap), false, `cap ${String(cap)}`)
  }
})

test('shouldRotateLog: an empty or unreadable log never rotates', () => {
  assert.equal(shouldRotateLog(0, 1000), false)
  assert.equal(shouldRotateLog(NaN, 1000), false)
})

test('the default cap is 5 MiB', () => {
  assert.equal(DEFAULT_LOG_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(DEFAULT_LOG_MAX_BYTES, 5_242_880)
})

test('buildJob records the default cap, and honours an explicit one', () => {
  assert.equal(buildJob('demo', {}).logMaxBytes, DEFAULT_LOG_MAX_BYTES)
  assert.equal(buildJob('demo', { 'log-max-bytes': '4096' }).logMaxBytes, 4096)
  assert.equal(buildJob('demo', { 'log-max-bytes': '0' }).logMaxBytes, 0)
})

test('the rendered runner carries the cap the way it carries JITTER', () => {
  const script = renderTemplate('run.sh', {
    JOB_NAME: 'demo', JOB_NAME_Q: "'demo'", JOB_DIR_Q: "'/tmp/demo'",
    WORKDIR_Q: "'/tmp'", CLAUDE_BIN_Q: "'claude'", LOG_FILE_Q: "'/tmp/demo.log'",
    SUMMARY_FILE_Q: "'/tmp/demo-summary.md'", PATH_VALUE: "'/usr/bin'", HOME_VALUE: "'/tmp'",
    JITTER: 0, LOG_MAX_BYTES: 4096, PERMISSION_MODE_Q: "'bypassPermissions'",
    MODEL_Q: "''", PRECHECK_Q: "''", NOTIFY_Q: "''",
  })

  // An existing job is edited rather than re-created, so the value has to be a
  // plain assignment near the other job values.
  assert.match(script, /^LOG_MAX_BYTES=4096$/m)
  assert.ok(!script.includes('{{LOG_MAX_BYTES}}'), 'placeholder should be substituted')
  // And it must rotate before the session marker, not after.
  assert.ok(
    script.indexOf('LOG_MAX_BYTES" -gt 0') < script.indexOf('=== session start ==='),
    'rotation must happen before the session start marker',
  )
})

test('rotation moves an oversize log to .1, leaving exactly two files', { skip: needsBash }, () => {
  withTmp((dir) => {
    const { files, rotated } = runRotation(dir, { size: 5000, cap: 4096 })

    assert.ok(rotated, 'previous log should be at .1')
    assert.deepEqual(files, ['demo.log', 'demo.log.1'])
    // One generation is the bound: no .2 is ever created.
    assert.ok(!files.includes('demo.log.2'))
  })
})

test('a second rotation replaces .1 rather than accumulating', { skip: needsBash }, () => {
  withTmp((dir) => {
    runRotation(dir, { size: 5000, cap: 4096 })
    writeFileSync(join(dir, 'demo.log'), 'y'.repeat(5000))
    const { files } = runRotation(dir, { size: 0, cap: 4096 })

    assert.deepEqual(files, ['demo.log', 'demo.log.1'], 'still exactly two files')
    assert.match(readFileSync(join(dir, 'demo.log.1'), 'utf8'), /^y+$/, '.1 is the newer of the two')
  })
})

test('a log under the cap is left alone', { skip: needsBash }, () => {
  withTmp((dir) => {
    const { files, rotated } = runRotation(dir, { size: 100, cap: 4096 })

    assert.equal(rotated, false)
    assert.deepEqual(files, ['demo.log'])
  })
})

test('a cap of 0 never rotates, however large the log', { skip: needsBash }, () => {
  withTmp((dir) => {
    const { files, rotated } = runRotation(dir, { size: 50_000, cap: 0 })

    assert.equal(rotated, false, 'cap 0 keeps today’s behaviour')
    assert.deepEqual(files, ['demo.log'])
  })
})

test('rotation is a no-op when there is no log yet', { skip: needsBash }, () => {
  withTmp((dir) => {
    // A job that has never run: no throw, nothing created.
    const { rotated } = runRotation(dir, { size: 0, cap: 4096 })
    assert.equal(rotated, false)
  })
})
