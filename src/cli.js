import { UsageError } from './errors.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  cmdDoctor,
  cmdInit,
  cmdInstall,
  cmdList,
  cmdLogs,
  cmdRun,
  cmdStatus,
  cmdUninstall,
} from './commands.js'

const USAGE = `claude-jobs — scheduled, unattended Claude Code CLI runs (no API key)

Usage:
  claude-jobs init <name> [options]   scaffold a job (prompt + runner + scheduler unit)
  claude-jobs list                    list jobs and whether they are scheduled
  claude-jobs run <name> [--now]      run a job now (--dry-run prints the plan)
  claude-jobs install <name>          register the job with the OS scheduler
  claude-jobs uninstall <name>        unregister it (--purge also deletes the job dir, log and summary)
  claude-jobs logs <name> [--lines N] tail the job log
  claude-jobs status <name>           schedule, paths and the last summary
  claude-jobs doctor                  check the CLI, its login and the scheduler
  claude-jobs --version               print the installed version

init options:
  --skill <path>          file the agent should read and follow (SKILL.md, runbook, checklist)
  --task <text>           inline task instead of --skill
  --prompt-file <path>    use your own prompt template instead of the built-in one
  --at <HH:MM>            daily start time, 24-hour (default 09:00)
  --jitter <seconds>      random extra delay before starting (default 900, 0 disables)
  --log-max-bytes <n>     rotate the log to <log>.1 past this size (default 5242880, 0 disables)
  --workdir <path>        directory the run starts in (default: current directory)
  --scheduler <name>      launchd | systemd | cron (default: per platform)
  --claude <path>         claude binary (default: whatever is on PATH)
  --model <name>          pass --model to the CLI
  --permission-mode <m>   default bypassPermissions (unattended runs cannot answer prompts)
  --precheck <command>    shell command that must succeed before a session is spent
  --notify <command>      shell command that receives the summary in $CLAUDE_JOB_MESSAGE
  --path <PATH>           PATH exported inside the runner
  --force                 overwrite an existing job

Docs: https://github.com/vinhnguyenthanhdn/claude-jobs
`

// Every flag in the `init options` block of USAGE that takes a value. The suite
// parses that block and asserts equality in both directions, so a flag added to
// either side and not the other turns the tests red (#16, #36).
export const INIT_VALUE_FLAGS = new Set([
  'skill',
  'task',
  'prompt-file',
  'at',
  'jitter',
  'log-max-bytes',
  'workdir',
  'scheduler',
  'claude',
  'model',
  'permission-mode',
  'precheck',
  'notify',
  'path',
])

/**
 * Value flags documented in the `init options` block of USAGE itself, parsed
 * from live text rather than re-typed, so the docs are the source of truth.
 * Slices from the `init options:` line to the next blank-line-then-unindented
 * line and matches the `--flag <value>` shape.
 */
export function initValueFlagsFromUsage() {
  const match = USAGE.match(/init options:([\s\S]*?)\n\n\S/)
  if (!match) throw new UsageError('USAGE lost its `init options` block')
  const parsed = new Set()
  for (const flag of match[1].matchAll(/^\s+--([a-z-]+) </gm)) {
    parsed.add(flag[1])
  }
  return parsed
}

export function parseArgs(argv) {
  const args = []
  const flags = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (!token.startsWith('--')) {
      args.push(token)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]

    if (next === undefined || next.startsWith('--')) {
      if (INIT_VALUE_FLAGS.has(key)) {
        throw new UsageError(`--${key} requires a value.`)
      }

      flags[key] = true
    } else {
      flags[key] = next
      i += 1
    }
  }

  return { args, flags }
}

export function version() {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  return pkg.version
}

export async function main(argv) {
  const { args, flags } = parseArgs(argv)
  const command = args.shift()

  if (flags.version || command === 'version') {
    console.log(version())
    return
  }

  if (!command || flags.help || command === 'help') {
    console.log(USAGE)
    return
  }

  switch (command) {
    case 'init':
      return cmdInit(args, flags)
    case 'list':
      return cmdList()
    case 'run':
      if (!args[0]) throw new UsageError('run needs a job name. Run "claude-jobs list" to see them.')
      return cmdRun(args, flags)
    case 'install':
      if (!args[0]) throw new UsageError('install needs a job name. Run "claude-jobs list" to see them.')
      return cmdInstall(args)
    case 'uninstall':
      if (!args[0]) throw new UsageError('uninstall needs a job name. Run "claude-jobs list" to see them.')
      return cmdUninstall(args, flags)
    case 'logs':
      if (!args[0]) throw new UsageError('logs needs a job name. Run "claude-jobs list" to see them.')
      return cmdLogs(args, flags)
    case 'status':
      if (!args[0]) throw new UsageError('status needs a job name. Run "claude-jobs list" to see them.')
      return cmdStatus(args)
    case 'doctor':
      return cmdDoctor()
    default:
      throw new UsageError(`unknown command "${command}". Run "claude-jobs help".`)
  }
}
