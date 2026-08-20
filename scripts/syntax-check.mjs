#!/usr/bin/env node
/**
 * Syntax-check every `.js`/`.mjs` file in the repository, found rather than
 * listed.
 *
 * `npm run check` used to name two files by hand. The repository has eighteen,
 * and the fourteen it did not name were covered only by whichever test happened
 * to import them. Two were covered by nothing: `src/index.js`, the published
 * entry point, and `examples/openclaw/apply-claude-cli-backend.mjs`. A file that
 * did not parse could pass `npm run check`, pass `npm test`, pass
 * `npm pack --dry-run`, and reach the registry.
 *
 * Usage:
 *
 *     node scripts/syntax-check.mjs [root]
 *
 * Exit code 0 when every file parses, 1 when one does not -- and 1 when the
 * walk finds no files at all. That last case is the point of the script: a
 * directory rename must not turn the gate into a silent pass, which is the
 * failure mode a hand-written list has.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Directories never worth walking: not ours, or not source. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git'])

const EXTENSIONS = new Set(['.js', '.mjs'])

/**
 * Every `.js`/`.mjs` file under `root`, depth-first, in a stable order.
 *
 * Sorted so the output is the same on every machine and a failure is quotable.
 */
export function findScripts(root) {
  const found = []

  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return // unreadable or gone; nothing to check here
    }

    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      const full = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        walk(full)
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        found.push(full)
      }
    }
  }

  walk(root)
  return found
}

/** `node --check <file>`, returning the parse error when there is one. */
export function checkSyntax(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' })
    return null
  } catch (error) {
    return (error.stderr || error.message || '').trim()
  }
}

function main(argv) {
  const root = argv[0] ? path.resolve(argv[0]) : process.cwd()

  let rootIsDirectory = false
  try {
    rootIsDirectory = statSync(root).isDirectory()
  } catch {
    rootIsDirectory = false
  }
  if (!rootIsDirectory) {
    console.log(`syntax-check: ${root} is not a directory.`)
    return 1
  }

  const files = findScripts(root)

  // Zero files is a failure, not a pass. A gate that checks nothing and says
  // nothing is exactly what this script replaces.
  if (files.length === 0) {
    console.log(`syntax-check: found no .js or .mjs files under ${root}.`)
    console.log('Refusing to report success for a scan that checked nothing.')
    return 1
  }

  const failures = []
  for (const file of files) {
    const error = checkSyntax(file)
    if (error !== null) failures.push({ file, error })
  }

  const relative = (file) => path.relative(root, file).split(path.sep).join('/')

  for (const { file, error } of failures) {
    console.log(`syntax-check: ${relative(file)} does not parse:`)
    console.log(error)
    console.log()
  }

  if (failures.length > 0) {
    console.log(`syntax-check: ${failures.length} of ${files.length} file(s) failed to parse.`)
    return 1
  }

  console.log(`syntax-check: ${files.length} file(s) parsed.`)
  return 0
}

// pathToFileURL rather than a `file://` template: on Windows process.argv[1]
// is `C:\path\to\script.mjs` while import.meta.url is
// `file:///C:/path/to/script.mjs`, so the string comparison never matches and
// main() never runs. For a gate that is the exact failure this script exists
// to prevent -- `npm run check` would exit 0 having checked nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
