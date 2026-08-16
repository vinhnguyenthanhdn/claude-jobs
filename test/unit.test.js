import assert from 'node:assert/strict'
import test from 'node:test'
import { crontabHas, crontabWithout, parseTime } from '../src/schedulers.js'
import { parseArgs } from '../src/cli.js'
import { render, shellQuote } from '../src/render.js'

test('render fills placeholders', () => {
  assert.equal(render('a {{X}} c', { X: 'b' }), 'a b c')
})

test('render rejects an unknown placeholder instead of emitting it', () => {
  assert.throws(() => render('{{MISSING}}', {}), /MISSING/)
})

test('shellQuote survives embedded single quotes', () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`)
})

test('parseTime accepts 24-hour times and rejects the rest', () => {
  assert.deepEqual(parseTime('09:30'), { hour: 9, minute: 30 })
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 })
  assert.throws(() => parseTime('24:00'), /invalid --at/)
  assert.throws(() => parseTime('9.30'), /invalid --at/)
})

test('crontabWithout removes only the exact marked job and leaves others byte-identical', () => {
  const existing = [
    'MAILTO=""',
    '',
    '# nightly backup',
    '0 1 * * * /usr/local/bin/backup.sh',
    '',
    '',
    '# reports',
    '0 6 * * 1 /usr/local/bin/weekly-report.sh',
    '',
    '0 1 * * * other-thing',
    '30 9 * * * /bin/bash run.sh # claude-jobs:alpha-2',
    '30 9 * * * /bin/bash run.sh # claude-jobs:alpha',
    '0 7 * * * /bin/bash run.sh # claude-jobs:beta',
  ].join('\n')
  const expected = [
    'MAILTO=""',
    '',
    '# nightly backup',
    '0 1 * * * /usr/local/bin/backup.sh',
    '',
    '',
    '# reports',
    '0 6 * * 1 /usr/local/bin/weekly-report.sh',
    '',
    '0 1 * * * other-thing',
    '30 9 * * * /bin/bash run.sh # claude-jobs:alpha-2',
    '0 7 * * * /bin/bash run.sh # claude-jobs:beta',
  ].join('\n')
  assert.equal(crontabWithout(existing, 'alpha'), expected)
})

test('crontabWithout is a byte-identical no-op when marker is absent', () => {
  const foreign = [
    'MAILTO=""',
    '',
    '',
    '# nightly backup',
    '0 1 * * * /usr/local/bin/backup.sh',
    '',
  ].join('\n')
  assert.equal(crontabWithout(foreign, 'alpha'), foreign)
})

test('cron marker matching accepts trailing spaces and tabs without matching sibling names', () => {
  const sibling = '30 9 * * * /bin/bash run.sh # claude-jobs:alpha-2\t'

  for (const trailingWhitespace of ['  ', '\t']) {
    const target = `30 9 * * * /bin/bash run.sh # claude-jobs:alpha${trailingWhitespace}`
    const existing = `${sibling}\n${target}`

    assert.equal(crontabHas(existing, 'alpha'), true)
    assert.equal(crontabHas(sibling, 'alpha'), false)
    assert.equal(crontabWithout(existing, 'alpha'), sibling)
  }
})

test('parseArgs splits positionals, valued flags and boolean flags', () => {
  const { args, flags } = parseArgs(['init', 'daily', '--at', '09:30', '--force'])
  assert.deepEqual(args, ['init', 'daily'])
  assert.equal(flags.at, '09:30')
  assert.equal(flags.force, true)
})
