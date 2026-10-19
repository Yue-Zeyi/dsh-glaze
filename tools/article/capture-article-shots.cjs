/**
 * Capture the screenshot set for the WeChat article.
 *
 * Everything here runs against the disposable test instance (never the user's
 * real app), with a generated wallpaper so the published images contain no
 * personal content.
 *
 * Output: tools/article/images/*.png
 *
 * Run:  node tools/article/capture-article-shots.cjs
 */
const { chromium } = require('C:/Users/Administrator/.dsh/profiles/desktop/node_modules/playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-glaze'
const ASSETS = path.join(ROOT, 'tools/article/assets')
const OUT = path.join(ROOT, 'tools/article/raw')
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/state/state.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })

async function dismissWelcome(page) {
  for (let i = 0; i < 6; i += 1) {
    const b = page.locator('button:has-text("继续"), [role=dialog] button[aria-label*="关闭"]')
    if ((await b.count()) > 0) {
      await b.first().click().catch(() => {})
      await sleep(400)
    } else break
  }
}

async function uploadWallpaper(page, file) {
  const b64 = fs.readFileSync(path.join(ASSETS, file)).toString('base64')
  await page.evaluate(async (payload) => {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    await fetch('dsh-glaze/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    })
  }, b64)
  await sleep(4500)
}

/** Open Settings -> 外观. */
async function openSkinSection(page) {
  await page.keyboard.press('Control+Alt+,')
  await sleep(2200)
  await page.locator('[role=dialog] button:has-text("外观")').first().click().catch(() => {})
  await sleep(1500)
}

const slot = (page, kind, label) => page.locator(`.dsh-glaze-${kind}[aria-label="${label}"]`)

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(8000)
  await dismissWelcome(page)

  // ── light theme, mesh wallpaper, frost ON ────────────────────────────────
  await uploadWallpaper(page, 'wallpaper-mesh.png')
  await openSkinSection(page)

  // make sure frost is on and the sliders sit at pleasant values
  const frostOn = () => page.evaluate(() => {
    const pane = document.getElementById('dsh-glaze-pane')
    return pane !== null && getComputedStyle(pane).backdropFilter !== 'none'
  })
  if (!(await frostOn())) {
    await slot(page, 'switch', '毛玻璃效果').click()
    await sleep(900)
  }
  const opacity = slot(page, 'slider', '界面不透明度')
  await opacity.fill('40')
  await opacity.dispatchEvent('input')
  await sleep(600)
  const blur = slot(page, 'slider', '背景模糊')
  await blur.fill('26')
  await blur.dispatchEvent('input')
  await sleep(600)
  const scrim = slot(page, 'slider', '背景明暗遮罩')
  await scrim.fill('6')
  await scrim.dispatchEvent('input')
  await sleep(900)

  await shot(page, '05-settings.png')
  await page.keyboard.press('Escape')
  await sleep(1400)
  await shot(page, '01-hero-light.png')

  // ── same frame, frost OFF: the comparison pair ──────────────────────────
  await openSkinSection(page)
  await slot(page, 'switch', '毛玻璃效果').click()
  await sleep(1200)
  await page.keyboard.press('Escape')
  await sleep(1400)
  await shot(page, '03-frost-off.png')

  // back on
  await openSkinSection(page)
  await slot(page, 'switch', '毛玻璃效果').click()
  await sleep(1200)
  await page.keyboard.press('Escape')
  await sleep(1200)
  await shot(page, '02-frost-on.png')

  // ── dark theme with the dusk wallpaper ──────────────────────────────────
  await uploadWallpaper(page, 'wallpaper-dusk.png')
  await page.keyboard.press('Control+Alt+,')
  await sleep(2200)
  await page.locator('[role=dialog] button:has-text("通用设置")').first().click().catch(() => {})
  await sleep(1200)
  await page.locator('[role=dialog] button:has-text("深色")').first().click().catch(() => {})
  await sleep(1800)
  await page.keyboard.press('Escape')
  await sleep(1600)
  await shot(page, '04-hero-dark.png')

  // ── disabled: back to the stock look ────────────────────────────────────
  await openSkinSection(page)
  await page.locator('.dsh-glaze-switch[aria-label="启用外观"]').first().click().catch(() => {})
  await sleep(1400)
  await page.keyboard.press('Escape')
  await sleep(1400)
  await shot(page, '06-disabled-stock.png')

  // re-enable so the instance is left in a sane state
  await openSkinSection(page)
  await page.locator('.dsh-glaze-switch[aria-label="启用外观"]').first().click().catch(() => {})
  await sleep(1200)
  await page.keyboard.press('Escape')
  await sleep(1200)

  // ── crop pair for the "before / after blur" figure ──────────────────────
  // A tight crop makes the blur difference obvious at article width.
  const crop = { x: 300, y: 250, width: 1140, height: 560 }
  await shot(page, '_tmp-dark-full.png')

  console.log('captured:', fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).join(', '))
  console.log('errors:', errors.slice(0, 4).join(' | ') || '(none)')
  await browser.close()
  void crop
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
