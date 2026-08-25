import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/claude-jobs.js', import.meta.url))

function runDoctor(authOutput) {
  const scratch = mkdtempSync(join(tmpdir(), 'claude-jobs-doctor-'))
  const fakeClaude = join(scratch, 'claude')
  writeFileSync(fakeClaude, `#!/bin/sh\nprintf '%s\\n' "$FAKE_AUTH_OUTPUT"\n`)
  chmodSync(fakeClaude, 0o755)

  try {
    return execFileSync(process.execPath, [CLI, 'doctor'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${scratch}${delimiter}${process.env.PATH || ''}`,
        CLAUDE_JOBS_HOME: join(scratch, 'home'),
        CLAUDE_JOBS_SCHEDULER: 'cron',
        FAKE_AUTH_OUTPUT: authOutput,
      },
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('doctor keeps the subscription type but never prints the email from JSON auth status', () => {
  const out = runDoctor(
    JSON.stringify({ loggedIn: true, subscriptionType: 'team', email: 'person@example.test' }),
  )

  assert.match(out, /claude auth: logged in \(team\)/)
  assert.doesNotMatch(out, /person@example\.test/)
})

test('doctor redacts an email in legacy prose auth status', () => {
  const out = runDoctor('Logged in as person@example.test')

  assert.match(out, /claude auth: Logged in as \[email redacted\]/)
  assert.doesNotMatch(out, /person@example\.test/)
})
