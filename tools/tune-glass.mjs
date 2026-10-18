/**
 * Final tuning for the v0.4 structural-glass model.
 *
 * After the frame-background fix the wallpaper finally renders, and the
 * remaining question was how much fill the structural columns need. Measured
 * A/B (38% reads best: wallpaper clearly visible, all text legible).
 *
 * Run:  node tools/tune-glass.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

// Structural columns: 12%..70% -> 8%..52% so the wallpaper reads as a real
// picture at default opacity instead of a hint.
s = s.replace(
  "body.style.setProperty('--dsh-glaze-pane-opacity', `${Math.round(12 + d * 58)}%`)",
  "body.style.setProperty('--dsh-glaze-pane-opacity', `${Math.round(8 + d * 44)}%`)",
)

// The transcript keeps a bit more fill for long conversations.
s = s.replace(
  "body.style.setProperty('--dsh-glaze-scroll-opacity', `${Math.round(26 + d * 52)}%`)",
  "body.style.setProperty('--dsh-glaze-scroll-opacity', `${Math.round(22 + d * 46)}%`)",
)

writeFileSync(file, s)
console.log('glass opacity retuned (columns 8..52%, transcript 22..68%)')
