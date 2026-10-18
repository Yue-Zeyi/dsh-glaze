/**
 * Collapse the two layout observers into one.
 *
 * With the pane pinned to the whole window there is nothing left to align, so
 * `watchLayout` no longer does anything that `watchClear` does not already do.
 * Keeping one observer on #root is simpler and halves the work per mutation.
 *
 * The removed range is bounded by exact anchors so it cannot swallow the
 * neighbouring paint() body (which a naive "slice to unpaint" did).
 *
 * Run:  node tools/merge-watchers.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

const ANCHOR_START = '    /** Observer that keeps the glass pane aligned with layout changes. */'
const ANCHOR_END = '    /** Repaint the skin: wallpaper layers + translucent surfaces + blur. */'

const start = s.indexOf(ANCHOR_START)
const end = s.indexOf(ANCHOR_END)
if (start === -1) throw new Error('start anchor missing')
if (end === -1) throw new Error('end anchor missing')
if (end < start) throw new Error('anchors are out of order')

// Keep `layoutGlassPane()` (still used to reset the pane box) but drop the
// observer plumbing that surrounded it. It is re-inserted below.
s = s.slice(0, start) + `    /**
     * The frosted pane always covers the WHOLE window.
     *
     * There used to be an "Applies to" choice that could confine the pane to the
     * main column or the sidebar. It was removed because a whole-window pane is
     * the only shape that looks right — a partial pane leaves a visible edge
     * running through the title bar — and because it deleted a whole class of
     * bugs: the pane no longer has to be re-measured against the layout, so it
     * can never lag behind a resize or end up misaligned.
     *
     * \`inset: 0\` also comes from the stylesheet; this only clears any stale box.
     */
    function layoutGlassPane() {
      const pane = document.getElementById(GLASS_ID)
      if (pane === null) return
      pane.style.inset = '0'
      pane.style.left = ''
      pane.style.top = ''
      pane.style.width = ''
      pane.style.height = ''
    }

` + s.slice(end)

function swap(from, to, label) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.split(from).join(to)
}

// The single observer now also re-syncs the pane box and the clear rules.
swap('        watchLayout()\n', '', 'paint watch call')
swap('        unwatchLayout()\n', '', 'paint disable branch')
swap('      unwatchLayout()\n', '', 'unpaint')
swap(
  '      clearObserver.observe(root, { childList: true, subtree: true })',
  '      clearObserver.observe(root, { childList: true, subtree: true })',
  'observer target',
)

writeFileSync(file, s)

const leftovers = s.split('\n').filter((line) => /unwatchLayout|watchLayout|layoutObserver|void scope/.test(line))
console.log(leftovers.length === 0 ? 'watchers merged' : 'LEFTOVERS:\n  ' + leftovers.map((l) => l.trim()).join('\n  '))
