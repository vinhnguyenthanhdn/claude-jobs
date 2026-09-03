import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeLastRun, readLastRun } from '../src/runlog.js'

const CLI = fileURLToPath(new URL('../bin/claude-jobs.js', import.meta.url))

const stamp = (time, text) => `[${time}] ${text}`
const first = (logText, summaryTime = null) =>
  describeLastRun({ logText, summaryTime }).lines[0]

test('an empty or absent log says no run has happened, not that all is well', () => {
  for (const logText of [null, '', '\n\n']) {
    const { run, lines } = describeLastRun({ logText })
    assert.equal(run.state, 'never')
    assert.match(lines[0], /never/)
    // The actionable half: the state is indistinguishable from a job whose unit
    // was never loaded, so it has to name that.
    assert.match(lines.join('\n'), /not firing/)
  }
})

test('a run that spent no session says so, and says which precondition refused', () => {
  const log = [
    stamp('2026-09-01 09:04:11', '=== session end, exit=0 ==='),
    stamp('2026-09-02 09:07:40', '=== wake up, sleep 120s ==='),
    stamp('2026-09-02 09:09:40', 'precheck failed, skipping this session: git -C /repo pull'),
  ].join('\n')

  const line = first(log)
  assert.match(line, /2026-09-02 09:09:40/)
  assert.match(line, /spent no session/)
  assert.match(line, /git -C \/repo pull/)
  // The stale success from the day before must not be what gets reported.
  assert.doesNotMatch(line, /exit=0/)
})

test('a missing binary and a missing workdir are each named rather than reduced to "failed"', () => {
  assert.match(
    first(stamp('2026-09-03 09:00:02', 'claude binary not found at /opt/homebrew/bin/claude')),
    /claude binary not found at \/opt\/homebrew\/bin\/claude/,
  )
  assert.match(
    first(stamp('2026-09-03 09:00:02', 'workdir missing: /gone')),
    /workdir missing: \/gone/,
  )
})

test('a session that started and never ended is not reported as finished', () => {
  const line = first(stamp('2026-09-03 09:02:00', '=== session start ==='))
  assert.match(line, /never reported an exit/)
  assert.doesNotMatch(line, /finished/)
})

test('a non-zero exit keeps its number', () => {
  assert.match(first(stamp('2026-09-03 09:40:00', '=== session end, exit=143 ===')), /exit=143/)
  assert.match(first(stamp('2026-09-03 09:40:00', '=== session end, exit=0 ===')), /exit=0/)
})

test('the transcript written between the markers cannot be mistaken for one', () => {
  // The session is logged in stream-json into the same file, so lines of the
  // agent's own output sit between the runner's markers. Only the runner writes
  // the `[timestamp] ` prefix, and that is the whole of the discipline.
  // The imposters sit *after* the genuine marker on purpose: the reader scans
  // newest-first, so anything looser than "only prefixed lines count" reaches
  // them before it reaches the truth. Put them earlier and the case cannot
  // observe the difference.
  const log = [
    stamp('2026-09-03 09:02:00', '=== session start ==='),
    stamp('2026-09-03 09:40:00', '=== session end, exit=2 ==='),
    JSON.stringify({ type: 'text', text: '=== session end, exit=0 ===' }),
    '2026-09-03 09:41:00 === session end, exit=0 ===',
    'precheck failed, skipping this session: not a marker, no prefix',
  ].join('\n')

  const run = readLastRun(log)
  assert.equal(run.state, 'finished')
  assert.equal(run.exit, 2)
})

test('a summary older than the last run is called out instead of read as its report', () => {
  const log = stamp('2026-09-03 09:40:00', '=== session end, exit=1 ===')
  const stale = new Date('2026-08-30T09:40:00')
  const fresh = new Date('2026-09-03T09:40:05')

  const staleLines = describeLastRun({ logText: log, summaryTime: stale }).lines
  assert.match(staleLines.join('\n'), /older than this run/)

  const freshLines = describeLastRun({ logText: log, summaryTime: fresh }).lines
  assert.doesNotMatch(freshLines.join('\n'), /older than this run/)
})

test('status prints the last run and the age of the summary it shows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-jobs-lastrun-'))
  const home = join(dir, 'home')
  try {
    execFileSync(process.execPath, [CLI, 'init', 'demo', '--task', 'hi', '--scheduler', 'cron'], {
      env: { ...process.env, CLAUDE_JOBS_HOME: home },
      stdio: 'ignore',
    })

    writeFileSync(
      join(home, 'logs', 'demo.log'),
      `${stamp('2026-09-03 09:07:40', '=== wake up, sleep 60s ===')}\n` +
        `${stamp('2026-09-03 09:08:40', 'precheck failed, skipping this session: test -f /flag')}\n`,
    )
    const summary = join(home, 'state', 'demo-summary.md')
    writeFileSync(summary, 'all good\n')
    const old = new Date('2026-08-28T10:00:00').getTime() / 1000
    utimesSync(summary, old, old)

    const out = execFileSync(process.execPath, [CLI, 'status', 'demo'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_JOBS_HOME: home },
    })

    assert.match(out, /^last run {3}2026-09-03 09:08:40 — spent no session: precheck failed/m)
    assert.match(out, /older than this run/)
    assert.match(out, /--- last summary \(written 2026-08-28T/)
    assert.match(out, /all good/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every marker the runner writes is one this reader classifies', () => {
  // The reader and `templates/run.sh` are two files that have to agree, and a
  // marker added to the runner alone would go straight into the "never"
  // bucket — the reader would say nothing had happened while the log said
  // otherwise. Pull the markers out of the runner and demand each one parse.
  const runner = fileURLToPath(new URL('../templates/run.sh', import.meta.url))
  const body = readTemplateText(runner)
  const written = [...body.matchAll(/^\s*log "(.+)"$/gm)].map((m) => m[1])
  assert.ok(written.length >= 6, `expected the runner's log lines, found ${written.length}`)

  const unclassified = []
  for (const raw of written) {
    // Substitute a plausible value for every shell expansion in the marker.
    const text = raw
      .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '7')
      .replace(/\$\([^)]*\)/g, '7')
      .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '7')
      .replace(/\\"/g, '"')
    const run = readLastRun(stamp('2026-09-03 09:00:00', text))
    if (run.state === 'never') unclassified.push(raw)
  }
  assert.deepEqual(
    unclassified,
    [],
    `templates/run.sh writes markers src/runlog.js does not read:\n${unclassified.join('\n')}`,
  )
})

function readTemplateText(path) {
  return execFileSync('/bin/cat', [path], { encoding: 'utf8' })
}
