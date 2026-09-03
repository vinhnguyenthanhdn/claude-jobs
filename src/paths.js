import { UsageError } from './errors.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

/** Root of all job state. Override with CLAUDE_JOBS_HOME (used by the tests). */
export function root() {
  return process.env.CLAUDE_JOBS_HOME || join(homedir(), '.claude-jobs')
}

export const jobsDir = () => join(root(), 'jobs')
export const logsDir = () => join(root(), 'logs')
export const stateDir = () => join(root(), 'state')

export const jobDir = (name) => join(jobsDir(), name)
export const jobFile = (name) => join(jobDir(name), 'job.json')
export const promptFile = (name) => join(jobDir(name), 'prompt.md')
export const runnerFile = (name) => join(jobDir(name), 'run.sh')
export const logFile = (name) => join(logsDir(), `${name}.log`)
/**
 * The previous generation of a job's log, after the runner rotated it.
 *
 * The generated runner (`templates/run.sh`) keeps one generation of rollover
 * and names it `$LOG.1` — the `.1` suffix exists only as a string inside that
 * template. Exporting it here gives the JS side a single source of truth for
 * the name, so anything that must also touch the rotated log (like
 * `uninstall --purge`) does not spell the suffix out a second time.
 */
export const rotatedLogFile = (name) => join(logsDir(), `${name}.log.1`)
export const summaryFile = (name) => join(stateDir(), `${name}-summary.md`)

export function ensureDirs() {
  for (const dir of [root(), jobsDir(), logsDir(), stateDir()]) {
    mkdirSync(dir, { recursive: true })
  }
}

export function listJobNames() {
  if (!existsSync(jobsDir())) return []
  return readdirSync(jobsDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(jobFile(entry.name)))
    .map((entry) => entry.name)
    .sort()
}

export function readJob(name) {
  if (!existsSync(jobFile(name))) {
    throw new UsageError(`job "${name}" not found. Run "claude-jobs list" to see what exists.`)
  }
  const path = jobFile(name)
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    // A JSON parse error on its own names neither the file nor the job — it
    // arrives as `Expected property name or '}' at position 1` and reads like a
    // bug in the tool. Say which file is broken and how to get out of it.
    throw new UsageError(
      `job "${name}" has an unreadable job.json: ${err.message}\n` +
        `  file: ${path}\n` +
        `  fix it by hand, or delete the job directory and run "claude-jobs init ${name}" again.`,
    )
  }
}

export function writeJob(name, job) {
  mkdirSync(jobDir(name), { recursive: true })
  writeFileSync(jobFile(name), `${JSON.stringify(job, null, 2)}\n`)
}

/**
 * Job names become filenames, launchd labels and systemd unit names, so keep
 * them boring on purpose.
 */
export function assertValidName(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new UsageError(
      `invalid job name "${name}". Use lowercase letters, digits and dashes (max 64 chars).`,
    )
  }
  return name
}
