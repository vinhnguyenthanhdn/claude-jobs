import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readTemplate, render, renderTemplate, shellQuote } from './render.js'
import {
  assertValidName,
  ensureDirs,
  jobDir,
  listJobNames,
  logFile,
  promptFile,
  readJob,
  runnerFile,
  summaryFile,
  writeJob,
} from './paths.js'
import {
  cronLine,
  defaultScheduler,
  install,
  isInstalled,
  parseTime,
  schedulerFilesFor,
  uninstall,
  writeSchedulerFiles,
} from './schedulers.js'

const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'

function findClaudeBinary() {
  const found = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' })
  const path = found.stdout?.trim().split('\n')[0]
  return path || 'claude'
}

/** Writes run.sh from the template with every value baked in. */
export function writeRunner(job) {
  const script = renderTemplate('run.sh', {
    JOB_NAME: job.name,
    JOB_NAME_Q: shellQuote(job.name),
    JOB_DIR_Q: shellQuote(jobDir(job.name)),
    WORKDIR_Q: shellQuote(job.workdir),
    CLAUDE_BIN_Q: shellQuote(job.claudeBin),
    LOG_FILE_Q: shellQuote(logFile(job.name)),
    SUMMARY_FILE_Q: shellQuote(summaryFile(job.name)),
    PATH_VALUE: shellQuote(job.path),
    HOME_VALUE: shellQuote(job.home),
    JITTER: job.jitter,
    PERMISSION_MODE_Q: shellQuote(job.permissionMode),
    MODEL_Q: shellQuote(job.model || ''),
    PRECHECK_Q: shellQuote(job.precheck || ''),
    NOTIFY_Q: shellQuote(job.notify || ''),
  })
  writeFileSync(runnerFile(job.name), script)
  chmodSync(runnerFile(job.name), 0o755)
}

export function buildJob(name, flags) {
  const { hour, minute } = parseTime(flags.at || '09:00')
  const task = flags.task
    ? flags.task
    : flags.skill
      ? `Run the skill at ${resolve(flags.skill)} for today's session.\n\nRead it and follow it end to end.`
      : 'Describe the task here, then point at whatever file holds the real instructions.'

  return {
    name,
    task,
    workdir: resolve(flags.workdir || process.cwd()),
    claudeBin: flags.claude || findClaudeBinary(),
    scheduler: flags.scheduler || defaultScheduler(),
    hour,
    minute,
    jitter: flags.jitter === undefined ? 900 : Number(flags.jitter),
    permissionMode: flags['permission-mode'] || 'bypassPermissions',
    model: flags.model || '',
    precheck: flags.precheck || '',
    notify: flags.notify || '',
    path: flags.path || process.env.PATH || DEFAULT_PATH,
    home: process.env.HOME || '',
    createdAt: new Date().toISOString(),
  }
}

export function cmdInit(args, flags) {
  const name = assertValidName(args[0] || '')
  if (existsSync(jobDir(name)) && !flags.force) {
    throw new Error(`job "${name}" already exists. Pass --force to overwrite it.`)
  }
  if (flags.jitter !== undefined) {
    if (typeof flags.jitter === 'boolean' || !/^\d+$/.test(String(flags.jitter))) {
      throw new Error(`--jitter must be a non-negative integer. Received "${flags.jitter}".`)
    }
  }
  if (flags.skill !== undefined) {
    if (typeof flags.skill === 'boolean' || !existsSync(resolve(flags.skill))) {
      throw new Error(`--skill file not found: "${flags.skill}".`)
    }
  }
  if (flags['prompt-file'] !== undefined) {
    if (typeof flags['prompt-file'] === 'boolean' || !existsSync(resolve(flags['prompt-file']))) {
      throw new Error(`--prompt-file not found: "${flags['prompt-file']}".`)
    }
  }
  ensureDirs()

  const job = buildJob(name, flags)
  writeJob(name, job)
  writeFileSync(
    promptFile(name),
    render(readPromptTemplate(flags), { TASK: job.task, SUMMARY_FILE: summaryFile(name) }),
  )
  writeRunner(job)
  const created = writeSchedulerFiles(job)

  console.log(`Created job "${name}"`)
  console.log(`  prompt    ${promptFile(name)}`)
  console.log(`  runner    ${runnerFile(name)}`)
  console.log(`  log       ${logFile(name)}`)
  console.log(`  summary   ${summaryFile(name)}`)
  for (const path of created) console.log(`  scheduler ${path}`)
  if (job.scheduler === 'cron') console.log(`  crontab   ${cronLine(job)}`)
  console.log('')
  console.log('Next:')
  console.log(`  1. Edit the prompt:  ${promptFile(name)}`)
  console.log(`  2. Dry run:          claude-jobs run ${name} --dry-run`)
  console.log(`  3. Real run now:     claude-jobs run ${name} --now`)
  console.log(`  4. Schedule it:      claude-jobs install ${name}`)
}

function readPromptTemplate(flags) {
  if (flags['prompt-file']) return readFileSync(resolve(flags['prompt-file']), 'utf8')
  return readTemplate('prompt.md')
}

export function cmdList() {
  const names = listJobNames()
  if (names.length === 0) {
    console.log('No jobs yet. Create one with: claude-jobs init <name> --skill <path>')
    return
  }
  console.log('NAME'.padEnd(24) + 'AT'.padEnd(8) + 'SCHEDULER'.padEnd(12) + 'INSTALLED')
  for (const name of names) {
    const job = readJob(name)
    const at = `${String(job.hour).padStart(2, '0')}:${String(job.minute).padStart(2, '0')}`
    console.log(
      name.padEnd(24) +
        at.padEnd(8) +
        job.scheduler.padEnd(12) +
        (isInstalled(job) ? 'yes' : 'no'),
    )
  }
}

export function cmdRun(args, flags) {
  const job = readJob(args[0])
  const runnerArgs = []
  if (flags['dry-run']) runnerArgs.push('--dry-run')
  if (flags.now || flags['dry-run']) runnerArgs.push('--now')
  execFileSync('/bin/bash', [runnerFile(job.name), ...runnerArgs], { stdio: 'inherit' })
}

export function cmdInstall(args) {
  const job = readJob(args[0])
  writeRunner(job)
  const created = install(job)
  for (const path of created) console.log(`wrote ${path}`)
  console.log(`Installed "${job.name}" via ${job.scheduler}.`)
}

export function cmdUninstall(args, flags) {
  const job = readJob(args[0])
  uninstall(job)
  console.log(`Uninstalled "${job.name}" from ${job.scheduler}.`)
  if (flags.purge) {
    rmSync(jobDir(job.name), { recursive: true, force: true })
    console.log(`Removed ${jobDir(job.name)}`)
  }
}

export function cmdLogs(args, flags) {
  const job = readJob(args[0])
  const path = logFile(job.name)
  if (!existsSync(path)) {
    console.log(`No log yet at ${path}`)
    return
  }
  const lines = Number(flags.lines || 40)
  execFileSync('tail', ['-n', String(lines), path], { stdio: 'inherit' })
}

export function cmdStatus(args) {
  const job = readJob(args[0])
  const summary = summaryFile(job.name)
  console.log(`job        ${job.name}`)
  console.log(`schedule   ${String(job.hour).padStart(2, '0')}:${String(job.minute).padStart(2, '0')} daily (+ up to ${job.jitter}s jitter)`)
  console.log(`scheduler  ${job.scheduler} (${isInstalled(job) ? 'installed' : 'not installed'})`)
  console.log(`workdir    ${job.workdir}`)
  console.log(`claude     ${job.claudeBin}`)
  for (const path of schedulerFilesFor(job)) console.log(`unit       ${path}`)
  console.log(`log        ${logFile(job.name)}`)
  if (existsSync(summary)) {
    console.log('')
    console.log('--- last summary ---')
    console.log(readFileSync(summary, 'utf8').trim())
  }
}

/**
 * `claude auth status` prints JSON on recent versions and prose on older ones,
 * so reduce whichever we got to one honest line.
 */
function describeAuth(text) {
  if (!text) return 'no output'
  try {
    const info = JSON.parse(text)
    if (!info.loggedIn) return 'not logged in — run "claude auth login"'
    const who = [info.subscriptionType, info.email].filter(Boolean).join(', ')
    return who ? `logged in (${who})` : 'logged in'
  } catch {
    return text.split('\n')[0]
  }
}

export function cmdDoctor() {
  const checks = []
  const claude = findClaudeBinary()
  checks.push([existsSync(claude) || claude !== 'claude', `claude binary: ${claude}`])

  const auth = spawnSync(claude, ['auth', 'status'], { encoding: 'utf8' })
  const authText = `${auth.stdout || ''}${auth.stderr || ''}`.trim()
  checks.push([auth.status === 0, `claude auth: ${describeAuth(authText)}`])

  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY)
  checks.push([
    true,
    hasApiKey
      ? 'ANTHROPIC_API_KEY is set — runs will bill the API, not your subscription'
      : 'ANTHROPIC_API_KEY not set — runs use the CLI login (subscription)',
  ])

  checks.push([true, `scheduler: ${defaultScheduler()}`])
  checks.push([true, `jobs: ${listJobNames().length}`])

  for (const [ok, message] of checks) console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (!checks.every(([ok]) => ok)) {
    console.log('')
    console.log('Fix: install Claude Code, then run "claude auth login" as the same user that runs the jobs.')
  }
}
