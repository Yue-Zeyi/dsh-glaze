/**
 * Move the plugin package from plugin/ to the repository root.
 *
 * WHY
 * ---
 * DSH's installer resolves an install spec to one of four kinds — registry,
 * path, git, tarball — and the `git` kind is handed to the package manager,
 * which clones the repo and expects a package.json AT THE REPO ROOT. With the
 * manifest in plugin/, "install from GitHub repo URL" cannot work, which is the
 * distribution route the user needs (they cannot publish to npm).
 *
 * WHAT MOVES
 * ----------
 *   plugin/{index,client}.js, cordis.patch.yml, package.json, icon.svg,
 *   test-host.mjs, preview.png  -> repository root
 *
 *   plugin/README.md  -> root README.md   (npm and GitHub both render the root
 *                                          one, so it must be the user-facing
 *                                          document)
 *   root README.md    -> docs/TECHNICAL.md (the long implementation write-up)
 *
 *   plugin/LICENSE is dropped: the root LICENSE already has identical content.
 *   plugin/client.js.v1-bak stays on disk and stays gitignored.
 *
 * Then every reference to the old path is rewritten.
 *
 * Run:  node tools/restructure-to-root.mjs
 */
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-glaze'
const PLUGIN = join(ROOT, 'plugin')

const note = (line) => console.log(line)

if (!existsSync(PLUGIN)) {
  note('plugin/ is already gone — nothing to restructure')
  process.exit(0)
}

// ── 1. keep the technical README before root README.md is replaced ──────────
const docsDir = join(ROOT, 'docs')
if (existsSync(join(ROOT, 'README.md')) && !existsSync(join(docsDir, 'TECHNICAL.md'))) {
  renameSync(join(ROOT, 'README.md'), join(docsDir, 'TECHNICAL.md'))
  note('root README.md -> docs/TECHNICAL.md')
}

// ── 2. move package files up ───────────────────────────────────────────────
const MOVES = ['index.js', 'client.js', 'cordis.patch.yml', 'package.json', 'icon.svg', 'test-host.mjs', 'preview.png']
for (const name of MOVES) {
  const from = join(PLUGIN, name)
  const to = join(ROOT, name)
  if (!existsSync(from)) {
    note(`skip (missing): ${name}`)
    continue
  }
  if (existsSync(to)) throw new Error(`refusing to overwrite ${to}`)
  renameSync(from, to)
  note(`moved ${name}`)
}

// the user-facing readme becomes the repository readme
if (existsSync(join(PLUGIN, 'README.md'))) {
  renameSync(join(PLUGIN, 'README.md'), join(ROOT, 'README.md'))
  note('plugin/README.md -> README.md')
}

// identical licence text is already at the root
if (existsSync(join(PLUGIN, 'LICENSE'))) {
  unlinkSync(join(PLUGIN, 'LICENSE'))
  note('dropped duplicate plugin/LICENSE')
}

// ── 3. remove the now-empty directory (keep the ignored backup on disk) ────
const leftover = readdirSync(PLUGIN)
const keep = leftover.filter((name) => name === 'client.js.v1-bak')
const strays = leftover.filter((name) => !keep.includes(name))
if (strays.length > 0) throw new Error(`plugin/ still has unexpected files: ${strays.join(', ')}`)
if (keep.length === 0) {
  rmdirSync(PLUGIN)
  note('removed empty plugin/')
} else {
  // Move the ignored backup next to its new home so nothing is silently lost.
  renameSync(join(PLUGIN, 'client.js.v1-bak'), join(ROOT, 'client.js.v1-bak'))
  rmdirSync(PLUGIN)
  note('moved client.js.v1-bak to root (gitignored) and removed plugin/')
}

// ── 4. rewrite path references ─────────────────────────────────────────────
const TEXT = new Set(['.js', '.mjs', '.cjs', '.json', '.yml', '.md', '.ps1'])
const SKIP = new Set(['.git', 'node_modules', 'shots', 'state', 'logs'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (TEXT.has(full.slice(full.lastIndexOf('.')))) out.push(full)
  }
  return out
}

const REPLACEMENTS = [
  // tools/ scripts: ../x.js -> ../x.js
  ['../', '../'],
  // package.json prepublishOnly now reaches tools/ from the repo root
  ['node tools/', 'node tools/'],
  // windows-style references in docs / scripts
  ['\\\', '\\'],
  ['dsh-glaze\\plugin', 'dsh-glaze'],
  ['dsh-glaze', 'dsh-glaze'],
]

let touched = 0
for (const file of walk(ROOT)) {
  const before = readFileSync(file, 'utf8')
  let after = before
  for (const [from, to] of REPLACEMENTS) {
    if (!after.includes(from)) continue
    after = after.split(from).join(to)
  }
  if (after !== before) {
    writeFileSync(file, after, 'utf8')
    touched += 1
  }
}
note(`rewrote ${touched} files`)
