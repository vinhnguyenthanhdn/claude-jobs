#!/usr/bin/env node
/**
 * Syntax-check every tracked `.js` / `.mjs` file in the repository.
 *
 * `node --check bin/claude-jobs.js && node --check src/cli.js` only names two
 * files; the other sixteen are checked only when a test happens to import
 * them, and two of them — `src/index.js` (the published entry point) and
 * `examples/openclaw/apply-claude-cli-backend.mjs` — are imported by nothing.
 * A break in either of those passes `npm run check`, `npm test` and the release
 * gates, and reaches the registry (#40).
 *
 * This script walks every tracked `.js` / `.mjs` file, skips `node_modules`,
 * runs `node --check` on each, prints how many it checked, and exits non-zero
 * if it checked none — a directory rename must not turn this into a silent
 * no-op.
 *
 * Requires `git` (files are enumerated via `git ls-files` so the check matches
 * what is actually shipped, not whatever happens to sit in the worktree).
 */

import { execFileSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files'], {encoding: 'utf8'})
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((file) => file.endsWith('.js') || file.endsWith('.mjs'))
  .filter((file) => !file.startsWith('node_modules/'))

if (tracked.length === 0) {
  console.error(`syntax-check: found no tracked .js/.mjs files — refusing to pass on an empty scan`)
  process.exit(1)
}

let failures = 0
for (const file of tracked) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'})
  const ok = result.status === 0
  console.log(`${ok ? '✓' : '✗'} ${file}`)
  if (!ok) {
    failures += 1
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
  }
}

console.log(`syntax-check: ${tracked.length - failures}/${tracked.length} files parse`)
if (failures > 0) {
  process.exit(1)
}