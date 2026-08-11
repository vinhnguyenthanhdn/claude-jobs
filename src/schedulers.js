import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from './render.js'
import { logFile, runnerFile } from './paths.js'

const pad = (n) => String(n).padStart(2, '0')

export function defaultScheduler() {
  if (process.env.CLAUDE_JOBS_SCHEDULER) return process.env.CLAUDE_JOBS_SCHEDULER
  if (platform() === 'darwin') return 'launchd'
  if (platform() === 'linux') return 'systemd'
  return 'cron'
}

export function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value).trim())
  if (!match) throw new Error(`invalid --at "${value}". Use 24-hour HH:MM, e.g. 09:30.`)
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

const launchdLabel = (name) => `com.claude-jobs.${name}`
const launchdPlist = (name) =>
  join(homedir(), 'Library', 'LaunchAgents', `${launchdLabel(name)}.plist`)
const systemdDir = () => join(homedir(), '.config', 'systemd', 'user')
const systemdUnit = (name, ext) => join(systemdDir(), `claude-jobs-${name}.${ext}`)
const cronMarker = (name) => `# claude-jobs:${name}`

/** Writes the scheduler's own config file. Returns the paths it created. */
export function writeSchedulerFiles(job) {
  const { name, scheduler, hour, minute, workdir } = job
  const vars = {
    JOB_NAME: name,
    LABEL: launchdLabel(name),
    RUNNER: runnerFile(name),
    LOG_FILE: logFile(name),
    WORKDIR: workdir,
    HOUR: hour,
    MINUTE: minute,
    HOUR_PADDED: pad(hour),
    MINUTE_PADDED: pad(minute),
  }

  if (scheduler === 'launchd') {
    const path = launchdPlist(name)
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(path, renderTemplate('launchd.plist', vars))
    return [path]
  }

  if (scheduler === 'systemd') {
    mkdirSync(systemdDir(), { recursive: true })
    const service = systemdUnit(name, 'service')
    const timer = systemdUnit(name, 'timer')
    writeFileSync(service, renderTemplate('systemd.service', vars))
    writeFileSync(timer, renderTemplate('systemd.timer', vars))
    return [service, timer]
  }

  if (scheduler === 'cron') return []

  throw new Error(`unknown scheduler "${scheduler}". Use launchd, systemd or cron.`)
}

export function cronLine(job) {
  return `${job.minute} ${job.hour} * * * /bin/bash ${runnerFile(job.name)} ${cronMarker(job.name)}`
}

function currentCrontab() {
  try {
    return execSync('crontab -l', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

const cronMarkerRegex = (name) => new RegExp(`# claude-jobs:${name}[ \\t]*$`, 'm')

export function crontabHas(existing, name) {
  return cronMarkerRegex(name).test(existing)
}

export function crontabWithout(existing, name) {
  return existing
    .split('\n')
    .filter((line) => !crontabHas(line, name))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function writeCrontab(content) {
  const body = content.trimEnd()
  execSync('crontab -', { input: body ? `${body}\n` : '' })
}

/** Registers the job with the OS so it starts firing. */
export function install(job) {
  const { name, scheduler } = job
  const created = writeSchedulerFiles(job)

  if (scheduler === 'launchd') {
    const path = launchdPlist(name)
    try {
      execFileSync('launchctl', ['unload', path], { stdio: 'ignore' })
    } catch {
      // Not loaded yet — that is the normal first-install path.
    }
    execFileSync('launchctl', ['load', path], { stdio: 'inherit' })
  } else if (scheduler === 'systemd') {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' })
    execFileSync('systemctl', ['--user', 'enable', '--now', `claude-jobs-${name}.timer`], {
      stdio: 'inherit',
    })
  } else if (scheduler === 'cron') {
    writeCrontab(`${crontabWithout(currentCrontab(), name)}\n${cronLine(job)}`)
  }

  return created
}

export function uninstall(job) {
  const { name, scheduler } = job

  if (scheduler === 'launchd') {
    const path = launchdPlist(name)
    try {
      execFileSync('launchctl', ['unload', path], { stdio: 'ignore' })
    } catch {
      // Already unloaded.
    }
    if (existsSync(path)) rmSync(path)
  } else if (scheduler === 'systemd') {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', `claude-jobs-${name}.timer`], {
        stdio: 'ignore',
      })
    } catch {
      // Already disabled.
    }
    for (const ext of ['service', 'timer']) {
      const path = systemdUnit(name, ext)
      if (existsSync(path)) rmSync(path)
    }
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    } catch {
      // systemd not running (container, CI) — nothing left to reload.
    }
  } else if (scheduler === 'cron') {
    writeCrontab(crontabWithout(currentCrontab(), name))
  }
}

/**
 * Whether the scheduler will actually fire this job.
 *
 * `init` writes the unit file so you can read it before committing, so the file
 * existing proves nothing — ask the scheduler itself.
 */
export function isInstalled(job) {
  const { name, scheduler } = job

  if (scheduler === 'launchd') {
    if (!existsSync(launchdPlist(name))) return false
    try {
      execFileSync('launchctl', ['list', launchdLabel(name)], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  if (scheduler === 'systemd') {
    if (!existsSync(systemdUnit(name, 'timer'))) return false
    try {
      execFileSync('systemctl', ['--user', 'is-enabled', `claude-jobs-${name}.timer`], {
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  if (scheduler === 'cron') return crontabHas(currentCrontab(), name)
  return false
}

export function schedulerFilesFor(job) {
  if (job.scheduler === 'launchd') return [launchdPlist(job.name)]
  if (job.scheduler === 'systemd')
    return [systemdUnit(job.name, 'service'), systemdUnit(job.name, 'timer')]
  return []
}

export function readSchedulerFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}
