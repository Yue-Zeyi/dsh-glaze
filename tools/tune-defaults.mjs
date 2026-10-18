/**
 * Retune the skin defaults for the v0.3 structural-glass model.
 *
 *   opacity 45 -> 35   (less "solid fill" over the wallpaper)
 *   blur    10 -> 22   (the blur now does the hiding work)
 *   scrim   15 -> 10
 *
 * Run:  node tools/tune-defaults.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const here = new URL('../', import.meta.url)
const read = (name) => readFileSync(new URL(name, here), 'utf8')
const write = (name, text) => writeFileSync(new URL(name, here), text)

/** Replace every occurrence of `from` with `to`, asserting at least one hit. */
function swap(text, from, to, label) {
  const before = text
  const after = text.split(from).join(to)
  if (after === before) throw new Error(`no match for ${label}: ${from}`)
  return after
}

// ── host Config schema (real + fallback) ────────────────────────────────────
let host = read('index.js')
host = swap(host, ".default(45).volatile()", ".default(35).volatile()", 'host opacity')
host = swap(host, ".default(10).volatile()", ".default(22).volatile()", 'host blur')
host = swap(host, ".default(15).volatile()", ".default(10).volatile()", 'host scrim')
host = swap(host, "default: 45, volatile: true", "default: 35, volatile: true", 'fallback opacity')
host = swap(host, "default: 10, volatile: true", "default: 22, volatile: true", 'fallback blur')
host = swap(host, "default: 15, volatile: true", "default: 10, volatile: true", 'fallback scrim')
write('index.js', host)

// ── client DEFAULTS ─────────────────────────────────────────────────────────
let client = read('client.js')
client = swap(client, '      opacity: 45,\n      blur: 10,\n      scrim: 15,', '      opacity: 35,\n      blur: 22,\n      scrim: 10,', 'client defaults')
write('client.js', client)

// ── bundle patch defaults ───────────────────────────────────────────────────
let patch = read('cordis.patch.yml')
patch = swap(patch, '        opacity: 45\n', '        opacity: 35\n', 'patch opacity')
patch = swap(patch, '        blur: 10\n', '        blur: 22\n', 'patch blur')
patch = swap(patch, '        scrim: 15\n', '        scrim: 10\n', 'patch scrim')
write('cordis.patch.yml', patch)

console.log('defaults retuned: opacity 35, blur 22, scrim 10')
