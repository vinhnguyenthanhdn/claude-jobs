import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/claude-jobs.js', import.meta.url))

/**
 * `uninstall` shells out to the scheduler, so the end-to-end cases below need a
 * `crontab` on PATH. The unit cases exercising the purge itself do not, and run
 * everywhere.
 */
const HAS_CRONTAB = (() => {
  try {
    execFileSync('crontab', ['-l'], { stdio: 'ignore' })
    return true
  } catch (error) {
    return error.code !== 'ENOENT'
  }
})()
const needsCrontab = HAS_CRONTAB ? false : 'no crontab on PATH'

/**
 * `async` and awaited: the unit cases import `commands.js` dynamically, so a
 * synchronous `finally` would restore CLAUDE_JOBS_HOME before the body ran and
 * the paths would resolve against the real home directory.
 */
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'claude-jobs-test-'))
  const previous = process.env.CLAUDE_JOBS_HOME
  process.env.CLAUDE_JOBS_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_JOBS_HOME
    else process.env.CLAUDE_JOBS_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

function cli(home, args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_JOBS_HOME: home, CLAUDE_JOBS_SCHEDULER: 'cron' },
  })
}

const paths = (home, name) => ({
  dir: join(home, 'jobs', name),
  log: join(home, 'logs', `${name}.log`),
  summary: join(home, 'state', `${name}-summary.md`),
})

/** What a real run leaves behind, without invoking claude. */
function seedJob(home, name, { ran = true } = {}) {
  const p = paths(home, name)
  mkdirSync(p.dir, { recursive: true })
  writeFileSync(join(p.dir, 'job.json'), JSON.stringify({ name }))
  writeFileSync(join(p.dir, 'run.sh'), '#!/bin/bash\n')
  if (ran) {
    mkdirSync(join(home, 'logs'), { recursive: true })
    mkdirSync(join(home, 'state'), { recursive: true })
    writeFileSync(p.log, '=== session start ===\nhi\n')
    writeFileSync(p.summary, '# summary\n')
  }
  return p
}

test('jobPaths lists the job dir, the log and the summary', async () => {
  await withHome(async (home) => {
    const { jobPaths } = await import('../src/commands.js')
    const listed = jobPaths('demo')

    // If a fourth per-job path is ever added to paths.js, this is the list that
    // has to grow with it.
    assert.deepEqual(listed, [
      join(home, 'jobs', 'demo'),
      join(home, 'logs', 'demo.log'),
      join(home, 'state', 'demo-summary.md'),
    ])
  })
})

test('purgeJobFiles removes all three paths and reports each one', async () => {
  await withHome(async (home) => {
    const { purgeJobFiles } = await import('../src/commands.js')
    const p = seedJob(home, 'purge-probe')

    const removed = purgeJobFiles('purge-probe')

    assert.equal(existsSync(p.dir), false, 'job dir should be gone')
    assert.equal(existsSync(p.log), false, 'log should be gone')
    assert.equal(existsSync(p.summary), false, 'summary should be gone')
    assert.deepEqual(removed, [p.dir, p.log, p.summary])
  })
})

test('purgeJobFiles is safe for a job that never ran', async () => {
  await withHome(async (home) => {
    const { purgeJobFiles } = await import('../src/commands.js')
    const p = seedJob(home, 'never-ran', { ran: false })

    // No throw, and nothing reported for a file that was not there.
    const removed = purgeJobFiles('never-ran')

    assert.deepEqual(removed, [p.dir])
    assert.equal(existsSync(p.dir), false)
  })
})

test('purgeJobFiles on an entirely unknown name removes and reports nothing', async () => {
  await withHome(async () => {
    const { purgeJobFiles } = await import('../src/commands.js')
    assert.deepEqual(purgeJobFiles('never-existed'), [])
  })
})

test('purgeJobFiles leaves other jobs untouched', async () => {
  await withHome(async (home) => {
    const { purgeJobFiles } = await import('../src/commands.js')
    seedJob(home, 'target')
    const bystander = seedJob(home, 'bystander')

    purgeJobFiles('target')

    assert.ok(existsSync(bystander.dir), 'other job dir should survive')
    assert.ok(existsSync(bystander.log), 'other job log should survive')
    assert.ok(existsSync(bystander.summary), 'other job summary should survive')
  })
})

test(
  'uninstall --purge removes the job dir, the log and the summary',
  { skip: needsCrontab },
  async () => {
    await withHome((home) => {
      cli(home, ['init', 'purge-probe', '--task', 'echo hi', '--at', '23:59', '--jitter', '0'])
      const p = seedJob(home, 'purge-probe')

      const out = cli(home, ['uninstall', 'purge-probe', '--purge'])

      assert.equal(existsSync(p.dir), false)
      assert.equal(existsSync(p.log), false)
      assert.equal(existsSync(p.summary), false)
      assert.ok(out.includes(`Removed ${p.log}`), `expected the log path in:\n${out}`)
      assert.ok(out.includes(`Removed ${p.summary}`), `expected the summary path in:\n${out}`)
    })
  },
)

test(
  'uninstall without --purge leaves the job dir, log and summary in place',
  { skip: needsCrontab },
  async () => {
    await withHome((home) => {
      cli(home, ['init', 'keeper', '--task', 'echo hi', '--at', '23:59', '--jitter', '0'])
      const p = seedJob(home, 'keeper')

      cli(home, ['uninstall', 'keeper'])

      // So the flag keeps meaning something.
      assert.ok(existsSync(p.dir), 'job dir should survive')
      assert.ok(existsSync(p.log), 'log should survive')
      assert.ok(existsSync(p.summary), 'summary should survive')
    })
  },
)
