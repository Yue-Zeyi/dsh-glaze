/**
 * Migrate the live desktop profile from dsh-skin to dsh-glaze.
 *
 * Four places carry the old name and all four have to move together, or the
 * app boots with a broken bundle (the link points at a directory that no
 * longer exists) and the user's settings + wallpaper are orphaned:
 *
 *   1. profiles/desktop/package.json   bundle entry + "link:" dependency
 *   2. profiles/desktop/node_modules/  the junction on disk
 *   3. profiles/desktop/cordis.patch.yml  the config row (id AND name)
 *   4. $DSH_HOME/dsh-skin/             the wallpaper store directory
 *
 * Every file is backed up first, and the script reports exactly what it did.
 * It is idempotent: re-running it is a no-op once everything already says glaze.
 *
 * Run:  node tools/migrate-profile.mjs
 */
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, symlinkSync, rmSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const DESKTOP = join(homedir(), '.dsh', 'profiles', 'desktop')
const HOME = join(homedir(), '.dsh')
const WORKSPACE = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace'
const NEW_PLUGIN = join(WORKSPACE, 'dsh-glaze', 'plugin').replaceAll('\\', '/')

const require = createRequire(join(DESKTOP, 'package.json'))
const YAML = require('yaml')

const report = []
const note = (line) => {
  report.push(line)
  console.log(line)
}

/** Back a file up next to itself once, so a re-run does not overwrite the backup. */
function backup(path) {
  const target = `${path}.pre-glaze`
  if (!existsSync(target) && existsSync(path)) copyFileSync(path, target)
  return target
}

// ── 1. package.json ─────────────────────────────────────────────────────────
const pkgPath = join(DESKTOP, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const bundles = pkg.dsh?.profile?.bundles ?? []
let pkgChanged = false

const bundleIndex = bundles.indexOf('dsh-skin')
if (bundleIndex !== -1) {
  bundles[bundleIndex] = 'dsh-glaze'
  pkgChanged = true
}
if (pkg.dependencies?.['dsh-skin'] !== undefined) {
  delete pkg.dependencies['dsh-skin']
  pkg.dependencies['dsh-glaze'] = `link:${NEW_PLUGIN}`
  pkgChanged = true
}
if (pkgChanged) {
  backup(pkgPath)
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  note('package.json: bundle entry + link dependency renamed')
} else {
  note('package.json: already migrated')
}

// ── 2. the junction in node_modules ─────────────────────────────────────────
const nm = join(DESKTOP, 'node_modules')
const oldLink = join(nm, 'dsh-skin')
const newLink = join(nm, 'dsh-glaze')

if (existsSync(newLink)) {
  note('node_modules: dsh-glaze link already present')
} else {
  if (existsSync(oldLink)) {
    try {
      // rmSync on a junction removes the link, not the target.
      rmSync(oldLink, { recursive: false, force: true })
    } catch {
      rmSync(oldLink, { force: true })
    }
  }
  symlinkSync(NEW_PLUGIN.replaceAll('/', '\\'), newLink, 'junction')
  note(`node_modules: junction -> ${NEW_PLUGIN}`)
}

// ── 3. the config row ───────────────────────────────────────────────────────
const patchPath = join(DESKTOP, 'cordis.patch.yml')
const doc = YAML.parse(readFileSync(patchPath, 'utf8'))
if (!Array.isArray(doc)) throw new Error('profile patch is not a YAML array')

const row = doc.find((entry) => entry !== null && entry.id === 'dsh-skin')
if (row === undefined) {
  note('cordis.patch.yml: no dsh-skin row (already migrated)')
} else {
  const savedConfig = row.config ?? {}
  backup(patchPath)
  row.id = 'dsh-glaze'
  if (row.name === 'dsh-skin') row.name = 'dsh-glaze'
  row.config = savedConfig
  writeFileSync(patchPath, YAML.stringify(doc), 'utf8')
  note(`cordis.patch.yml: row renamed, settings kept -> ${JSON.stringify(savedConfig)}`)
}

// ── 4. the wallpaper store ─────────────────────────────────────────────────
const oldStore = join(HOME, 'dsh-skin')
const newStore = join(HOME, 'dsh-glaze')
if (!existsSync(oldStore)) {
  note('wallpaper store: nothing to move')
} else if (existsSync(newStore)) {
  note('wallpaper store: dsh-glaze already exists, leaving both alone')
} else {
  renameSync(oldStore, newStore)
  note('wallpaper store: ~/.dsh/dsh-skin -> ~/.dsh/dsh-glaze')
}

// ── verify ──────────────────────────────────────────────────────────────────
const checkLink = lstatSync(newLink)
note('')
note('verify:')
note(`  junction      ${checkLink.isSymbolicLink() ? 'ok' : 'MISSING'}`)
note(`  plugin exists ${existsSync(join(newLink, 'package.json')) ? 'ok' : 'MISSING'}`)
note(`  wallpaper     ${existsSync(newStore) ? 'ok' : 'none stored'}`)
