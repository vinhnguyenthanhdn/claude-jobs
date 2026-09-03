/**
 * Reads the log a run already wrote and says what the last run did.
 *
 * A scheduled job fails in two ways. It crashes — and the log says so — or it
 * quietly does nothing: the precheck refuses every day, the binary moved, the
 * unit was never loaded. In that second shape `status` used to look identical
 * to a healthy job, because the only thing it printed from a run was the last
 * summary, and a summary from four days ago reads exactly like one from this
 * morning. Nothing here sends or collects anything: every line below is already
 * on disk, written by the runner in `templates/run.sh`.
 */

/** `[2026-09-03 09:14:22] === session start ===` → the two halves. */
const LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (.*)$/

/**
 * The markers the runner writes, newest-wins. Order matters only for reading:
 * each entry answers "if this was the last thing the runner said, what happened".
 */
const MARKERS = [
  {
    match: /^=== session end, exit=(\d+) ===$/,
    describe: (m) => ({ state: 'finished', exit: Number(m[1]) }),
  },
  { match: /^=== session start ===$/, describe: () => ({ state: 'started' }) },
  {
    match: /^precheck failed, skipping this session: (.*)$/,
    describe: (m) => ({ state: 'skipped', why: `precheck failed: ${m[1]}` }),
  },
  {
    match: /^claude binary not found at (.*)$/,
    describe: (m) => ({ state: 'skipped', why: `claude binary not found at ${m[1]}` }),
  },
  {
    match: /^workdir missing: (.*)$/,
    describe: (m) => ({ state: 'skipped', why: `workdir missing: ${m[1]}` }),
  },
  {
    match: /^=== wake up, sleep (\d+)s ===$/,
    describe: (m) => ({ state: 'waking', delay: Number(m[1]) }),
  },
  // Rotation is the first thing a run writes, so seeing it last means the run
  // stopped before it even reached the jitter window. Everything earlier is in
  // `<log>.1` — worth saying, because this file legitimately looks near-empty.
  { match: /^rotated previous log \(.*\) to (.*)$/, describe: (m) => ({ state: 'rotated', prev: m[1] }) },
]

/**
 * @param {string|null} logText contents of the job log, or null when absent
 * @returns {{state: string, at?: string, exit?: number, why?: string, delay?: number}}
 */
export function readLastRun(logText) {
  if (!logText) return { state: 'never' }

  for (const raw of logText.split('\n').reverse()) {
    const line = LINE.exec(raw.trimEnd())
    if (!line) continue
    for (const marker of MARKERS) {
      const hit = marker.match.exec(line[2])
      if (hit) return { ...marker.describe(hit), at: line[1] }
    }
  }
  return { state: 'never' }
}

/**
 * One line for `status`, plus a warning line when the summary on disk belongs
 * to an older run than the last session — the case that reads as healthy.
 *
 * @param {object} args
 * @param {string|null} args.logText
 * @param {Date|null} args.summaryTime mtime of the summary file, when it exists
 */
export function describeLastRun({ logText, summaryTime = null }) {
  const run = readLastRun(logText)
  const lines = []

  if (run.state === 'never') {
    lines.push('never — no run has written to the log yet')
    lines.push('  if the job is installed and its time has passed, the unit is not firing: reinstall it')
    return { run, lines }
  }

  if (run.state === 'finished') {
    lines.push(
      run.exit === 0
        ? `${run.at} — finished, exit=0`
        : `${run.at} — finished, exit=${run.exit} (the session failed; the log holds the transcript)`,
    )
  } else if (run.state === 'started') {
    lines.push(`${run.at} — started and never reported an exit (still running, or killed)`)
  } else if (run.state === 'skipped') {
    lines.push(`${run.at} — spent no session: ${run.why}`)
  } else if (run.state === 'waking') {
    lines.push(`${run.at} — woke up and slept ${run.delay}s, then wrote nothing further`)
  } else if (run.state === 'rotated') {
    lines.push(`${run.at} — rotated this log and stopped there; the run before it is in ${run.prev}`)
  }

  // A summary older than the last session is the quiet failure this exists for:
  // the run happened, wrote nothing, and `status` kept printing an old report.
  if (run.state !== 'never' && summaryTime) {
    const sessionTime = Date.parse(run.at.replace(' ', 'T'))
    if (Number.isFinite(sessionTime) && summaryTime.getTime() < sessionTime) {
      lines.push(
        `  the summary below is older than this run — that run wrote none, so it is not its report`,
      )
    }
  }

  return { run, lines }
}
