/**
 * Inspect — and only on explicit request, repair — the live profile's skin
 * settings.
 *
 * WHY THIS IS READ-ONLY BY DEFAULT
 * --------------------------------
 * This script used to unconditionally rewrite the whole config object with
 * hard-coded defaults. It was run at the end of several work sessions, so any
 * preference the user had changed between those runs (most visibly the frosted
 * glass switch) was silently reverted to the default on the next restart. That
 * looked exactly like "my setting does not survive a restart".
 *
 * Nothing in the plugin writes settings at startup — only the Settings page's
 * own controls persist anything — so a helper script must never do it either.
 * Rewriting now requires an explicit --force, and even then only MISSING or
 * invalid keys are filled in; a value that is already valid is left alone.
 *
 * Usage:
 *   node tools/check-live-settings.mjs            # report only
 *   node tools/check-live-settings.mjs --force    # fill in missing/invalid keys
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const profile = join(homedir(), '.dsh', 'profiles', 'desktop')
const patchPath = join(profile, 'cordis.patch.yml')

// Use the profile's own yaml so a round-trip matches how the Host wrote it.
const require = createRequire(join(profile, 'package.json'))
const YAML = require('yaml')

/** The full set of fields the schema accepts, with their defaults. */
const FIELDS = {
  enabled: { default: true, valid: (v) => typeof v === 'boolean' },
  frosted: { default: true, valid: (v) => typeof v === 'boolean' },
  opacity: { default: 35, valid: (v) => Number.isFinite(v) && v >= 0 && v <= 100 },
  blur: { default: 22, valid: (v) => Number.isFinite(v) && v >= 0 && v <= 60 },
  scrim: { default: 10, valid: (v) => Number.isFinite(v) && v >= 0 && v <= 100 },
  dim: { default: 0, valid: (v) => Number.isFinite(v) && v >= 0 && v <= 100 },
  fit: { default: 'cover', valid: (v) => ['cover', 'contain', 'auto', 'repeat'].includes(v) },
  position: { default: 'center', valid: (v) => ['center', 'top', 'bottom', 'left', 'right'].includes(v) },
}

const force = process.argv.includes('--force')

const doc = YAML.parse(readFileSync(patchPath, 'utf8'))
if (!Array.isArray(doc)) throw new Error('profile patch is not a YAML array')
const row = doc.find((entry) => entry !== null && entry.id === 'dsh-glaze')
if (row === undefined) throw new Error('no dsh-glaze row in the profile patch')

const current = row.config ?? {}
console.log('profile patch:', patchPath)
console.log('current settings:')
for (const [key, value] of Object.entries(current)) console.log(`  ${key.padEnd(9)} ${JSON.stringify(value)}`)

const missing = []
for (const [key, spec] of Object.entries(FIELDS)) {
  if (!(key in current)) missing.push(`${key} (missing, default ${JSON.stringify(spec.default)})`)
  else if (!spec.valid(current[key])) missing.push(`${key} (invalid: ${JSON.stringify(current[key])})`)
}

if (missing.length === 0) {
  console.log('\nall fields present and valid — nothing to do')
  process.exit(0)
}

console.log('\nneeds attention:')
for (const line of missing) console.log(`  ${line}`)

if (!force) {
  console.log('\nread-only: re-run with --force to fill in the fields listed above.')
  console.log('existing valid values are never overwritten.')
  process.exit(0)
}

// Only repair what is missing or invalid; keep every valid user choice.
const repaired = { ...current }
for (const [key, spec] of Object.entries(FIELDS)) {
  if (!(key in repaired) || !spec.valid(repaired[key])) repaired[key] = spec.default
}
row.config = repaired
writeFileSync(patchPath, YAML.stringify(doc), 'utf8')
console.log('\nrepaired:', JSON.stringify(repaired))
