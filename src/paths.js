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
/** The previous generation written by run.sh when it rotates (`mv "$LOG" "$LOG.1"`). */
export const rotatedLogFile = (name) => `${logFile(name)}.1`
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
    throw new Error(`job "${name}" not found. Run "claude-jobs list" to see what exists.`)
  }
  return JSON.parse(readFileSync(jobFile(name), 'utf8'))
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
    throw new Error(
      `invalid job name "${name}". Use lowercase letters, digits and dashes (max 64 chars).`,
    )
  }
  return name
}
