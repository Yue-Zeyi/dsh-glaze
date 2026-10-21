/**
 * Repair backticks that earlier bulk replacements ate from the docs.
 *
 * A previous automated rewrite ran replacement strings through a JS template
 * literal, so a backtick followed by t/a/b became an escape sequence:
 *
 *   `tools/...     ->  \t + "ools/..."      (TAB)
 *   `adoptFromForm ->  \a + "doptFromForm"  (0x07)
 *   `backdrop-...  ->  \b + "ackdrop-..."   (0x08)
 *
 * That silently corrupted inline code spans. This restores the intended text and
 * then re-scans every tracked text file so nothing of the sort is left behind.
 *
 * Run:  node tools/repair-doc-escapes.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url)
const SKIP = new Set(['.git', 'node_modules', 'shots', 'raw', 'profile'])

const FIXES = [
  // [file, from (exact), to]
  ['docs/TECHNICAL.md', '\tools/reset-live-settings.mjs', '`tools/reset-live-settings.mjs`'],
  ['docs/TECHNICAL.md', '\u0007doptFromForm()', '`adoptFromForm()`'],
  ['docs/TECHNICAL.md', '| 胶囊上的 \backdrop-filter |', '| 胶囊上的 `backdrop-filter` |'],
  ['docs/TECHNICAL.md', '| 胶囊上的 \border / \box-shadow |', '| 胶囊上的 `border` / `box-shadow` |'],
]

for (const [file, from, to] of FIXES) {
  const path = new URL(file, ROOT)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) {
    console.log(`skip (no match): ${file} -> ${JSON.stringify(from.slice(0, 30))}`)
    continue
  }
  writeFileSync(path, text.split(from).join(to), 'utf8')
  console.log(`fixed ${file}: ${JSON.stringify(from.slice(0, 30))} -> ${JSON.stringify(to.slice(0, 30))}`)
}

// verify nothing is left
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(md|js|mjs|cjs|json|yml|ps1|py|html)$/.test(e.name)) out.push(p)
  }
  return out
}

let bad = 0
for (const file of walk(ROOT.pathname.replace(/^\//, ''))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/[\u0000-\u0008]/.test(line)) {
      console.log(`STILL BAD ${file}:${i + 1}: ${JSON.stringify(line.slice(0, 80))}`)
      bad += 1
    }
  })
}
console.log(bad === 0 ? 'no control characters left' : `${bad} lines still damaged`)
