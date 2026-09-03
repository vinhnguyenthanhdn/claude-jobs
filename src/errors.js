export const BUG_REPORT_URL =
  'https://github.com/vinhnguyenthanhdn/claude-jobs/issues/new?template=bug_report.yml'

/**
 * A failure the caller can fix from the message alone: a missing argument, a
 * name that does not exist, a flag with a bad value.
 *
 * The distinction matters because it decides what the CLI prints. Usage errors
 * get one line and nothing else — a person who forgot a job name does not need
 * to be told to file a bug. Everything else escaping `main` is a failure this
 * tool did not anticipate, and those are exactly the ones a user cannot act on:
 * a bare `Expected property name or '}' in JSON at position 1` names no file,
 * no job and no place to report it, so it produces a shrug instead of an issue.
 */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.isUsage = true
  }
}

export const usageError = (message) => new UsageError(message)

/** What `bin/claude-jobs.js` prints before exiting 1. */
export function formatFatal(err, env = process.env) {
  const message = err && err.message ? err.message : String(err)
  if (err && err.isUsage) return `claude-jobs: ${message}`

  const lines = [
    `claude-jobs: ${message}`,
    '',
    'That is an unexpected failure, not something you passed — so it is a bug here.',
    '  1. claude-jobs doctor    prints the environment, the CLI login and the scheduler',
    `  2. report it with that output: ${BUG_REPORT_URL}`,
  ]
  if (env.CLAUDE_JOBS_DEBUG === '1' && err && err.stack) lines.push('', err.stack)
  else lines.push('Set CLAUDE_JOBS_DEBUG=1 to print the stack trace too.')
  return lines.join('\n')
}
