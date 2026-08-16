import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { renderTemplate } from '../src/render.js'

const CLI = fileURLToPath(new URL('../bin/claude-jobs.js', import.meta.url))

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'claude-jobs-test-'))
  try {
    return fn(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function cli(home, args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_JOBS_HOME: home, CLAUDE_JOBS_SCHEDULER: 'cron' },
  })
}

test('init scaffolds a runnable job and dry-run explains it without calling claude', () => {
  withHome((home) => {
    const out = cli(home, ['init', 'demo', '--task', 'Do the thing.', '--at', '09:30', '--jitter', '0'])
    assert.match(out, /Created job "demo"/)

    const job = JSON.parse(readFileSync(join(home, 'jobs', 'demo', 'job.json'), 'utf8'))
    assert.equal(job.hour, 9)
    assert.equal(job.minute, 30)
    assert.equal(job.permissionMode, 'bypassPermissions')

    const prompt = readFileSync(join(home, 'jobs', 'demo', 'prompt.md'), 'utf8')
    assert.match(prompt, /Do the thing\./)
    assert.match(prompt, /demo-summary\.md/)
    assert.ok(!prompt.includes('{{'), 'every placeholder should be resolved')

    const dry = cli(home, ['run', 'demo', '--dry-run'])
    assert.match(dry, /--permission-mode bypassPermissions/)
    assert.match(dry, /--output-format stream-json/)
    assert.match(dry, /Do the thing\./)
  })
})

test('list reports the job as not yet installed', () => {
  withHome((home) => {
    cli(home, ['init', 'demo', '--task', 'x'])
    const out = cli(home, ['list'])
    assert.match(out, /demo/)
    assert.match(out, /no/)
  })
})

test('init refuses to clobber an existing job without --force', () => {
  withHome((home) => {
    cli(home, ['init', 'demo', '--task', 'x'])
    assert.throws(() => cli(home, ['init', 'demo', '--task', 'y']), /already exists/)
    cli(home, ['init', 'demo', '--task', 'y', '--force'])
  })
})

test('--version prints the package version', () => {
  withHome((home) => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    )
    assert.equal(cli(home, ['--version']).trim(), pkg.version)
  })
})

test('a freshly scaffolded job is not reported as scheduled', () => {
  withHome((home) => {
    // init writes the unit file so you can read it first; that is not the same
    // as the scheduler having accepted it.
    cli(home, ['init', 'demo', '--task', 'x'])
    assert.match(cli(home, ['status', 'demo']), /not installed/)
  })
})

test('a job name that would break a unit filename is rejected', () => {
  withHome((home) => {
    assert.throws(() => cli(home, ['init', 'Bad Name', '--task', 'x']), /invalid job name/)
  })
})

test('renders all scheduler templates without errors', () => {
  const vars = {
    JOB_NAME: 'demo',
    LABEL: 'com.claude-jobs.demo',
    RUNNER: '/home/user/.claude-jobs/runners/demo.sh',
    LOG_FILE: '/home/user/.claude-jobs/logs/demo-summary.md',
    WORKDIR: '/home/user/.claude-jobs/jobs/demo',
    HOUR: 9,
    MINUTE: 30,
    HOUR_PADDED: '09',
    MINUTE_PADDED: '30',
  }

  // Render launchd.plist
  const launchdResult = renderTemplate('launchd.plist', vars)
  assert.ok(launchdResult, 'launchd.plist should render')
  assert.ok(launchdResult.includes('com.claude-jobs.demo'), 'launchd should contain LABEL')
  assert.ok(launchdResult.includes('/home/user/.claude-jobs/runners/demo.sh'), 'launchd should contain RUNNER')
  assert.ok(launchdResult.includes('/home/user/.claude-jobs/logs/demo-summary.md'), 'launchd should contain LOG_FILE')
  assert.ok(launchdResult.includes('09'), 'launchd should contain HOUR')
  assert.ok(!launchdResult.includes('{{'), 'launchd should have no unresolved placeholders')

  // Render systemd.service
  const systemdService = renderTemplate('systemd.service', vars)
  assert.ok(systemdService, 'systemd.service should render')
  assert.ok(systemdService.includes('claude-jobs-demo.service'), 'systemd.service should contain JOB_NAME')
  assert.ok(!systemdService.includes('{{'), 'systemd.service should have no unresolved placeholders')

  // Render systemd.timer
  const systemdTimer = renderTemplate('systemd.timer', vars)
  assert.ok(systemdTimer, 'systemd.timer should render')
  assert.ok(systemdTimer.includes('claude-jobs-demo.timer'), 'systemd.timer should contain JOB_NAME')
  assert.ok(systemdTimer.includes('OnCalendar=*-*-* 09:30:00'), 'systemd.timer should contain OnCalendar with HOUR and MINUTE')
  assert.ok(!systemdTimer.includes('{{'), 'systemd.timer should have no unresolved placeholders')
})
