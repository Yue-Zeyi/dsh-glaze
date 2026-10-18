/**
 * Finish the v0.7 switch from element classes to a generated structural sheet.
 *
 * Elements are no longer marked: the clear rules are written into their own
 * <style> element keyed on positional selectors. These edits remove the last
 * references to the old class-based machinery and to the time-boxed
 * convergence loop, then add the sheet id constant.
 *
 * Run:  node tools/finish-v7.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

function drop(piece, label) {
  if (!s.includes(piece)) throw new Error(`no match for ${label}`)
  s = s.split(piece).join('')
}

function swap(from, to, label) {
  if (!s.includes(from)) throw new Error(`no match for ${label}`)
  s = s.split(from).join(to)
}

// 1. the class-based CSS rules are replaced by the generated sheet
drop(
  `html.\${ROOT_CLASS} .\${CLEARED_CLASS} {
  background-color: transparent !important;
}

/* Scroll-fade veils fade to an OPAQUE palette colour (the shell's own base).
   Once the container behind them is transparent, that opaque endpoint turns the
   veil into a hard-edged coloured strip — the stray band at the bottom of the
   sidebar. Fading to transparent instead keeps the softening effect without the
   colour step. */
html.\${ROOT_CLASS} .\${CLEARED_CLASS} > *[class*='fade'],
html.\${ROOT_CLASS} .\${CLEARED_CLASS} *[class*='fade'] {
  background-image: none !important;
}

`,
  'class-based clear rules',
)

// 2. the class constant is gone
drop(
  `    /** Class marking a structural container whose opaque fill was cleared. */
    const CLEARED_CLASS = 'dsh-glaze-cleared'
`,
  'CLEARED_CLASS constant',
)

// 3. add the sheet id constant next to the pane id
swap(
  `    /** The single full-window frosted pane (see the CSS block). */
    const GLASS_ID = 'dsh-glaze-pane'`,
  `    /** The single full-window frosted pane (see the CSS block). */
    const GLASS_ID = 'dsh-glaze-pane'
    /** The <style> element holding the generated structural clear rules. */
    const CLEAR_STYLE_ID = 'dsh-glaze-clear-rules'`,
  'CLEAR_STYLE_ID constant',
)

// 4. stale doc comment references the removed loop
swap(
  ' * the first paint cannot stay opaque — see startClearConvergence().',
  ' * the first paint cannot stay opaque — see scheduleClearSync().',
  'doc comment',
)

// 5. layout-observer branch: just re-sync the sheet
swap(
  `          startClearConvergence(20)`,
  `          scheduleClearSync()`,
  'layout observer call',
)

// 6. paint(): start the watcher instead of the convergence loop
swap(
  `        startClearConvergence(45)`,
  `        watchClear()
        syncClearSheet()`,
  'paint enable branch',
)

// 7. paint() disable branch + unpaint()
swap(
  `      } else {
        unwatchLayout()
        stopClearConvergence()
        restoreStructuralContainers()
      }`,
  `      } else {
        unwatchLayout()
        clearStructuralContainers()
      }`,
  'paint disable branch',
)

swap(
  `      stopClearConvergence()
      restoreStructuralContainers()`,
  `      clearStructuralContainers()`,
  'unpaint',
)

writeFileSync(file, s)

const leftovers = s.split('\n').filter((line) => /CLEARED_CLASS|startClearConvergence|stopClearConvergence|restoreStructuralContainers/.test(line))
console.log(leftovers.length === 0 ? 'v0.7 refactor clean' : 'LEFTOVERS:\n  ' + leftovers.map((l) => l.trim()).join('\n  '))
