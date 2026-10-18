/**
 * Remove the "Applies to" (surfaces) option entirely.
 *
 * The user asked for the skin to always cover the whole window, which also
 * removes a whole category of geometry bugs: the frosted pane no longer has to
 * be re-measured and re-positioned against the sidebar / centre column, so it
 * cannot lag behind a layout change or end up misaligned.
 *
 * Run:  node tools/drop-surfaces.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

function swap(from, to, label) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.split(from).join(to)
}

/** Delete a whole block, asserting it was present. */
function cut(from, label) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.replace(from, '')
}

// ── field plumbing ──────────────────────────────────────────────────────────
swap("      surfaces: 'surfaces',\n", '', 'FIELDS entry')
swap("    const SURFACES = Object.freeze(['all', 'main', 'sidebar'])\n", '', 'SURFACES list')
swap('      surfaces: \'all\',\n', '', 'DEFAULTS entry')
swap(
  '        surfaces: SURFACES.includes(raw[FIELDS.surfaces]) ? raw[FIELDS.surfaces] : DEFAULTS.surfaces,\n',
  '',
  'normalizeSettings entry',
)

// ── geometry: the pane is always the whole window ───────────────────────────
// The bare strings below appear at more than one indentation level, so they are
// replaced without leading whitespace and the indentation is preserved.
swap('layoutGlassPane(runtime.settings.surfaces)', 'layoutGlassPane()', 'clear/layout calls')
swap('layoutGlassPane(settings.surfaces)', 'layoutGlassPane()', 'paint call')
swap('watchLayout(settings.surfaces)', 'watchLayout()', 'watch call')

// ── i18n ────────────────────────────────────────────────────────────────────
cut(
  `      surfaces: '\\u4f5c\\u7528\\u8303\\u56f4',
      surfacesAll: '\\u6574\\u4e2a\\u754c\\u9762',
      surfacesMain: '\\u4ec5\\u4e3b\\u9762\\u677f',
      surfacesSidebar: '\\u4ec5\\u4fa7\\u8fb9\\u680f',
      surfacesDesc: '\\u9009\\u62e9\\u964d\\u4f4e\\u900f\\u660e\\u5ea6\\u4f5c\\u7528\\u5728\\u54ea\\u4e9b\\u8868\\u9762\\u3002',
`,
  'zh locale entries',
)
cut(
  `      surfaces: 'Applies to',
      surfacesAll: 'Whole interface',
      surfacesMain: 'Main panel only',
      surfacesSidebar: 'Sidebar only',
      surfacesDesc: 'Which surfaces get the transparency treatment.',
`,
  'en locale entries',
)

writeFileSync(file, s)

const leftovers = s.split('\n').filter((line) => /surfaces/.test(line) && !/glass surfaces|translucent surfaces|surfaces went|surfaces go/.test(line))
console.log(leftovers.length === 0 ? 'surfaces removed cleanly' : 'LEFTOVERS:\n  ' + leftovers.map((l) => l.trim()).join('\n  '))
