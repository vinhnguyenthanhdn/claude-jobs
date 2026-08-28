import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// `files` in package.json is a hand-written list that lives next to a README the
// same list decides to ship. Nothing connects the two, so a document added later
// is linked from the packaged README and is not in the package - the reader ends
// up at a path that exists on GitHub and nowhere on their disk. Ask the property
// instead of maintaining a second list: every relative link the shipped README
// makes has to resolve inside the tarball.
function readmeLinkTargets() {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const targets = new Set()
  for (const match of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    targets.add(target.split('#')[0].replace(/^\.\//, ''))
  }
  return [...targets].sort()
}

function packedPaths() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' })
  return JSON.parse(out)[0].files.map((file) => file.path)
}

test('every relative link in the packaged README resolves inside the tarball', () => {
  const targets = readmeLinkTargets()
  assert.ok(targets.length > 0, 'the README should link to something in the repository')

  const packed = packedPaths()
  assert.ok(packed.includes('README.md'), 'the README itself must be packed')

  const missing = targets.filter((target) => {
    const asDirectory = target.endsWith('/') ? target : `${target}/`
    return !packed.includes(target) && !packed.some((path) => path.startsWith(asDirectory))
  })

  assert.deepEqual(
    missing,
    [],
    `the packaged README links to paths the package does not contain: ${missing.join(', ')}`,
  )
})
