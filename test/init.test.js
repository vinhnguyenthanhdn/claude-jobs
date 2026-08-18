import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from '../src/render.js'
import { schedulerVars } from '../src/schedulers.js'

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
      /--jitter requires a value/,
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
test('init rejects an invalid scheduler without writing files (#16)', () => {
  withHome((home) => {
    cli(home, ['init', 'existing', '--task', 'hi'])

    assert.throws(
      () => cli(home, ['init', 'bad-scheduler', '--task', 'hi', '--scheduler', 'garbage']),
      /unknown scheduler "garbage"\. Use launchd, systemd or cron\./,
    )

    assert.equal(existsSync(join(home, 'jobs', 'bad-scheduler')), false)

    const out = cli(home, ['list'])
    assert.match(out, /existing/)
    assert.doesNotMatch(out, /bad-scheduler/)
  })
})

// Every flag in the `init options` block of USAGE that takes a value. A flag
// missing from this list becomes the boolean `true` and the job is created with
// it, which is what #16 reported.
const INIT_VALUE_FLAGS = [
  'skill',
  'task',
  'prompt-file',
  'at',
  'jitter',
  'workdir',
  'scheduler',
  'claude',
  'model',
  'permission-mode',
  'precheck',
  'notify',
  'path',
]

test('a value flag with no value is rejected by name and writes nothing (#16)', () => {
  for (const flag of INIT_VALUE_FLAGS) {
    withHome((home) => {
      const name = `missing-${flag}`
      assert.throws(
        () => cli(home, ['init', name, '--task', 'hi', `--${flag}`]),
        new RegExp(`--${flag} requires a value`),
        `--${flag} with no value should be rejected by name`,
      )
      // Not the shape #16 called out: no Node type error, no job left behind.
      assert.equal(existsSync(join(home, 'jobs', name)), false)
    })
  }
})

test('boolean flags are unaffected by the value-flag rule (#16)', () => {
  withHome((home) => {
    cli(home, ['init', 'b1', '--task', 'hi'])
    // --force takes no value and must still overwrite rather than be rejected.
    cli(home, ['init', 'b1', '--task', 'hi again', '--force'])
    assert.match(readFileSync(join(home, 'jobs', 'b1', 'prompt.md'), 'utf8'), /hi again/)
    // --dry-run likewise: it is read as a flag, not as a missing value.
    assert.match(cli(home, ['run', 'b1', '--dry-run']), /\[dry-run\]/)
  })
})

test('a rejected init writes no scheduler file either (#16)', () => {
  withHome((home) => {
    const template = join(home, 'bad-template.md')
    writeFileSync(template, 'Task: {{TASK}}\nBogus: {{NOPE}}\n')

    // launchd writes its plist under HOME, outside the jobs directory, so the
    // "nothing left behind" claim has to be checked there too.
    assert.throws(
      () =>
        execFileSync(process.execPath, [CLI, 'init', 'orphan', '--task', 'hi', '--prompt-file', template], {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, CLAUDE_JOBS_HOME: home, CLAUDE_JOBS_SCHEDULER: 'launchd' },
        }),
      /template placeholder \{\{NOPE\}\} has no value/,
    )

    // The scheduler file is the one that matters here: it names a runner, so
    // writing it before the runner exists would schedule a path that is not there.
    assert.equal(existsSync(join(home, 'Library', 'LaunchAgents', 'com.claude-jobs.orphan.plist')), false)
    assert.equal(existsSync(join(home, 'jobs', 'orphan', 'run.sh')), false)
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

test('every scheduler template renders with the vars schedulerVars supplies', () => {
  const vars = schedulerVars({
    name: 'demo',
    hour: 9,
    minute: 30,
    workdir: '/home/user/.claude-jobs/jobs/demo',
  })

  const launchd = renderTemplate('launchd.plist', vars)
  assert.match(launchd, /<key>Label<\/key>\s*<string>com\.claude-jobs\.demo<\/string>/)
  assert.ok(launchd.includes(`<string>${vars.RUNNER}</string>`))
  assert.ok(launchd.includes(`<string>${vars.LOG_FILE}</string>`))
  // launchd wants plist integers, so the unpadded HOUR/MINUTE belong here -- not the padded pair.
  assert.match(launchd, /<key>Hour<\/key>\s*<integer>9<\/integer>/)
  assert.match(launchd, /<key>Minute<\/key>\s*<integer>30<\/integer>/)
  assert.ok(!launchd.includes('{{'), 'launchd.plist has an unresolved placeholder')

  const service = renderTemplate('systemd.service', vars)
  assert.ok(service.includes('Description=claude-jobs: demo'))
  assert.ok(service.includes(`ExecStart=/bin/bash ${vars.RUNNER}`))
  assert.ok(service.includes(`WorkingDirectory=${vars.WORKDIR}`))
  assert.ok(!service.includes('{{'), 'systemd.service has an unresolved placeholder')

  const timer = renderTemplate('systemd.timer', vars)
  assert.ok(timer.includes('Description=claude-jobs timer: demo'))
  // systemd parses the calendar field positionally, so here the padded pair is the correct one.
  assert.ok(timer.includes('OnCalendar=*-*-* 09:30:00'))
  assert.ok(!timer.includes('{{'), 'systemd.timer has an unresolved placeholder')
})

test('schedulerVars maps each key to the right source, not just any value the templates accept (#32)', () => {
  const vars = schedulerVars({
    name: 'demo',
    hour: 9,
    minute: 30,
    workdir: '/home/user/.claude-jobs/jobs/demo',
  })

  // RUNNER and LOG_FILE come from different directories and must not collapse
  // into each other -- that is the exact mistake this test exists to catch.
  assert.match(vars.RUNNER, /\/demo\/run\.sh$/)
  assert.match(vars.LOG_FILE, /\/logs\/demo\.log$/)
  assert.notEqual(vars.RUNNER, vars.LOG_FILE)
  assert.notEqual(vars.RUNNER, vars.WORKDIR)
  assert.notEqual(vars.LOG_FILE, vars.WORKDIR)

  assert.equal(vars.LABEL, 'com.claude-jobs.demo')

  // HOUR/MINUTE and their padded counterparts serve different templates
  // (launchd wants plist integers, systemd.timer wants a fixed-width
  // calendar field) -- one is not a substitute for the other.
  assert.equal(vars.HOUR, 9)
  assert.equal(vars.MINUTE, 30)
  assert.equal(vars.HOUR_PADDED, '09')
  assert.equal(vars.MINUTE_PADDED, '30')
  assert.equal(typeof vars.HOUR_PADDED, 'string')
  assert.equal(vars.HOUR_PADDED.length, 2)
  assert.equal(typeof vars.MINUTE_PADDED, 'string')
  assert.equal(vars.MINUTE_PADDED.length, 2)
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
