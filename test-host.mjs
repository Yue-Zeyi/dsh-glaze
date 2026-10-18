/**
 * Unit checks for the host half's pure helpers + wallpaper store.
 *
 * Run with:  node test-host.mjs
 *
 * No framework on purpose: the plugin must stay dependency-free, so its test
 * harness is plain node:assert. Each check prints one line and a non-zero exit
 * means something regressed.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WallpaperStore, sniffMime, isTrustedRequest, MAX_UPLOAD_BYTES } from './index.js'

let failures = 0
let checks = 0
function check(name, fn) {
  checks += 1
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
  }
}
async function checkAsync(name, fn) {
  checks += 1
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}\n     ${error?.message ?? error}`)
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────
/** 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** Minimal JPEG SOI + filler. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const GIF = Buffer.from('GIF89a' + 'x'.repeat(20), 'latin1')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>', 'utf8')
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(30)])
const NOT_IMAGE = Buffer.from('this is definitely not an image', 'utf8')

// ── sniffMime ───────────────────────────────────────────────────────────────
check('sniffMime PNG', () => assert.equal(sniffMime(PNG), 'image/png'))
check('sniffMime JPEG', () => assert.equal(sniffMime(JPEG), 'image/jpeg'))
check('sniffMime GIF', () => assert.equal(sniffMime(GIF), 'image/gif'))
check('sniffMime WEBP', () => assert.equal(sniffMime(WEBP), 'image/webp'))
check('sniffMime SVG', () => assert.equal(sniffMime(SVG), 'image/svg+xml'))
check('sniffMime SVG with xml prolog', () => assert.equal(sniffMime(Buffer.from('<?xml version="1.0"?>\n<svg/>')), 'image/svg+xml'))
check('sniffMime BMP', () => assert.equal(sniffMime(BMP), 'image/bmp'))
check('sniffMime rejects text', () => assert.equal(sniffMime(NOT_IMAGE), undefined))
check('sniffMime rejects empty', () => assert.equal(sniffMime(Buffer.alloc(0)), undefined))

// ── isTrustedRequest ────────────────────────────────────────────────────────
const req = (headers, method = 'GET', url = '/dsh-glaze/state') => ({ headers, method, url })
check('fence: loopback host passes', () => assert.equal(isTrustedRequest(req({ host: '127.0.0.1:59813' }), []), true))
check('fence: localhost passes', () => assert.equal(isTrustedRequest(req({ host: 'localhost:59813' }), []), true))
check('fence: ipv6 loopback passes', () => assert.equal(isTrustedRequest(req({ host: '[::1]:59813' }), []), true))
check('fence: missing host refused', () => assert.equal(isTrustedRequest(req({}), []), false))
check('fence: cross-site refused', () =>
  assert.equal(isTrustedRequest(req({ host: '127.0.0.1:1', 'sec-fetch-site': 'cross-site' }), []), false))
check('fence: foreign origin refused', () =>
  assert.equal(isTrustedRequest(req({ host: '127.0.0.1:1', origin: 'https://evil.example' }), []), false))
check('fence: same origin passes', () =>
  assert.equal(isTrustedRequest(req({ host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' }), []), true))
check('fence: desktop shell origin passes', () =>
  assert.equal(isTrustedRequest(req({ host: '127.0.0.1:1', origin: 'dsh-app://app' }), []), true))
check('fence: trusted host passes', () =>
  assert.equal(isTrustedRequest(req({ host: 'harness.internal:8080' }), ['harness.internal']), true))
check('fence: untrusted non-loopback refused', () =>
  assert.equal(isTrustedRequest(req({ host: 'evil.example:80' }), ['harness.internal']), false))

// ── WallpaperStore ──────────────────────────────────────────────────────────
const home = await mkdtemp(join(tmpdir(), 'dsh-glaze-test-'))
const store = new WallpaperStore({ home, logger: undefined })

await checkAsync('store: initially empty', async () => {
  const state = await store.state()
  assert.equal(state.present, false)
  assert.equal(state.revision, 0)
  assert.equal(await store.readImage(), null)
})

await checkAsync('store: save PNG', async () => {
  const state = await store.save(PNG, 'my wallpaper.png')
  assert.equal(state.present, true)
  assert.equal(state.revision, 1)
  assert.equal(state.mime, 'image/png')
  assert.equal(state.name, 'my wallpaper.png')
  assert.equal(state.bytes, PNG.length)
  assert.ok(existsSync(join(home, 'dsh-glaze', 'wallpaper.png')), 'file written')
})

await checkAsync('store: reads back identical bytes', async () => {
  const image = await store.readImage()
  assert.notEqual(image, null)
  assert.equal(image.mime, 'image/png')
  assert.deepEqual(image.body, PNG)
})

await checkAsync('store: replacing bumps revision and drops old extension', async () => {
  const state = await store.save(JPEG, 'photo.jpg')
  assert.equal(state.revision, 2)
  assert.equal(state.mime, 'image/jpeg')
  assert.equal(existsSync(join(home, 'dsh-glaze', 'wallpaper.jpg')), true)
  assert.equal(existsSync(join(home, 'dsh-glaze', 'wallpaper.png')), false, 'stale png removed')
  const image = await store.readImage()
  assert.deepEqual(image.body, JPEG)
})

await checkAsync('store: clear is idempotent', async () => {
  const first = await store.clear()
  assert.equal(first.present, false)
  const second = await store.clear()
  assert.equal(second.present, false)
  assert.equal(existsSync(join(home, 'dsh-glaze', 'meta.json')), false)
})

await checkAsync('store: rejects non-image', async () => {
  await assert.rejects(() => store.save(NOT_IMAGE, 'notes.txt'), (error) => error.code === 'not-an-image')
})

await checkAsync('store: rejects empty', async () => {
  await assert.rejects(() => store.save(Buffer.alloc(0)), (error) => error.code === 'not-an-image')
})

await checkAsync('store: rejects oversized', async () => {
  const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)
  huge[0] = 0x89 // doesn't matter, size check comes first
  await assert.rejects(() => store.save(huge), (error) => error.code === 'too-large')
})

await checkAsync('store: survives corrupted meta.json', async () => {
  await writeFile(join(home, 'dsh-glaze', 'meta.json'), '{ not json')
  const state = await store.state()
  assert.equal(state.present, false)
  // and can still save afterwards
  const saved = await store.save(SVG, 'icon.svg')
  assert.equal(saved.present, true)
  assert.equal(saved.mime, 'image/svg+xml')
})

await checkAsync('store: detects missing image file behind meta', async () => {
  await rm(join(home, 'dsh-glaze', 'wallpaper.svg'), { force: true })
  const state = await store.state()
  assert.equal(state.present, false)
})

await rm(home, { recursive: true, force: true })

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
