/**
 * Small, reviewable edits to plugin/client.js for the v0.4 wallpaper move
 * (wallpaper is now the body background, not a z-index:-1 element).
 *
 * Run:  node tools/fix-paint.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

function swap(from, to, label) {
  if (!s.includes(from)) throw new Error(`no match: ${label}`)
  s = s.split(from).join(to)
}

// ensureLayers now returns { scrim, dim } (no wallpaper element any more).
swap('const { backdrop, dim } = ensureLayers()', 'const { scrim, dim } = ensureLayers()', 'destructure')

// The scrim element is now provided by ensureLayers, so drop the second lookup.
swap(
  '      const scrim = document.getElementById(SCRIM_ID)\n      if (scrim !== null) {',
  '      if (scrim !== null) {',
  'scrim lookup',
)

// The wallpaper element no longer exists; remove its cleanup call.
s = s.replace("      document.getElementById(BACKDROP_ID)?.remove()\n", '')

writeFileSync(file, s)
console.log('client.js paint updated for body-background wallpaper')
