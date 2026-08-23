import assert from 'node:assert/strict'
import test from 'node:test'

import * as entry from '../src/index.js'

// The published entry point (`exports: { ".": "./src/index.js" }`) is a
// re-export list written by hand across four modules. No test imports it, so
// a name dropped from `src/schedulers.js` and a name added to `index.js` both
// sailed through every gate until a consumer hit it. This pins the list in
// both directions: removing one fails, and adding one without deciding to
// fails too (#40).
const EXPECTED_EXPORTS = [
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
]

test('src/index.js re-exports every expected public name (#40)', () => {
  for (const name of EXPECTED_EXPORTS) {
    assert.ok(
      name in entry,
      `index.js should re-export "${name}" (imports of "claude-jobs" depend on it)`,
    )
  }
})

test('src/index.js exports nothing unexpected (#40)', () => {
  const actual = Object.keys(entry).sort()
  const expected = [...EXPECTED_EXPORTS].sort()
  assert.deepEqual(actual, expected)
})

test('every published name resolves to something callable (#42)', () => {
  // `name in entry` and `Object.keys(entry)` both pass on a name bound to
  // undefined -- which is exactly what a re-export of a since-renamed symbol
  // looks like from outside the package. The two tests above therefore cannot
  // tell "re-exported" from "re-exported as nothing"; this one can.
  for (const name of EXPECTED_EXPORTS) {
    assert.equal(
      typeof entry[name],
      'function',
      `index.js re-exports "${name}", but it does not resolve to a function`,
    )
  }
})
