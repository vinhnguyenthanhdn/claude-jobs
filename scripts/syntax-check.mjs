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
 *
 * `findScripts` and `checkSyntax` are exported so the gate itself can be tested
 * like any other unit; the scan only runs when this file is the process entry
 * point (#42). The entry-point comparison uses `pathToFileURL(process.argv[1])`
 * rather than the `file://${process.argv[1]}` template that is the usual way to
 * write it: the template never matches on Windows, so a gate guarded that way
 * exits 0 having run nothing. `process.argv[1]` is absent under `node -e`, so
 * it is checked before being converted.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Every tracked `.js` / `.mjs` file, `node_modules` excluded.
 * @param {string} [cwd] repository to enumerate; defaults to the process cwd.
 * @returns {string[]} repo-relative paths.
 */
export function findScripts(cwd) {
  return execFileSync('git', ['ls-files'], {encoding: 'utf8', cwd})
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => file.endsWith('.js') || file.endsWith('.mjs'))
    .filter((file) => !file.startsWith('node_modules/'))
}

/**
 * Parse one file with `node --check`.
 * @param {string} file path to check.
 * @param {string} [cwd] directory `file` is relative to.
 * @returns {{ok: boolean, stderr: string}}
 */
export function checkSyntax(file, cwd) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8', cwd})
  return {ok: result.status === 0, stderr: result.stderr || ''}
}

/**
 * Run the gate: enumerate, check each file, report.
 * @returns {number} process exit code.
 */
export function main() {
  const tracked = findScripts()

  if (tracked.length === 0) {
    console.error('syntax-check: found no tracked .js/.mjs files — refusing to pass on an empty scan')
    return 1
  }

  let failures = 0
  for (const file of tracked) {
    const {ok, stderr} = checkSyntax(file)
    console.log(`${ok ? '✓' : '✗'} ${file}`)
    if (!ok) {
      failures += 1
      if (stderr) {
        process.stderr.write(stderr)
      }
    }
  }

  console.log(`syntax-check: ${tracked.length - failures}/${tracked.length} files parse`)
  return failures > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
