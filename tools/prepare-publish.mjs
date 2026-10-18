/**
 * Add the metadata npm needs before a package can be published.
 *
 * Written as a script so the exact diff is reviewable and repeatable, and so
 * the JSON stays pretty-printed with a trailing newline (npm normalises the
 * formatting anyway, but keeping it stable makes diffs readable).
 *
 * Run:  node tools/prepare-publish.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(file, 'utf8'))

// Identity — matches the GitHub account that owns the other dsh-* package.
pkg.author = 'YueZeyi'
pkg.repository = { type: 'git', url: 'git+https://github.com/Yue-Zeyi/dsh-glaze.git' }
pkg.homepage = 'https://github.com/Yue-Zeyi/dsh-glaze#readme'
pkg.bugs = { url: 'https://github.com/Yue-Zeyi/dsh-glaze/issues' }

// Unscoped publish: `dsh-*` is the convention in this ecosystem, and the name is
// still free on the registry (checked with `npm view dsh-glaze`).
pkg.publishConfig = { access: 'public' }

// A publish must never ship a bundle that cannot even be imported. The smoke
// test lives outside `files`, but prepublishOnly runs in the source tree.
pkg.scripts = {
  ...pkg.scripts,
  prepublishOnly: 'node test-host.mjs && node --check index.js && node --check client.js && node ../tools/smoke-client.mjs',
}

// The licence text has to travel with the package.
const files = new Set(pkg.files ?? [])
files.add('LICENSE')
files.add('README.md')
pkg.files = [...files]

writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

console.log('package.json prepared for publishing:')
for (const key of ['name', 'version', 'license', 'author', 'homepage', 'publishConfig']) {
  console.log(`  ${key.padEnd(14)} ${JSON.stringify(pkg[key])}`)
}
console.log(`  files          ${pkg.files.join(', ')}`)
console.log(`  prepublishOnly ${pkg.scripts.prepublishOnly}`)
