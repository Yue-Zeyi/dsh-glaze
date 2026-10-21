/**
 * Find out how the shell draws its column dividers.
 *
 * The user reports a divider between the main area and the right dock but none
 * between the left sidebar and the main area. Before adding one, this dumps the
 * frame's children with their borders / box-shadows so the new divider can copy
 * whatever the shell already does, instead of inventing a colour.
 *
 * Run:  node tools/article/../inspect-dividers.cjs   (or from the repo root)
 *       node inspect-dividers.cjs
 */
const { chromium } = require('C:/Users/Administrator/.dsh/profiles/desktop/node_modules/playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-glaze'
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/state/state.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(8000)
  for (let i = 0; i < 5; i += 1) {
    const b = page.locator('button:has-text("继续"), [role=dialog] button[aria-label*="关闭"]')
    if ((await b.count()) > 0) {
      await b.first().click().catch(() => {})
      await sleep(400)
    } else break
  }

  const info = await page.evaluate(() => {
    const root = document.getElementById('root')
    const frame = root.firstElementChild?.querySelector(':scope > *')
    const describe = (el, tag) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        tag,
        cls: (el.className || '').toString().slice(0, 60),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        border: {
          left: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
          right: `${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`,
        },
        boxShadow: cs.boxShadow,
        outline: cs.outline,
        bg: cs.backgroundColor,
      }
    }

    const kids = [...frame.children].map((el, i) => describe(el, `frame child ${i}`))

    // Any element that could be drawing a vertical line: 1-2px wide, full height
    const lines = []
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width > 3 || r.height < 200) continue
      const cs = getComputedStyle(el)
      if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderLeftWidth === '0px' && cs.borderRightWidth === '0px') continue
      lines.push({ ...describe(el, 'line'), x: Math.round(r.left) })
    }

    // Border colours the palette offers
    const bodyStyle = getComputedStyle(document.body)
    const tokens = {}
    for (const name of ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4']) {
      tokens[name] = bodyStyle.getPropertyValue(name).trim()
    }

    return { kids, lines: lines.slice(0, 12), tokens, vw: innerWidth }
  })

  console.log(JSON.stringify(info, null, 1).slice(0, 6000))
  await browser.close()
})().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
