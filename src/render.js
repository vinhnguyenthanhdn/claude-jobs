import { UsageError } from './errors.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Replaces every {{TOKEN}} in `template` with `vars[TOKEN]`.
 * Throws on an unknown token so a typo fails at generation time rather than at
 * 3am inside a scheduler that nobody is watching.
 */
export function render(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, token) => {
    if (!(token in vars)) throw new UsageError(`template placeholder {{${token}}} has no value`)
    return String(vars[token])
  })
}

export function readTemplate(name) {
  return readFileSync(fileURLToPath(new URL(`../templates/${name}`, import.meta.url)), 'utf8')
}

export function renderTemplate(name, vars) {
  return render(readTemplate(name), vars)
}

/** Single-quote a value for safe interpolation into a POSIX shell script. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}
