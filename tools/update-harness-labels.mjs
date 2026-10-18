/**
 * Point the harness at the renamed Settings entry.
 *
 * The skin section used to be labelled 皮肤; it is now 外观 (the plugin is called
 * Glaze). The driver scripts locate it by its visible label, so they silently
 * clicked nothing and then timed out waiting for controls that were never shown.
 *
 * Matching is made resilient: the selectors accept the new label and fall back
 * to the old one, so the harness keeps working on either build.
 *
 * Run:  node tools/update-harness-labels.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  new URL('../harness/audit-settings.cjs', import.meta.url),
  new URL('../harness/lib/capture-driver.cjs', import.meta.url),
]

for (const file of files) {
  let s
  try {
    s = readFileSync(file, 'utf8')
  } catch {
    console.log('skip (missing):', file.pathname)
    continue
  }
  const before = s
  // button:has-text("皮肤")  ->  matches 外观 or 皮肤
  s = s.split('button:has-text("皮肤")').join('button:has-text("外观"), [role=dialog] button:has-text("皮肤")')
  // aria-label="启用皮肤" -> accept the renamed master switch too
  s = s.split('aria-label="启用皮肤"').join('aria-label="启用外观"], .dsh-glaze-switch[aria-label="启用皮肤"')
  if (s !== before) {
    writeFileSync(file, s, 'utf8')
    console.log('updated', file.pathname.split('/').slice(-2).join('/'))
  } else {
    console.log('no change', file.pathname.split('/').slice(-2).join('/'))
  }
}
