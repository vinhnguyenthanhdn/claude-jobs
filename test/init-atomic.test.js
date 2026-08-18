import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Run the CLI expecting a non-zero exit, returning stderr. */
function cliFails(home, args) {
  try {
    cli(home, args)
    assert.fail(`expected "${args.join(' ')}" to exit non-zero`)
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error
    return String(error.stderr ?? '')
  }
}

const jobsDirOf = (home) => join(home, 'jobs')
const listJobDirs = (home) =>
  existsSync(jobsDirOf(home)) ? readdirSync(jobsDirOf(home)).sort() : []

test('a template the renderer rejects leaves the jobs directory untouched', () => {
  withHome((home) => {
    const bad = join(home, 'bad.md')
    writeFileSync(bad, 'Task: {{TASK}}\nBogus: {{NOPE}}\n')

    const stderr = cliFails(home, [
      'init', 'half', '--task', 'hi', '--prompt-file', bad, '--at', '09:00', '--jitter', '0',
    ])

    assert.match(stderr, /\{\{NOPE\}\} has no value/)

    // The whole point: no half-built job. Previously this left a job.json with
    // no prompt.md and no run.sh, and the name was taken.
    assert.deepEqual(listJobDirs(home), [])
    assert.equal(existsSync(join(home, 'jobs', 'half')), false)
  })
})

test('the rejected name is still free afterwards', () => {
  withHome((home) => {
    const bad = join(home, 'bad.md')
    writeFileSync(bad, 'Task: {{TASK}}\nBogus: {{NOPE}}\n')
    cliFails(home, ['init', 'half', '--task', 'hi', '--prompt-file', bad, '--jitter', '0'])

    // Previously this failed with 'job "half" already exists. Pass --force',
    // with no hint that the existing job was unrunnable.
    const out = cli(home, ['init', 'half', '--task', 'hi', '--at', '09:00', '--jitter', '0'])

    assert.match(out, /Created job "half"/)
    assert.ok(existsSync(join(home, 'jobs', 'half', 'run.sh')), 'runner should exist')
  })
})

test('a rejected init does not damage an existing job under --force', () => {
  withHome((home) => {
    cli(home, ['init', 'keeper', '--task', 'original task', '--at', '09:00', '--jitter', '0'])
    const promptPath = join(home, 'jobs', 'keeper', 'prompt.md')
    const jobPath = join(home, 'jobs', 'keeper', 'job.json')
    const before = readFileSync(promptPath, 'utf8')
    const jobBefore = readFileSync(jobPath, 'utf8')

    const bad = join(home, 'bad.md')
    writeFileSync(bad, 'Task: {{TASK}}\nBogus: {{NOPE}}\n')
    cliFails(home, [
      'init', 'keeper', '--force', '--task', 'new task', '--prompt-file', bad, '--jitter', '0',
    ])

    // --force overwrites, so a render that failed after writeJob left the OLD
    // prompt beside a NEW job.json — a job whose recorded task and whose
    // prompt disagreed.
    assert.equal(readFileSync(jobPath, 'utf8'), jobBefore, 'job.json should be untouched')
    assert.ok(jobBefore.includes('original task'), 'precondition: original task recorded')
    assert.equal(readFileSync(promptPath, 'utf8'), before, 'prompt should be untouched')
    assert.ok(existsSync(join(home, 'jobs', 'keeper', 'run.sh')), 'runner should survive')
  })
})

test('a valid --prompt-file still renders exactly as before', () => {
  withHome((home) => {
    const good = join(home, 'good.md')
    writeFileSync(good, 'Task: {{TASK}}\nSummary goes to {{SUMMARY_FILE}}\n')

    cli(home, [
      'init', 'fine', '--task', 'Do the thing.', '--prompt-file', good, '--at', '09:00', '--jitter', '0',
    ])

    const rendered = readFileSync(join(home, 'jobs', 'fine', 'prompt.md'), 'utf8')
    assert.equal(
      rendered,
      `Task: Do the thing.\nSummary goes to ${join(home, 'state', 'fine-summary.md')}\n`,
    )
  })
})

test('the default template still renders when no --prompt-file is given', () => {
  withHome((home) => {
    cli(home, ['init', 'defaulted', '--task', 'Do the thing.', '--at', '09:00', '--jitter', '0'])

    const rendered = readFileSync(join(home, 'jobs', 'defaulted', 'prompt.md'), 'utf8')
    assert.ok(rendered.includes('Do the thing.'), 'task should be substituted')
    assert.ok(!rendered.includes('{{'), 'no placeholder should survive')
  })
})
