/**
 * Finish the v0.5 refactor: replace the last references to the removed
 * per-column helpers with the single-pane equivalents.
 *
 * Run:  node tools/finish-v5.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

/** Replace every occurrence, asserting at least one hit. */
function swap(from, to, label) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.split(from).join(to)
}

// paint(): the disabled branch must stop watching layout, not "unmark columns".
swap('      markColumns(false)', '      unwatchLayout()', 'paint disable branch')

// plugin teardown
swap('            stopFramesObserver()', '            unwatchLayout()', 'teardown')

writeFileSync(file, s)
console.log('v0.5 refactor finished')
