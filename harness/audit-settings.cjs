/**
 * End-to-end audit of every skin setting.
 *
 * For each control it drives the REAL Settings UI (switch / slider / select),
 * waits for the paint to settle, then reads back what the browser actually
 * computed. That covers the whole chain:
 *
 *   Settings widget -> update() -> runtime.settings -> paint() -> CSS variables
 *   -> computed style on the glass pane / body
 *
 * A control passes only when its effect is measurable AND the value it reports
 * matches what was asked for. This is what catches "the switch flips but
 * nothing happens" bugs.
 *
 * Run:  node harness/audit-settings.cjs
 */
const { chromium } = require('C:/Users/Administrator/.dsh/profiles/desktop/node_modules/playwright-core')
const fs = require('node:fs')

const ROOT = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-glaze'
const state = JSON.parse(fs.readFileSync(`${ROOT}/harness/state/state.json`, 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Read the state the audit asserts against. */
function probe(page) {
  return page.evaluate(() => {
    const pane = document.getElementById('dsh-glaze-pane')
    const scrim = document.getElementById('dsh-glaze-scrim')
    const dim = document.getElementById('dsh-glaze-dim')
    const paneStyle = pane ? getComputedStyle(pane) : null
    const bodyStyle = getComputedStyle(document.body)
    return {
      htmlClass: document.documentElement.className,
      panePresent: pane !== null,
      paneBg: paneStyle?.backgroundColor ?? null,
      paneFilter: paneStyle?.backdropFilter ?? null,
      paneFilterVar: document.body.style.getPropertyValue('--dsh-glaze-pane-filter'),
      glassOpacityVar: document.body.style.getPropertyValue('--dsh-glaze-pane-opacity'),
      glassBlurVar: document.body.style.getPropertyValue('--dsh-glaze-pane-blur'),
      scrimAlpha: scrim ? getComputedStyle(scrim).opacity : null,
      dimAlpha: dim ? getComputedStyle(dim).opacity : null,
      bodyBgSize: bodyStyle.backgroundSize,
      bodyBgPos: bodyStyle.backgroundPosition,
      bodyBgImage: bodyStyle.backgroundImage.slice(0, 40),
      clearRules: (document.getElementById('dsh-glaze-clear-rules')?.textContent ?? '').split('\n').filter(Boolean).length,
      // The shell's own surfaces: they must be opaque again once the skin is off.
      sidebarBg: (() => {
        const el = document.querySelector('[class*="_root"]')
        return el ? getComputedStyle(el).backgroundColor : 'missing'
      })(),
      frameBg: (() => {
        const frame = document.querySelector('#root > div > div')
        return frame ? getComputedStyle(frame).backgroundColor : 'missing'
      })(),
    }
  })
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(7500)
  for (let i = 0; i < 5; i += 1) {
    const b = page.locator('button:has-text("继续"), [role=dialog] button[aria-label*="关闭"]')
    if ((await b.count()) > 0) {
      await b.first().click().catch(() => {})
      await sleep(400)
    } else break
  }

  // a wallpaper must exist for the body-background checks to mean anything
  const fixture = fs.readFileSync(`${ROOT}/harness/shots/fixtures/test-wallpaper.png`).toString('base64')
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    await fetch('dsh-glaze/upload', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'image/png' }, body: bytes })
  }, fixture)
  await sleep(4500)

  const baseline = await probe(page)
  check('skin active', baseline.htmlClass.includes('dsh-glaze-active'), baseline.htmlClass)
  check('glass pane mounted', baseline.panePresent)
  check('wallpaper on body', baseline.bodyBgImage.startsWith('url('), baseline.bodyBgImage)
  check('structural clear rules generated', baseline.clearRules > 0, `${baseline.clearRules} rules`)

  // open Settings -> skin
  await page.keyboard.press('Control+Alt+,')
  await sleep(2200)
  await page.locator('[role=dialog] button:has-text("外观"), [role=dialog] button:has-text("外观"), [role=dialog] button:has-text("皮肤")').first().click().catch(() => {})
  await sleep(1500)

  const slot = (kind, label) => page.locator(`.dsh-glaze-${kind}[aria-label="${label}"]`)

  // ── switches ─────────────────────────────────────────────────────────────
  const frost = slot('switch', '毛玻璃效果')
  check('frost toggle present', (await frost.count()) === 1)

  // Normalise the starting state first. The profile is whatever the previous
  // run (or the user) left behind, so asserting "the next click turns it off"
  // without this made the checks fail purely because frost started off.
  const frostOn = () => page.evaluate(() => {
    const pane = document.getElementById('dsh-glaze-pane')
    return pane !== null && getComputedStyle(pane).backdropFilter !== 'none'
  })
  if (!(await frostOn())) {
    await frost.click()
    await sleep(800)
  }
  check('frost starts enabled for the audit', await frostOn())

  await frost.click()
  await sleep(700)
  let s = await probe(page)
  check(
    'frost OFF removes the blur pass',
    s.paneFilter === 'none' && s.paneFilterVar === 'none',
    `filter=${s.paneFilter} var=${s.paneFilterVar}`,
  )
  await frost.click()
  await sleep(700)
  s = await probe(page)
  check('frost ON restores the blur pass', /blur\(/.test(s.paneFilter ?? ''), `filter=${s.paneFilter}`)

  // ── sliders ──────────────────────────────────────────────────────────────
  const opacity = slot('slider', '界面不透明度')
  check('opacity slider present', (await opacity.count()) === 1)
  await opacity.fill('0')
  await opacity.dispatchEvent('input')
  await sleep(500)
  const low = await probe(page)
  await opacity.fill('100')
  await opacity.dispatchEvent('input')
  await sleep(500)
  const high = await probe(page)
  // Computed values come back normalised ("60px", "50% 0%"), so compare numbers.
  const parse = (v) => Number(String(v).replace(/[^0-9.-]/g, '')) || 0
  check(
    'opacity slider moves the pane fill',
    parse(high.glassOpacityVar) - parse(low.glassOpacityVar) > 40,
    `${low.glassOpacityVar} -> ${high.glassOpacityVar}`,
  )

  const blur = slot('slider', '背景模糊')
  check('blur slider present', (await blur.count()) === 1)
  await blur.fill('0')
  await blur.dispatchEvent('input')
  await sleep(500)
  const blurLow = await probe(page)
  await blur.fill('60')
  await blur.dispatchEvent('input')
  await sleep(500)
  const blurHigh = await probe(page)
  check(
    'blur slider moves the blur radius',
    parse(blurLow.glassBlurVar) < parse(blurHigh.glassBlurVar),
    `${blurLow.glassBlurVar} -> ${blurHigh.glassBlurVar}`,
  )
  check(
    'blur is visible when the pane is translucent',
    /blur\(2[0-9]px\)|blur\(3[0-9]px\)|blur\(4[0-9]px\)|blur\(5[0-9]px\)|blur\(60px\)/.test(blurHigh.paneFilter ?? ''),
    blurHigh.paneFilter,
  )

  const scrim = slot('slider', '背景明暗遮罩')
  check('scrim slider present', (await scrim.count()) === 1)
  await scrim.fill('0')
  await scrim.dispatchEvent('input')
  await sleep(500)
  const scrimLow = await probe(page)
  await scrim.fill('80')
  await scrim.dispatchEvent('input')
  await sleep(500)
  const scrimHigh = await probe(page)
  check(
    'scrim slider moves the veil',
    Number(scrimHigh.scrimAlpha) - Number(scrimLow.scrimAlpha) > 0.4,
    `${scrimLow.scrimAlpha} -> ${scrimHigh.scrimAlpha}`,
  )

  const dim = slot('slider', '整体压暗')
  check('dim slider present', (await dim.count()) === 1)
  await dim.fill('0')
  await dim.dispatchEvent('input')
  await sleep(400)
  const dimLow = await probe(page)
  await dim.fill('60')
  await dim.dispatchEvent('input')
  await sleep(500)
  const dimHigh = await probe(page)
  check(
    'dim slider moves the dark veil',
    Number(dimHigh.dimAlpha) - Number(dimLow.dimAlpha) > 0.3,
    `${dimLow.dimAlpha} -> ${dimHigh.dimAlpha}`,
  )

  // ── selects ──────────────────────────────────────────────────────────────
  const fit = slot('select', '填充方式')
  check('fit select present', (await fit.count()) === 1)
  await fit.selectOption('contain')
  await sleep(500)
  const fitContain = await probe(page)
  await fit.selectOption('cover')
  await sleep(500)
  const fitCover = await probe(page)
  check(
    'fit select changes background-size',
    fitContain.bodyBgSize === 'contain' && fitCover.bodyBgSize === 'cover',
    `${fitContain.bodyBgSize} / ${fitCover.bodyBgSize}`,
  )

  const pos = slot('select', '对齐位置')
  check('position select present', (await pos.count()) === 1)
  await pos.selectOption('top')
  await sleep(500)
  const posTop = await probe(page)
  await pos.selectOption('center')
  await sleep(500)
  const posCenter = await probe(page)
  // `center top` is normalised by the browser to `50% 0%`, so accept both.
  const verticalTop = posTop.bodyBgPos === '50% 0%' || posTop.bodyBgPos.startsWith('center top')
  const verticalCenter = posCenter.bodyBgPos === '50% 50%' || posCenter.bodyBgPos.startsWith('center center')
  check(
    'position select changes background-position',
    verticalTop && verticalCenter,
    `${posTop.bodyBgPos} / ${posCenter.bodyBgPos}`,
  )

  // ── master switch last (it disables everything else) ─────────────────────
  // The label was 启用皮肤 before the plugin was renamed to Glaze (启用外观).
  // Accept either so the audit works against an older build too.
  const enabled = page.locator(
    '.dsh-glaze-switch[aria-label="启用外观"], .dsh-glaze-switch[aria-label="启用皮肤"], .dsh-skin-switch[aria-label="启用皮肤"]',
  )
  check('enable switch present', (await enabled.count()) === 1)
  await enabled.click()
  await sleep(900)
  const off = await probe(page)
  check(
    'disable removes the skin',
    !off.htmlClass.includes('dsh-glaze-active') && off.clearRules === 0,
    `class="${off.htmlClass}" rules=${off.clearRules}`,
  )

  // "Off" must give the stock look back, not a faded skin. Each of these is a
  // distinct part of the teardown, so a regression points at the broken step.
  check('disable removes the glass pane', !off.panePresent)
  check(
    'disable removes the wallpaper from <body>',
    off.bodyBgImage === 'none' || off.bodyBgImage === '',
    off.bodyBgImage || '(none)',
  )
  const leftovers = await page.evaluate(() => {
    const vars = ['--dsh-glaze-pane-opacity', '--dsh-glaze-pane-blur', '--dsh-glaze-pane-filter', '--dsw-menu-backdrop-filter']
      .filter((name) => document.body.style.getPropertyValue(name) !== '')
    const layers = ['dsh-glaze-pane', 'dsh-glaze-scrim', 'dsh-glaze-dim']
      .filter((id) => document.getElementById(id) !== null)
    return { vars, layers }
  })
  check('disable clears the inline variables', leftovers.vars.length === 0, leftovers.vars.join(', ') || 'none left')
  check('disable removes every helper layer', leftovers.layers.length === 0, leftovers.layers.join(', ') || 'none left')
  check(
    'disable restores the shell surfaces',
    off.sidebarBg !== 'rgba(0, 0, 0, 0)' && off.frameBg !== 'rgba(0, 0, 0, 0)',
    `sidebar=${off.sidebarBg} frame=${off.frameBg}`,
  )
  await page.screenshot({ path: `${ROOT}/harness/shots/AUDIT-disabled.png` })
  await enabled.click()
  await sleep(900)
  const backOn = await probe(page)
  check(
    're-enable restores the skin',
    backOn.htmlClass.includes('dsh-glaze-active') && backOn.clearRules > 0,
    `rules=${backOn.clearRules}`,
  )

  // ── boot adoption (regression guard) ─────────────────────────────────────
  // A persisted preference must survive a client reboot. This is the exact bug
  // that made the frosted switch come back ON after every restart: the boot
  // path read the config form once, found it not-ready, and painted defaults.
  const frostSwitch = slot('switch', '毛玻璃效果')
  const isFrostedNow = () => page.evaluate(() => {
    const pane = document.getElementById('dsh-glaze-pane')
    return pane !== null && getComputedStyle(pane).backdropFilter !== 'none'
  })
  if (await isFrostedNow()) {
    await frostSwitch.click()
    await sleep(1200)
  }
  const beforeReboot = await probe(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(8000)
  const afterReboot = await probe(page)
  check(
    'boot adopts the persisted setting instead of defaults',
    afterReboot.paneFilter === 'none',
    `before=${beforeReboot.paneFilter} after reboot=${afterReboot.paneFilter}`,
  )

  // leave the profile with the frost pass enabled again
  await page.keyboard.press('Control+Alt+,')
  await sleep(2000)
  await page.locator('[role=dialog] button:has-text("外观"), [role=dialog] button:has-text("外观"), [role=dialog] button:has-text("皮肤")').first().click().catch(() => {})
  await sleep(1400)
  if (!(await isFrostedNow())) {
    const again = slot('switch', '毛玻璃效果')
    if ((await again.count()) === 1) {
      await again.click()
      await sleep(900)
    }
  }

  check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none')

  await browser.close()

  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
