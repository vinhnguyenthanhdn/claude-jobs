import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { exportedNames } from '../scripts/scope-guard.mjs'

test('exportedNames reads every export form used in src/', () => {
  const source = [
    "export { main, parseArgs } from './cli.js'",
    'export function buildJob() {}',
    'export async function writeRunner() {}',
    'export class Runner {}',
    "export const jobsDir = () => ''",
    'export let counter = 0',
    'export var legacy = 1',
    'export {',
    '  cronLine,',
    '  parseTime,',
    '}',
  ].join('\n')

  const { names } = exportedNames(source)
  assert.deepEqual(
    [...names].sort(),
    [
      'Runner',
      'buildJob',
      'counter',
      'cronLine',
      'jobsDir',
      'legacy',
      'main',
      'parseArgs',
      'parseTime',
      'writeRunner',
    ],
  )
})

test('exportedNames records the exported alias, not the local name', () => {
  const { names } = exportedNames("export { internalName as publicName } from './x.js'")
  assert.deepEqual([...names], ['publicName'])
})

test('exportedNames ignores names that are only imported or only local', () => {
  const source = [
    "import { join } from 'node:path'",
    'function helper() {}',
    'const local = 1',
    'export function visible() {}',
  ].join('\n')

  const { names } = exportedNames(source)
  assert.deepEqual([...names], ['visible'])
})

test('exportedNames reports a star re-export instead of guessing its names', () => {
  const { names, opaque } = exportedNames("export * from './paths.js'")
  assert.equal(names.size, 0)
  assert.deepEqual(opaque, ["export * from './paths.js'"])
})

// The point of the guard is the *set* it produces, so pin it against the real
// entry point. A refactor that drops an export from src/index.js without
// updating this list is the exact event the guard exists to catch.
test('the public surface of src/index.js is the list this repository publishes', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  const { names } = exportedNames(source)
  assert.deepEqual(
    [...names].sort(),
    [
      'buildJob',
      'cronLine',
      'crontabWithout',
      'defaultScheduler',
      'isInstalled',
      'main',
      'parseArgs',
      'parseTime',
      'render',
      'renderTemplate',
      'shellQuote',
      'writeRunner',
      'writeSchedulerFiles',
    ],
  )
})
