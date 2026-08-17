import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('init rejects invalid flags and writes no files (#13)', () => {
  withHome((home) => {
    // 1. Non-numeric jitter
    assert.throws(
      () => cli(home, ['init', 'p1', '--task', 'hi', '--jitter', 'abc']),
      /--jitter must be a non-negative integer/,
    )
    assert.equal(existsSync(join(home, 'jobs', 'p1')), false)

    // 2. Missing value for jitter
    assert.throws(
      () => cli(home, ['init', 'p2', '--task', 'hi', '--jitter']),
      /--jitter must be a non-negative integer/,
    )
    assert.equal(existsSync(join(home, 'jobs', 'p2')), false)

    // 3. Missing skill file
    assert.throws(
      () => cli(home, ['init', 'p3', '--skill', './nonexistent-file.md']),
      /--skill file not found/,
    )
    assert.equal(existsSync(join(home, 'jobs', 'p3')), false)

    // 4. Missing prompt-file
    assert.throws(
      () => cli(home, ['init', 'p4', '--prompt-file', './nonexistent-prompt.md']),
      /--prompt-file not found/,
    )
    assert.equal(existsSync(join(home, 'jobs', 'p4')), false)

    // 5. Jitter 0 is valid
    cli(home, ['init', 'p5', '--task', 'hi', '--jitter', '0'])
    assert.equal(existsSync(join(home, 'jobs', 'p5')), true)
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

test('every scheduler template renders with the vars writeSchedulerFiles supplies', () => {
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

  const launchd = renderTemplate('launchd.plist', vars)
  assert.match(launchd, /<key>Label<\/key>\s*<string>com\.claude-jobs\.demo<\/string>/)
  assert.ok(launchd.includes('<string>/home/user/.claude-jobs/runners/demo.sh</string>'))
  assert.ok(launchd.includes('<string>/home/user/.claude-jobs/logs/demo-summary.md</string>'))
  // launchd wants plist integers, so the unpadded HOUR/MINUTE belong here -- not the padded pair.
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>9<\/integer>/)
  assert.match(launchd, /<key>Minute<\/key>\s*<integer>30<\/integer>/)
  assert.ok(!launchd.includes('{{'), 'launchd.plist has an unresolved placeholder')

  const service = renderTemplate('systemd.service', vars)
  assert.ok(service.includes('Description=claude-jobs: demo'))
  assert.ok(service.includes('ExecStart=/bin/bash /home/user/.claude-jobs/runners/demo.sh'))
  assert.ok(service.includes('WorkingDirectory=/home/user/.claude-jobs/jobs/demo'))
  assert.ok(!service.includes('{{'), 'systemd.service has an unresolved placeholder')

  const timer = renderTemplate('systemd.timer', vars)
  assert.ok(timer.includes('Description=claude-jobs timer: demo'))
  // systemd parses the calendar field positionally, so here the padded pair is the correct one.
  assert.ok(timer.includes('OnCalendar=*-*-* 09:30:00'))
  assert.ok(!timer.includes('{{'), 'systemd.timer has an unresolved placeholder')
})

test('commands requiring a job name exit non-zero with clean message when omitted', () => {
  withHome((home) => {
    for (const cmd of ['run', 'install', 'uninstall', 'logs', 'status']) {
      assert.throws(
        () => cli(home, [cmd]),
        (err) => {
          const text = String(err.stderr || err.stdout || err.message)
          assert.match(text, new RegExp(`claude-jobs: ${cmd} needs a job name\\. Run "claude-jobs list" to see them\\.`))
          assert.doesNotMatch(text, /TypeError/)
          assert.doesNotMatch(text, /The "path" argument must be of type string/)
          return true
        },
      )
    }
  })
})
