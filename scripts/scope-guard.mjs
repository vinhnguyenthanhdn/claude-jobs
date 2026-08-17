#!/usr/bin/env node
/**
 * Fail a pull request that removes a public export from `src/` without naming
 * that export in the pull request description.
 *
 * This package publishes `src/index.js` as its entry point, so a name that
 * disappears from `src/` is a breaking change for anyone who installed it. The
 * scope rule in CONTRIBUTING.md asks for the same thing in prose; prose is
 * skippable and a CI job is not.
 *
 * Usage:
 *
 *     PR_BODY="<pull request description>" node scripts/scope-guard.mjs <base-sha> <head-sha>
 *
 * Exit code 0 when every removed export is mentioned in PR_BODY, 1 otherwise.
 *
 * Scope of the scanner: it recognises `export` statements written at the start
 * of a line, which is every export in this repository and the only form the
 * style allows. A name exported from inside a block or a template literal is
 * not seen. `export * from` cannot be enumerated without resolving the target,
 * so it is reported and skipped rather than guessed at.
 */

import { execFileSync } from 'node:child_process'

const WATCHED_PREFIX = 'src/'

/** Names a module exports, as far as a line-anchored scan can tell. */
export function exportedNames(source) {
  const names = new Set()
  const opaque = []

  // `export { a, b as c }` and `export { a } from './x.js'`, possibly wrapped
  // across several lines.
  const blocks = source.matchAll(/^export\s*\{([^}]*)\}/gm)
  for (const [, inner] of blocks) {
    for (const clause of inner.split(',')) {
      const parts = clause.trim().split(/\s+as\s+/)
      const exported = (parts[parts.length - 1] || '').trim()
      if (exported && exported !== 'default') names.add(exported)
    }
  }

  // `export function f`, `export async function f`, `export class C`,
  // `export const x`, `export let x`, `export var x`.
  const declarations = source.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  )
  for (const [, name] of declarations) names.add(name)

  if (/^export\s+default\b/m.test(source)) names.add('default')
  for (const [line] of source.matchAll(/^export\s+\*.*$/gm)) opaque.push(line.trim())

  return { names, opaque }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

/** File content at `ref`, or null when the file does not exist there. */
function blob(ref, path) {
  try {
    return git('show', `${ref}:${path}`)
  } catch {
    return null
  }
}

function changedSourceFiles(base, head) {
  const out = git('diff', '--name-only', `${base}...${head}`, '--', `${WATCHED_PREFIX}*.js`)
  return out.split('\n').filter((line) => line.trim() !== '')
}

function main(argv) {
  const [base, head] = argv
  if (!base || !head) {
    console.log('usage: PR_BODY=... node scripts/scope-guard.mjs <base-sha> <head-sha>')
    return 1
  }
  const body = process.env.PR_BODY || ''

  const removals = []
  for (const path of changedSourceFiles(base, head)) {
    const before = blob(base, path)
    if (before === null) continue // new file; nothing can have been removed from it
    const after = blob(head, path)

    const beforeScan = exportedNames(before)
    for (const line of beforeScan.opaque) {
      console.log(`scope-guard: ${path} has \`${line}\` — its names are not enumerated.`)
    }

    const gone = new Set(beforeScan.names)
    if (after !== null) for (const name of exportedNames(after).names) gone.delete(name)
    for (const name of [...gone].sort()) removals.push({ path, name })
  }

  if (removals.length === 0) {
    console.log('scope-guard: no public export removed from src/.')
    return 0
  }

  const unexplained = removals.filter(({ name }) => !body.includes(name))
  for (const { path, name } of removals) {
    const state = unexplained.some((r) => r.path === path && r.name === name)
      ? 'NOT MENTIONED'
      : 'mentioned'
    console.log(`scope-guard: ${path} removes ${name} -- ${state} in the PR description.`)
  }

  if (unexplained.length === 0) {
    console.log(`scope-guard: all ${removals.length} removal(s) are named in the PR description.`)
    return 0
  }

  console.log()
  console.log('A pull request may remove a public export, but the description has to say so.')
  console.log('Either restore the exports listed as NOT MENTIONED, or name each of them in')
  console.log('the pull request description together with the reason it is going away.')
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
