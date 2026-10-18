/**
 * Remove the now-deleted opaque-container scanning calls from client.js.
 *
 * The clearing is done in pure CSS now (see the stylesheet), so the JS passes
 * must go — leaving a call to a removed function would throw at paint time and
 * take the whole skin down.
 *
 * Run:  node tools/drop-scan-calls.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../plugin/client.js', import.meta.url)
let s = readFileSync(file, 'utf8')

const banned = [
  '        clearOpaqueContainers()\n',
  '        queueMicrotask(clearOpaqueContainers)\n',
  '        window.setTimeout(clearOpaqueContainers, 120)\n',
  '        unwatchLayout()\n        restoreOpaqueContainers()\n',
  '      unwatchLayout()\n      restoreOpaqueContainers()\n',
  '          clearOpaqueContainers()\n',
  '    const CLEARED_CLASS = \x27dsh-glaze-cleared\x27\n',
  '    /** Class marking a layout container whose opaque fill was cleared. */\n',
]

for (const piece of banned) {
  if (!s.includes(piece)) continue
  s = s.split(piece).join('')
}

// The disable branches only need to stop watching layout now.
s = s.replace('      } else {\n      }', '      } else {\n        unwatchLayout()\n      }')
s = s.replace('      document.documentElement.classList.remove(ROOT_CLASS)\n      unwatchLayout()\n', '      document.documentElement.classList.remove(ROOT_CLASS)\n      unwatchLayout()\n')

writeFileSync(file, s)

// Report anything still referencing the removed helpers.
const leftovers = s.split('\n').filter((line) => /clearOpaqueContainers|restoreOpaqueContainers|CLEARED_CLASS/.test(line))
if (leftovers.length > 0) {
  console.log('LEFTOVERS:')
  for (const line of leftovers) console.log('  ' + line.trim())
} else {
  console.log('scan calls removed cleanly')
}
