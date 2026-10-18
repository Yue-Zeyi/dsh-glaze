/**
 * Re-point the live profile at the restructured package location.
 *
 * The package used to live in <repo>/plugin, so the profile's link dependency
 * and the node_modules junction both contained ".../dsh-glaze/plugin". After the
 * move to the repository root those paths are wrong, and the app would fail to
 * resolve the bundle on its next start.
 *
 * Run:  node tools/relink-profile.mjs
 */
import { readFileSync, writeFileSync, existsSync, lstatSync, unlinkSync, symlinkSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DESKTOP = join(homedir(), '.dsh', 'profiles', 'desktop')
const TARGET = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-glaze'
const NEW_LINK = join(DESKTOP, 'node_modules', 'dsh-glaze')

const note = (line) => console.log(line)

// ── link dependency ────────────────────────────────────────────────────────
const pkgPath = join(DESKTOP, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const wanted = `link:${TARGET}`
const current = pkg.dependencies?.['dsh-glaze']

if (current === wanted) {
  note('package.json: link already correct')
} else {
  copyFileSync(pkgPath, `${pkgPath}.pre-root`)
  pkg.dependencies['dsh-glaze'] = wanted
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  note(`package.json: ${current} -> ${wanted}`)
}

// ── junction ───────────────────────────────────────────────────────────────
// The old junction points at ".../dsh-glaze/plugin", which no longer exists.
// A broken junction is invisible to existsSync, so detect it with lstat and
// remove it with unlink (which deletes the link, never the target).
let existing = null
try {
  existing = lstatSync(NEW_LINK)
} catch {
  existing = null
}
if (existing !== null) {
  unlinkSync(NEW_LINK)
  note('removed the old junction')
}
symlinkSync(TARGET.replaceAll('/', '\\'), NEW_LINK, 'junction')
note(`junction -> ${TARGET}`)

// ── verify ─────────────────────────────────────────────────────────────────
const manifest = join(NEW_LINK, 'package.json')
if (!existsSync(manifest)) throw new Error('junction does not resolve to a package.json')
const resolved = JSON.parse(readFileSync(manifest, 'utf8'))
note('')
note('verify:')
note(`  resolves to   ${resolved.name}@${resolved.version}`)
note(`  bundle patch  ${existsSync(join(NEW_LINK, 'cordis.patch.yml')) ? 'ok' : 'MISSING'}`)
note(`  index.js      ${existsSync(join(NEW_LINK, 'index.js')) ? 'ok' : 'MISSING'}`)
note(`  client.js     ${existsSync(join(NEW_LINK, 'client.js')) ? 'ok' : 'MISSING'}`)
