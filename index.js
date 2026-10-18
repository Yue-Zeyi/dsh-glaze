/**
 * dsh-glaze — Host half.
 *
 * Owns three things and nothing else:
 *
 *   1. The wallpaper image store. One image per DSH home, kept at
 *      `$DSH_HOME/dsh-glaze/wallpaper.<ext>` with a small `meta.json` beside it
 *      recording the original file name, MIME type and byte size. The store is
 *      deliberately a plain file, not a settings value: settings are JSON and a
 *      multi-megabyte base64 blob would bloat every `settings.describe` reply.
 *
 *   2. Two HTTP routes the browser half reads:
 *        GET    /dsh-glaze/image    the wallpaper bytes (or 404 when cleared)
 *        POST   /dsh-glaze/upload   raw image body → stores the wallpaper
 *        DELETE /dsh-glaze/image    clears the wallpaper
 *        GET    /dsh-glaze/state    { revision, mime, name, bytes } for cheap polls
 *      `state.revision` is a monotonically increasing counter kept in the meta
 *      file, so the browser can invalidate its `<img>` cache without re-reading
 *      the bytes.
 *
 *   3. Nothing user-tunable. Every numeric/behavioural preference (opacity,
 *      blur, scrim, fit, …) is a volatile field on this row's Config, which
 *      means the Settings page writes it through the normal Host settings seam
 *      and it persists in the profile's `cordis.patch.yml` like any other
 *      plugin preference. The client half reads those values from
 *      `ctx.configForms.get('dsh-glaze')`.
 *
 * The plugin is deliberately tolerant: if the webserver service is missing
 * (headless/ACP composition) the routes simply never register and the client
 * half degrades to "no wallpaper, transparency only".
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Cordis passes the plugin's `Config` schema to the settings seam, but this
 * package is installed as a `link:` in a profile, so a bare
 * `import '@deepseek-ai/schemastery'` resolves from THIS directory — which has
 * no `node_modules`. Resolve it from every place the runtime actually keeps it,
 * in order, and fall back to the local schema envelope below.
 *
 * The profile's own `node_modules` is NOT enough on its own: a `link:`ed
 * package resolves its bare imports from its real location, not from the
 * profile, and the profile only carries third-party packages anyway.
 */
function loadSchemastery() {
  const anchors = [
    // the DSH installation (where @deepseek-ai/* genuinely lives)
    process.env.DSH_INSTALL_DIR !== undefined && join(process.env.DSH_INSTALL_DIR, 'package.json'),
    // the running profile's own package.json
    process.env.DSH_PROFILE_DIR !== undefined && join(process.env.DSH_PROFILE_DIR, 'package.json'),
    process.env.DSH_HOME !== undefined && join(process.env.DSH_HOME, 'package.json'),
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  for (const anchor of anchors) {
    try {
      const loaded = createRequire(anchor)('@deepseek-ai/schemastery')
      const schema = loaded?.default ?? loaded
      if (typeof schema?.object === 'function') return schema
    } catch {
      /* try the next anchor */
    }
  }
  // Last resort: a sibling copy (development, or a profile that hoisted it).
  try {
    const loaded = createRequire(import.meta.url)('@deepseek-ai/schemastery')
    const schema = loaded?.default ?? loaded
    if (typeof schema?.object === 'function') return schema
  } catch {
    /* fall through to the local envelope */
  }
  return undefined
}

const z = loadSchemastery()

/** Folder under `$DSH_HOME` that holds the wallpaper and its metadata. */
const STORE_DIR = 'dsh-glaze'
const IMAGE_BASENAME = 'wallpaper'
const META_BASENAME = 'meta.json'

/** Largest wallpaper we accept (bytes). Keeps a decode in the browser sane. */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024

/** Accepted image MIME types → canonical file extension. */
const MIME_TO_EXT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
})

/** Extension → MIME type, for serving a stored file whose MIME we lost. */
const EXT_TO_MIME = Object.freeze(
  Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])),
)

/** Sniff an image MIME type from its leading bytes; undefined when not an image. */
function sniffMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('latin1')
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('latin1')
    const webp = buffer.subarray(8, 12).toString('latin1')
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  // SVG is text; only look at the (trimmed) head.
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return undefined
}

/**
 * The wallpaper store. One instance per host plugin fiber; the constructor does
 * no IO, so mounting is cheap and failures surface per request.
 */
class WallpaperStore {
  /**
   * @param {object} options - store wiring.
   * @param {string} options.home - resolved `$DSH_HOME`.
   * @param {{ warn: Function, info: Function }} [options.logger] - cordis logger.
   */
  constructor({ home, logger }) {
    this.dir = join(home, STORE_DIR)
    this.imagePath = join(this.dir, IMAGE_BASENAME)
    this.metaPath = join(this.dir, META_BASENAME)
    this.logger = logger
    /** In-process generation, bumped on every write so `/state` is never stale. */
    this.generation = 0
  }

  /** Read `meta.json`, tolerating absence and corruption (returns `null`). */
  async readMeta() {
    try {
      const raw = await readFile(this.metaPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return null
      return parsed
    } catch {
      return null
    }
  }

  /**
   * Resolve the stored wallpaper's location and metadata.
   * @returns {{ path: string, mime: string, name: string, bytes: number, revision: number } | null}
   */
  async describe() {
    const meta = await this.readMeta()
    if (meta === null) return null
    const ext = typeof meta.ext === 'string' && meta.ext !== '' ? meta.ext : ''
    const path = ext === '' ? this.imagePath : `${this.imagePath}.${ext}`
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size === 0) return null
      return {
        path,
        mime: typeof meta.mime === 'string' && meta.mime !== '' ? meta.mime : (EXT_TO_MIME[ext] ?? 'application/octet-stream'),
        name: typeof meta.name === 'string' ? meta.name : `wallpaper.${ext}`,
        bytes: info.size,
        revision: Number.isSafeInteger(meta.revision) ? meta.revision : 0,
      }
    } catch {
      return null
    }
  }

  /** Cheap state payload for the client's poll (no image bytes). */
  async state() {
    const described = await this.describe()
    if (described === null) {
      return { present: false, revision: 0, generation: this.generation, mime: null, name: null, bytes: 0 }
    }
    return {
      present: true,
      revision: described.revision,
      generation: this.generation,
      mime: described.mime,
      name: described.name,
      bytes: described.bytes,
    }
  }

  /**
   * Store one uploaded wallpaper, replacing any previous one.
   * @param {Buffer} body - raw image bytes.
   * @param {string | undefined} declaredName - original file name, if the client sent one.
   * @returns {Promise<object>} the new state payload.
   * @throws {Error & { code?: string }} `too-large` / `not-an-image`.
   */
  async save(body, declaredName) {
    if (body.length === 0) {
      const error = new Error('the uploaded image is empty')
      error.code = 'not-an-image'
      throw error
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      const error = new Error(`the uploaded image exceeds ${MAX_UPLOAD_BYTES} bytes`)
      error.code = 'too-large'
      throw error
    }
    const mime = sniffMime(body)
    if (mime === undefined) {
      const error = new Error('the uploaded file is not a recognized image (png, jpeg, webp, gif, avif, bmp, svg)')
      error.code = 'not-an-image'
      throw error
    }
    const ext = MIME_TO_EXT[mime]
    const previous = await this.describe()
    const revision = (previous?.revision ?? 0) + 1
    await mkdir(this.dir, { recursive: true })
    // Write beside the target and rename, so a crash mid-write never leaves a
    // half image that the browser would happily render.
    const staged = `${this.imagePath}.${ext}.uploading`
    await writeFile(staged, body)
    await rename(staged, `${this.imagePath}.${ext}`)
    // Drop any older-extension image so `/image` can never serve two files.
    if (previous !== undefined && previous !== null && previous.path !== `${this.imagePath}.${ext}`) {
      await rm(previous.path, { force: true })
    }
    await writeFile(
      this.metaPath,
      JSON.stringify(
        {
          version: 1,
          ext,
          mime,
          name: typeof declaredName === 'string' && declaredName !== '' ? declaredName : `wallpaper.${ext}`,
          bytes: body.length,
          revision,
          savedAt: Date.now(),
        },
        null,
        2,
      ),
    )
    this.generation += 1
    this.logger?.info?.('stored wallpaper %s (%d bytes, %s)', `wallpaper.${ext}`, body.length, mime)
    return this.state()
  }

  /** Remove the wallpaper and its metadata. Idempotent. */
  async clear() {
    const described = await this.describe()
    if (described !== null) await rm(described.path, { force: true })
    await rm(this.metaPath, { force: true })
    this.generation += 1
    this.logger?.info?.('cleared wallpaper')
    return this.state()
  }

  /** Read the stored wallpaper bytes for the media route. */
  async readImage() {
    const described = await this.describe()
    if (described === null) return null
    const body = await readFile(described.path)
    return { body, mime: described.mime, revision: described.revision }
  }
}

/**
 * Browser-trust fence for the plugin's own routes, mirroring the `/api`
 * gateway's check: the request must target a loopback (or configured trusted)
 * authority, must not be a cross-site browser request, and a present `Origin`
 * must name that same hostname. This is a DNS-rebinding/cross-site defense, not
 * authentication — the cookie gate already ran before the route is reached.
 *
 * @param {object} req - node request (headers/method/url).
 * @param {readonly string[]} trustedHosts - non-loopback authorities this deployment serves.
 * @returns {boolean} whether the request may reach the plugin routes.
 */
function isTrustedRequest(req, trustedHosts) {
  const header = (name) => {
    const value = req.headers?.[name]
    return typeof value === 'string' ? value : undefined
  }
  const host = header('host')
  if (host === undefined) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const isLoopback = (hostname) => {
    if (hostname === 'localhost' || hostname === '[::1]') return true
    const parts = hostname.split('.')
    return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  }
  const trusted = (trustedHosts ?? []).some((entry) => {
    try {
      const entryUrl = new URL(`http://${entry}`)
      const canonical = entryUrl.port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${entryUrl.port}`
      return canonical === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : `http://${entryUrl.host}` === `http://${hostUrl.host}`
    } catch {
      return false
    }
  })
  if (!isLoopback(hostUrl.hostname) && !trusted) return false
  if (header('sec-fetch-site') === 'cross-site') return false
  const origin = header('origin')
  if (origin === undefined) return true
  if (origin === 'dsh-app://app') return true
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}

/** Small JSON helper: write a status + JSON body. */
function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Read a request body into a Buffer, refusing past {@link MAX_UPLOAD_BYTES}. */
async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > limit) {
      const error = new Error(`the uploaded image exceeds ${limit} bytes`)
      error.code = 'too-large'
      throw error
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Services this plugin's host half needs before it can mount. */
export const inject = ['webServer']

/**
 * Minimal shape used when `@deepseek-ai/schemastery` cannot be resolved: it
 * carries the same `toJSON()` envelope the Host's schema projector reads, with
 * every field marked volatile, so the Settings page still persists edits.
 */
function fallbackSchema() {
  const field = (meta) => ({ toJSON: () => ({ type: meta.kind, meta }) })
  const dict = {
    enabled: field({ kind: 'boolean', default: true, volatile: true }),
    frosted: field({ kind: 'boolean', default: true, volatile: true }),
    opacity: field({ kind: 'number', min: 0, max: 100, step: 1, default: 35, volatile: true }),
    blur: field({ kind: 'number', min: 0, max: 60, step: 1, default: 22, volatile: true }),
    scrim: field({ kind: 'number', min: 0, max: 100, step: 1, default: 10, volatile: true }),
    dim: field({ kind: 'number', min: 0, max: 100, step: 1, default: 0, volatile: true }),
    fit: field({ kind: 'const', value: 'cover', default: 'cover', volatile: true }),
    position: field({ kind: 'const', value: 'center', default: 'center', volatile: true }),
  }
  return {
    type: 'object',
    dict,
    meta: {},
    toJSON: () => ({ type: 'object', dict: Object.fromEntries(Object.entries(dict).map(([k, v]) => [k, v.toJSON()])) }),
  }
}

/**
 * The live, user-editable preferences.
 *
 * Every field is `.volatile()`: the Host settings seam only projects volatile
 * nodes into an editable form (see `volatileForm` in @deepseek-ai/dsh-settings),
 * and a volatile field is also the one the running plugin reads through its
 * getter (`config.opacity.get()`) instead of being frozen at mount. Removing
 * any `.volatile()` here silently makes that slider stop persisting.
 *
 * The wallpaper itself is NOT here — it is a file, served by the routes below.
 */
export const Config =
  z !== undefined
    ? z.object({
        enabled: z.boolean().default(true).volatile(),
        /**
         * Frost the layout (真毛玻璃).
         *
         * ON  — the whole window gets a `backdrop-filter` blur.
         * OFF — the pane becomes a flat translucent tint instead, with no blur
         *       filter at all. That is cheaper, cannot produce compositing
         *       seams, and is the safe choice on machines or layouts where the
         *       blur misbehaves. Either way the wallpaper and the readability
         *       floor behave identically.
         */
        frosted: z.boolean().default(true).volatile(),
        /** 0..100 — how opaque the UI surfaces over the wallpaper are. */
        opacity: z.number().min(0).max(100).step(1).default(35).volatile(),
        /** 0..60 px — backdrop blur behind translucent surfaces. */
        blur: z.number().min(0).max(60).step(1).default(22).volatile(),
        /** 0..100 — palette-coloured veil between wallpaper and UI. */
        scrim: z.number().min(0).max(100).step(1).default(10).volatile(),
        /** 0..100 — extra black veil on top (bright wallpapers). */
        dim: z.number().min(0).max(100).step(1).default(0).volatile(),
        fit: z.union(['cover', 'contain', 'auto', 'repeat']).default('cover').volatile(),
        position: z.union(['center', 'top', 'bottom', 'left', 'right']).default('center').volatile(),
      })
    : fallbackSchema()

/**
 * Host entry point.
 * @param {object} ctx - cordis host context.
 * @param {object} config - the row's live config (volatile getters).
 */
export function apply(ctx, config) {
  const home = ctx.get('profileContext')?.home ?? process.env.DSH_HOME ?? ''
  if (home === '') {
    ctx.logger?.warn?.('dsh-glaze: no DSH home resolved; the wallpaper store is unavailable')
    return
  }
  const store = new WallpaperStore({ home, logger: ctx.logger })

  // Settings page is rendered by the client half, so opt out of the
  // auto-generated form for this entry (it would duplicate our page).
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'dsh-glaze: settings page policy',
    )
  })

  const fence = (req, res) => {
    // The authoritative non-loopback grants live on the web startup service
    // (`webStartup.trustedHosts`, provided by dsh-web-app from `--trusted-host`).
    // NOTE: `webRuntime` does NOT exist in this build — reading it would leave
    // the trusted list permanently empty and silently refuse every non-loopback
    // request. Both keys are probed so the plugin also works if a future release
    // moves the value.
    const startup = ctx.get('webStartup')
    const trustedHosts = startup?.trustedHosts ?? ctx.get('webRuntime')?.trustedHosts ?? []
    if (!isTrustedRequest(req, trustedHosts)) {
      res.writeHead(403)
      res.end('forbidden')
      return false
    }
    return true
  }

  // ── GET /dsh-glaze/state ────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-glaze/state',
        async handler(req, res) {
          if (!fence(req, res)) return
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            writeJson(res, 200, await store.state())
          } catch (error) {
            writeJson(res, 500, { error: String(error?.message ?? error) })
          }
        },
      }),
    'dsh-glaze: /dsh-glaze/state route',
  )

  // ── GET /dsh-glaze/image ────────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-glaze/image',
        async handler(req, res) {
          if (!fence(req, res)) return
          if (req.method === 'DELETE') {
            try {
              writeJson(res, 200, await store.clear())
            } catch (error) {
              writeJson(res, 500, { error: String(error?.message ?? error) })
            }
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            const image = await store.readImage()
            if (image === null) {
              res.writeHead(404, { 'cache-control': 'no-store' })
              res.end('no wallpaper')
              return
            }
            res.writeHead(200, {
              'content-type': image.mime,
              'content-length': String(image.body.length),
              // The URL carries the revision as a query parameter, so a long
              // cache is safe: a new wallpaper changes the URL.
              'cache-control': 'private, max-age=31536000, immutable',
              'x-content-type-options': 'nosniff',
              ...(image.mime === 'image/svg+xml'
                ? {
                    // An SVG is a scriptable document. Sandbox it so a hostile
                    // wallpaper cannot run in the GUI origin; <img> embedding is
                    // unaffected.
                    'content-security-policy': "sandbox; object-src 'none'",
                    'referrer-policy': 'no-referrer',
                  }
                : {}),
            })
            res.end(req.method === 'HEAD' ? undefined : image.body)
          } catch (error) {
            writeJson(res, 500, { error: String(error?.message ?? error) })
          }
        },
      }),
    'dsh-glaze: /dsh-glaze/image route',
  )

  // ── POST /dsh-glaze/upload ──────────────────────────────────────────────
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-glaze/upload',
        async handler(req, res) {
          if (!fence(req, res)) return
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            const body = await readBody(req, MAX_UPLOAD_BYTES)
            const declared = typeof req.headers?.['x-dsh-glaze-name'] === 'string'
              ? decodeURIComponent(req.headers['x-dsh-glaze-name'])
              : undefined
            writeJson(res, 200, await store.save(body, declared))
          } catch (error) {
            const code = error?.code === 'too-large' ? 413 : error?.code === 'not-an-image' ? 415 : 500
            writeJson(res, code, { error: String(error?.message ?? error), code: error?.code ?? null })
          }
        },
      }),
    'dsh-glaze: /dsh-glaze/upload route',
  )
}

/** Exported for tests and for the client half's type mirror. */
export { WallpaperStore, MAX_UPLOAD_BYTES, sniffMime, isTrustedRequest }
