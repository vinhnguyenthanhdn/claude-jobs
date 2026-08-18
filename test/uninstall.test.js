import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cmdUninstall } from '../src/commands.js'
import { ensureDirs, jobDir, jobFile, logFile, summaryFile, writeJob } from '../src/paths.js'

// The real scheduler backends (launchd/systemd/cron) shell out to the OS and,
// for cron, would rewrite the *real* user crontab. None of that is what
// --purge is about, so these jobs use a scheduler name uninstall() does not
// recognize — its uninstall() is a no-op for anything but the three known
// schedulers, which keeps this suite from touching real system state.
const SAFE_SCHEDULER = 'test-noop'

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'claude-jobs-test-'))
  const prev = process.env.CLAUDE_JOBS_HOME
  process.env.CLAUDE_JOBS_HOME = home
  try {
    const result = fn(home)
    if (result && typeof result.then === 'function') {
      // The body has already started, and there is no way to stop it: it will
      // resume after this throw, against the restored env and a temp directory
      // that no longer exists. Swallow whatever it does with that, so the one
      // failure reported is this one — an unhandled rejection surfacing later
      // would be attributed to whichever test happened to be running.
      result.then(
        () => {},
        () => {},
      )
      throw new Error('withHome() does not support async callbacks')
    }
    return result
  } finally {
    process.env.CLAUDE_JOBS_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
}

test('withHome rejects async callbacks', () => {
  assert.throws(
    () =>
      withHome(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }),
    /withHome\(\) does not support async callbacks/,
  )
})

function makeJob(name) {
  ensureDirs()
  writeJob(name, { name, scheduler: SAFE_SCHEDULER })
}

function captureLog(fn) {
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    fn()
  } finally {
    console.log = original
  }
  return lines
}

test('uninstall --purge removes the job dir, log and summary', () => {
  withHome(() => {
    makeJob('purge-me')
    writeFileSync(logFile('purge-me'), 'log output\n')
    writeFileSync(summaryFile('purge-me'), '# summary\n')

    const lines = captureLog(() => cmdUninstall(['purge-me'], { purge: true }))

    assert.ok(!existsSync(jobDir('purge-me')), 'job dir should be gone')
    assert.ok(!existsSync(logFile('purge-me')), 'log file should be gone')
    assert.ok(!existsSync(summaryFile('purge-me')), 'summary file should be gone')

    assert.ok(lines.some((l) => l.includes(jobDir('purge-me'))))
    assert.ok(lines.some((l) => l.includes(logFile('purge-me'))))
    assert.ok(lines.some((l) => l.includes(summaryFile('purge-me'))))
  })
})

test('uninstall --purge is safe when a job never ran (no log, no summary)', () => {
  withHome(() => {
    makeJob('never-ran')
    assert.ok(!existsSync(logFile('never-ran')))
    assert.ok(!existsSync(summaryFile('never-ran')))

    const lines = captureLog(() => cmdUninstall(['never-ran'], { purge: true }))

    assert.ok(!existsSync(jobDir('never-ran')))
    assert.ok(lines.some((l) => l.includes(jobDir('never-ran'))))
    assert.ok(!lines.some((l) => l.includes(logFile('never-ran'))))
    assert.ok(!lines.some((l) => l.includes(summaryFile('never-ran'))))
  })
})

test('uninstall without --purge leaves the job dir, log and summary in place', () => {
  withHome(() => {
    makeJob('keep-me')
    writeFileSync(logFile('keep-me'), 'log output\n')
    writeFileSync(summaryFile('keep-me'), '# summary\n')

    captureLog(() => cmdUninstall(['keep-me'], {}))

    assert.ok(existsSync(jobFile('keep-me')), 'job.json should remain')
    assert.ok(existsSync(logFile('keep-me')), 'log file should remain')
    assert.ok(existsSync(summaryFile('keep-me')), 'summary file should remain')
  })
})
