/**
 * Relabel the Settings entry for the new name.
 *
 * The Chinese copy is stored in the source as \uXXXX escapes inside JS string
 * literals, so a plain text replace has to match those escapes (not the
 * characters they denote).
 *
 *   皮肤 (\u76ae\u80a4)      -> 外观 (\u5916\u89c2)
 *   启用皮肤                  -> 启用外观
 *   "Skin" / "Enable skin"   -> "Glaze" / "Enable glaze"
 *
 * Run:  node tools/relabel-glaze.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

const swaps = [
  [String.raw`nav: '\u76ae\u80a4'`, String.raw`nav: '\u5916\u89c2'`, 'zh nav label'],
  [String.raw`enabled: '\u542f\u7528\u76ae\u80a4'`, String.raw`enabled: '\u542f\u7528\u5916\u89c2'`, 'zh master switch'],
  [`nav: 'Skin'`, `nav: 'Glaze'`, 'en nav label'],
  [`enabled: 'Enable skin'`, `enabled: 'Enable glaze'`, 'en master switch'],
]

for (const [from, to, label] of swaps) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.split(from).join(to)
}

writeFileSync(file, s, 'utf8')

// Report what the strings decode to, so the result is verifiable at a glance.
const nav = s.match(/nav: '([^']*)'/g) ?? []
const enabled = s.match(/enabled: '([^']*)'/g) ?? []
console.log('nav entries    :', nav.join('  '))
console.log('master switches:', enabled.join('  '))
console.log('decoded zh nav :', JSON.parse(String.raw`"\u5916\u89c2"`))
