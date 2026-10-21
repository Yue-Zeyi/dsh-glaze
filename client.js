/**
 * dsh-glaze — browser half.
 *
 * Two jobs:
 *
 *  A. PAINT THE SKIN. A fixed wallpaper layer is inserted as the first child of
 *     `<body>` at `z-index:-1`, and the document canvas is made transparent so
 *     that layer actually shows. The DSH shell then paints its OWN opaque
 *     surfaces on top, so we push those toward translucent by re-binding the
 *     layout token family (`--dsw-alias-bg-*`, `--dsw-specific-*`, ...) to
 *     `color-mix(... transparent <opacity>%)` values derived from the opacity
 *     slider.
 *
 *     That re-binding must not fight the theme presenter: `ui-layout` writes the
 *     same custom properties as INLINE styles on `body` (which beat any
 *     stylesheet rule) every time the palette or a theme token changes. So we
 *     keep the presenter's raw value per token and re-derive our alpha-wrapped
 *     value from it on every `theme/change`.
 *
 *  B. OFFER THE CONTROLS. A `settings.section` page (Settings -> Skin) with the
 *     wallpaper picker (upload / clear / live preview), the opacity / blur /
 *     scrim / dim sliders and the fit/position/surfaces selects. Values persist
 *     through the Host settings seam (`ctx.configForms.get('dsh-glaze')`); the
 *     image lives behind the plugin's own `/dsh-glaze/*` routes (see index.js).
 *
 * Everything is best-effort: a missing service disables that one feature and
 * never takes the shell down.
 */

window.__ModuleLoader__.load({
  id: 'dsh-glaze',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PLUGIN_ID = 'dsh-glaze'
    /** Loader entry id — also the Host settings namespace our Config lives in. */
    const SETTINGS_ENTRY_ID = 'dsh-glaze'
    /** Stylesheet identity inside the plugin's own `data-plugin-css` bucket. */
    const STYLE_ID = 'dsh-glaze/glaze.css'
    const BACKDROP_ID = 'dsh-glaze-backdrop'
    const SCRIM_ID = 'dsh-glaze-scrim'
    const DIM_ID = 'dsh-glaze-dim'
    /** The single full-window frosted pane (see the CSS block). */
    const GLASS_ID = 'dsh-glaze-pane'
    /** The <style> element holding the generated structural clear rules. */
    const CLEAR_STYLE_ID = 'dsh-glaze-clear-rules'
    /** Marker on `<html>` while the skin is enabled (drives the CSS below). */
    const ROOT_CLASS = 'dsh-glaze-active'

    const LOCALE_NS = 'dshGlaze'

    /** Every option the Settings page edits; mirrors the Host Config schema. */
    const FIELDS = Object.freeze({
      opacity: 'opacity',
      blur: 'blur',
      scrim: 'scrim',
      fit: 'fit',
      position: 'position',
      enabled: 'enabled',
      dim: 'dim',
      frosted: 'frosted',
    })

    const FIT_MODES = Object.freeze(['cover', 'contain', 'auto', 'repeat'])
    const POSITIONS = Object.freeze(['center', 'top', 'bottom', 'left', 'right'])

    /** Schema defaults — kept in sync with cordis.patch.yml + index.js Config. */
    const DEFAULTS = Object.freeze({
      enabled: true,
      frosted: true,
      opacity: 35,
      blur: 22,
      scrim: 10,
      dim: 0,
      fit: 'cover',
      position: 'center',
    })

    // ------------------------------- style --------------------------------

    /**
     * The static stylesheet. Per-token alpha values are NOT here: they are
     * computed from the opacity field and written as body inline styles by
     * paint(). This sheet owns the wallpaper layers, the transparent canvas
     * that lets them show, and the settings page's own layout.
     */
    const CSS = `
/* wallpaper layers.
 *
 * ARCHITECTURE (v0.4): the wallpaper is the BODY'S OWN background, not a
 * separate z-index:-1 element.
 *
 * Why: backdrop-filter samples the pixels painted BENEATH the element. A
 * positioned layer at z-index:-1 sits outside that sampling surface (the
 * filter sees the transparent root canvas), so the glass renders as flat paint
 * and the wallpaper is never blurred — or even visible — behind it. Making the
 * wallpaper the body background puts it in the page's own paint order directly
 * beneath #root, which is exactly the surface backdrop-filter reads.
 */
html.${ROOT_CLASS} body {
  background-color: transparent !important;
  background-repeat: no-repeat;
  background-position: center center;
  background-size: cover;
  background-attachment: fixed;
}
html.${ROOT_CLASS} #root {
  background-color: transparent !important;
  position: relative;
  z-index: 1;
}
/* The shell's frame paints an OPAQUE canvas over everything — it is the element
   the theme's --dsw-alias-bg-base ends up on. Without clearing it the body
   wallpaper can never be seen, however transparent the columns are.
   Every layout container between #root and the columns is cleared here; the
   columns themselves get the frosted fill from the rules below. */
html.${ROOT_CLASS} #root > div,
html.${ROOT_CLASS} #root > div > div,
html.${ROOT_CLASS} #root .BynINW_frame,
html.${ROOT_CLASS} #root .BynINW_centerCol,
html.${ROOT_CLASS} #root .BynINW_rightbarCol,
html.${ROOT_CLASS} #root .Dc7zOa_root,
html.${ROOT_CLASS} #root .Dc7zOa_body {
  background-color: transparent !important;
}

/* The scrim / dim veils sit BETWEEN the wallpaper and #root's content.
 *
 * IMPORTANT: every layer rule is scoped to the active class. When the skin is
 * switched off the marker class is removed first, so no rule below can keep
 * painting over the shell — that scoping is what guarantees "turn it off and
 * you get the stock look back". (An earlier version left these selectors
 * unscoped, so disabling the skin left the pane covering the window and the UI
 * could not be restored without a restart.) */
html.${ROOT_CLASS} #${SCRIM_ID},
html.${ROOT_CLASS} #${DIM_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
html.${ROOT_CLASS} #${SCRIM_ID} {
  background: var(--dsh-glaze-scrim-color, #fff);
  opacity: var(--dsh-glaze-scrim-alpha, 0.1);
}
html.${ROOT_CLASS} #${DIM_ID} {
  background: #000;
  opacity: 0;
  transition: opacity 240ms ease;
}
html.${ROOT_CLASS} #${DIM_ID}[data-visible='true'] { opacity: var(--dsh-glaze-dim-alpha, 0); }

/* ------------------------------------------------------------------ *
 * ONE FROSTED PANE
 *
 * v0.5 architecture. Earlier versions frosted the three layout columns
 * individually. That produced two visible defects:
 *
 *   1. The top chrome (tab strip, title row) is NOT inside any of those
 *      columns, so it had no glass at all and the raw wallpaper showed
 *      through its text.
 *   2. Three separately-frosted rectangles have three sets of edges, so the
 *      result read as separate panels stuck together rather than a skin.
 *
 * So there is now exactly ONE full-window frosted pane, painted between the
 * wallpaper and the shell content. Everything above it only has to be
 * transparent, and the whole window shares one blur and one tint — no seams,
 * no double-filtering.
 *
 * Like the veils above, it is scoped to the active class: disabling the skin
 * must leave nothing painted on top of the shell.
 * ------------------------------------------------------------------ */
html.${ROOT_CLASS} #${GLASS_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-color: color-mix(in srgb, var(--dsh-glaze-pane-fill, #ffffff) var(--dsh-glaze-pane-opacity, 78%), transparent);
  -webkit-backdrop-filter: var(--dsh-glaze-pane-filter, blur(var(--dsh-glaze-pane-blur, 18px)) saturate(130%));
  backdrop-filter: var(--dsh-glaze-pane-filter, blur(var(--dsh-glaze-pane-blur, 18px)) saturate(130%));
}

/* Clear the shell's opaque fill on the STRUCTURE only.
 *
 * Two failed extremes are worth recording here, because both produced visible
 * bugs the user reported:
 *
 *   v0.4  named individual CSS-module classes. Their hashes change between
 *         builds, and the top tab host / sidebar root were missed — two opaque
 *         white slabs left sitting on top of the glass.
 *   v0.5  cleared every element inside #root wholesale. That caught every
 *         structure, but it also erased the fills of components that legitimately
 *         need one (the composer card, message bubbles), so surfaces went
 *         see-through.
 *
 * The workable middle ground: mark only measured STRUCTURAL containers from JS
 * (this class), and converge over a few frames so a container that mounts after
 * the first paint cannot stay opaque — see scheduleClearSync().
 */
/* The composer card + the strip above it (task/queue dock) overlay scrolling
   rows. backdrop-filter cannot be relied on there: the card lives inside the
   scroll container, so Chromium will not sample its siblings. A near-solid fill
   is the only correct answer — it hides the rows completely, and the blur is
   kept only to soften the wallpaper visible around the card. */
/* The composer card sits above the scrolling rows, so it needs a near-solid
   fill (see the note above). */
html.${ROOT_CLASS} [data-composer-card] {
  background-color: color-mix(in srgb, var(--dsh-glaze-card-fill, var(--dsw-alias-bg-layer-1)) var(--dsh-glaze-card-opacity, 96%), transparent) !important;
  -webkit-backdrop-filter: blur(var(--dsh-glaze-pane-blur, 16px)) saturate(140%);
  backdrop-filter: blur(var(--dsh-glaze-pane-blur, 16px)) saturate(140%);
}

/* The composer dock holds the status readout under the input (turn count, output
   speed; total tokens, cache hits).
 *
 * The shell renders it as bare text on the layout background, which under a
 * skin leaves the readout floating in the gap below the card. It gets a capsule
 * so it reads as one deliberate chip row.
 *
 * Two things are deliberately NOT used here, because both produced the "looks
 * off" impression the user kept reporting:
 *
 *   backdrop-filter — the pill sits on top of the glass pane, which has already
 *       blurred everything behind it. Adding a second filter only creates a new
 *       compositing layer whose edges show up as a faint rectangular halo
 *       around the pill.
 *   box-shadow / border — both outline the pill against the glass and make it
 *       read as a separate little box dropped into the gap.
 *
 * What is left is a flat, slightly translucent fill: no filter, no outline, so
 * there is no rectangle other than the pill itself.
 */
html.${ROOT_CLASS} [data-composer-dock] {
  background-color: color-mix(in srgb, var(--dsh-glaze-pane-fill, #ffffff) 55%, transparent) !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 999px !important;
  padding: 4px 16px !important;
  width: fit-content !important;
  max-width: 100%;
  margin-inline: auto;
  box-sizing: border-box;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
/* Flatten EVERY level inside the pill. The shell nests the two stat entries a
   few wrappers deep and some of them carry their own hover/pill surface, which
   turned the capsule into a box inside a box. The universal selector is safe
   here: the dock holds only a handful of nodes. */
html.${ROOT_CLASS} [data-composer-dock] * {
  background-color: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
}

/* The queue dock overlays scrolling rows, so it keeps a near-solid fill (the
   capsule treatment above is for the status readout only). */
html.${ROOT_CLASS} [data-queue-dock] {
  background-color: color-mix(in srgb, var(--dsh-glaze-card-fill, var(--dsw-alias-bg-layer-1)) var(--dsh-glaze-card-opacity, 96%), transparent) !important;
  border-radius: var(--dsw-radius-lg, 16px);
  -webkit-backdrop-filter: blur(var(--dsh-glaze-pane-blur, 16px)) saturate(140%);
  backdrop-filter: blur(var(--dsh-glaze-pane-blur, 16px)) saturate(140%);
}

/* dialogs keep their material: they mount outside #root and must stay legible
   at any opacity setting. */
html.${ROOT_CLASS} [role='dialog'] {
  background-color: var(--dsh-glaze-dialog-fill, var(--dsw-alias-bg-layer-1)) !important;
  -webkit-backdrop-filter: blur(30px) saturate(140%);
  backdrop-filter: blur(30px) saturate(140%);
}

/* settings page */
.dsh-glaze-page { display: flex; flex-direction: column; padding: 4px 0 24px; }
.dsh-glaze-row { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-glaze-row:last-child { border-bottom: none; }
.dsh-glaze-rowText { display: flex; flex-direction: column; flex: 1 1 auto; gap: 4px; min-width: 0; padding-right: 24px; }
.dsh-glaze-title { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.dsh-glaze-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-glaze-control { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dsh-glaze-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

.dsh-glaze-btn {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; height: 32px; padding: 0 14px;
  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; cursor: pointer;
  transition: background .1s ease;
}
.dsh-glaze-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-glaze-btn:disabled { opacity: .5; cursor: default; }
.dsh-glaze-btn[data-variant='primary'] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); }
.dsh-glaze-btn[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-glaze-btn[data-variant='danger'] { color: var(--dsw-alias-state-error-primary); }

.dsh-glaze-slider {
  appearance: none; width: 170px; height: 4px; border-radius: 999px;
  background: var(--dsw-alias-border-l3); outline: none; cursor: pointer;
}
.dsh-glaze-slider::-webkit-slider-thumb {
  appearance: none; width: 14px; height: 14px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-brand-primary); border: .5px solid var(--dsw-alias-border-l4);
}
.dsh-glaze-number { min-width: 46px; font-variant-numeric: tabular-nums; font-size: 13px; text-align: right; color: var(--dsw-alias-label-secondary); }

.dsh-glaze-select {
  height: 32px; padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
}

.dsh-glaze-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  corner-shape: round; background: var(--dsw-alias-border-l3); cursor: pointer;
}
.dsh-glaze-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dsh-glaze-switch > span {
  display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground); transition: transform .12s ease;
}
.dsh-glaze-switch[aria-checked='true'] > span { transform: translateX(16px); }

.dsh-glaze-preview {
  position: relative; width: 100%; max-width: 440px; aspect-ratio: 16 / 10;
  border-radius: var(--dsw-radius-lg, 16px); border: .5px solid var(--dsw-alias-border-l4);
  overflow: hidden; background: var(--dsw-alias-bg-module-platform);
  display: grid; place-items: center;
}
.dsh-glaze-preview > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dsh-glaze-previewScrim { position: absolute; inset: 0; background: #000; }
.dsh-glaze-previewCard {
  position: relative; margin: 10%;
  padding: 10px 14px; border-radius: 10px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l4);
  box-shadow: 0 4px 16px #0003;
}
.dsh-glaze-previewEmpty { position: relative; z-index: 1; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-glaze-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; margin: 8px 0 0; }
.dsh-glaze-error { color: var(--dsw-alias-state-error-primary); }
.dsh-glaze-errorRow { padding: 8px 0 0; }
.dsh-glaze-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
`

    // ------------------------------ glass pane ----------------------------

    /**
     * How the single frosted pane is confined, per the "Applies to" control.
     *
     * `all`     — the whole window (one seamless pane; the default).
     * `main`    — only the centre column (the conversation/panel area).
     * `sidebar` — only the sidebar column.
     *
     * The pane is a fixed-position element whose geometry is written from JS,
     * so scoping it is one style update rather than a different set of CSS
     * rules. Window chrome (the tab strip / title row) is NOT reachable from
     * here — it belongs to the shell's own top bar, which stays on the full
     * window pane.
     */
    const GLASS_SCOPES = Object.freeze(['all', 'main', 'sidebar'])

    /** Custom properties this plugin writes on `body` for the glass surfaces. */
    const GLASS_VARIABLES = Object.freeze([
      '--dsh-glaze-pane-blur',
      '--dsh-glaze-pane-opacity',
      '--dsh-glaze-card-opacity',
      '--dsh-glaze-pane-fill',
      '--dsh-glaze-card-fill',
      '--dsh-glaze-dialog-fill',
      '--dsh-glaze-divider',
    ])

    /**
     * Read one palette colour from the theme presenter.
     *
     * The presenter writes its tokens as INLINE styles on `body`, so an inline
     * value (when present) is the authoritative palette colour. Falling back to
     * the computed value keeps this working for tokens a theme only defines in
     * its stylesheet. Never call this per pointer event — only once per palette
     * change (it can force a style flush).
     *
     * @param body - the `body` element.
     * @param name - CSS custom property name.
     * @returns the colour string, or '' when unknown.
     */
    function paletteColor(body, name) {
      const inline = body.style.getPropertyValue(name).trim()
      if (inline !== '') return inline
      try {
        return getComputedStyle(body).getPropertyValue(name).trim()
      } catch {
        return ''
      }
    }

    /** Clamp a number into [min, max], falling back to `fallback` when unusable. */
    function clamp(value, min, max, fallback) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, number))
    }

    /** Resolve a stored config snapshot to a plain, fully-populated settings object. */
    function normalizeSettings(value) {
      const raw = value !== null && typeof value === 'object' ? value : {}
      return {
        enabled: raw[FIELDS.enabled] !== false,
        frosted: raw[FIELDS.frosted] !== false,
        opacity: clamp(raw[FIELDS.opacity], 0, 100, DEFAULTS.opacity),
        blur: clamp(raw[FIELDS.blur], 0, 60, DEFAULTS.blur),
        scrim: clamp(raw[FIELDS.scrim], 0, 100, DEFAULTS.scrim),
        dim: clamp(raw[FIELDS.dim], 0, 100, DEFAULTS.dim),
        fit: FIT_MODES.includes(raw[FIELDS.fit]) ? raw[FIELDS.fit] : DEFAULTS.fit,
        position: POSITIONS.includes(raw[FIELDS.position]) ? raw[FIELDS.position] : DEFAULTS.position,
      }
    }

    // ------------------------------- runtime ------------------------------

    const runtime = {
      ctx: null,
      /** Shared config form (`ctx.configForms.get(...)`), resolved lazily. */
      form: null,
      formUnavailable: false,
      /** The current normalized settings. */
      settings: normalizeSettings(undefined),
      /** Wallpaper state from the Host (`{ present, revision, ... }`). */
      image: { present: false, revision: 0, mime: null, name: null, bytes: 0 },
      /** Object URL mounted on the backdrop while a local file uploads. */
      objectUrl: null,
      /** Cached palette colours for the glass layers (invalidated on theme change). */
      palette: null,
      /**
       * Whether a real (ready) snapshot from the Host has been adopted yet.
       * Until it is, the in-memory settings are schema defaults and must not be
       * presented as the user's choices.
       */
      settingsAdopted: false,
      listeners: new Set(),
      routeBase: '',
    }

    /** Current alpha we aim for (0.06..1); 1 means "leave the palette alone". */
    function targetAlpha() {
      if (!runtime.settings.enabled) return 1
      return Math.max(0.06, Math.min(1, runtime.settings.opacity / 100))
    }

    /** Notify every subscribed surface that runtime state changed. */
    function notify() {
      for (const listener of runtime.listeners) {
        try {
          listener()
        } catch {
          /* a broken listener must not abort the rest */
        }
      }
    }

    /**
     * Resolve the plugin's HTTP routes. Same-origin is what we want: in the
     * Electron shell the page is `dsh-app://app/` and the shell forwards
     * unknown paths to the Host, so a page-relative URL reaches our route and
     * passes the browser-trust fence. A leading slash would pin to the origin
     * root and break reverse-proxy prefixes, so resolve against `baseURI`.
     */
    function resolveRouteBase() {
      if (typeof document === 'undefined') return ''
      try {
        const base = new URL(document.baseURI ?? location.href)
        base.search = ''
        base.hash = ''
        if (!base.pathname.endsWith('/')) base.pathname += '/'
        return base.href
      } catch {
        return ''
      }
    }

    /** Absolute URL for one of the plugin's routes. */
    function routeUrl(path, query) {
      const base = runtime.routeBase === '' ? resolveRouteBase() : runtime.routeBase
      if (base === '') return null
      try {
        const url = new URL(path.replace(/^\/+/, ''), base)
        if (query !== undefined) {
          for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
        }
        return url
      } catch {
        return null
      }
    }

    /** Install the static stylesheet once (removed with the plugin fiber). */
    function installStyles(ctx) {
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`
      if (document.querySelector(selector) !== null) return
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', STYLE_ID)
      tag.setAttribute('data-plugin', PLUGIN_ID)
      tag.textContent = CSS
      document.head.appendChild(tag)
      ctx.effect(
        () => () => {
          tag.remove()
        },
        'dsh-glaze: stylesheet',
      )
    }

    /**
     * Create (once) the two veil layers that sit between the wallpaper and the
     * UI: the readability scrim and the optional dark dim.
     *
     * The wallpaper itself is NOT an element any more — it is the body
     * background, so that `backdrop-filter` on the structural columns has
     * something real to sample (see the CSS block).
     */
    /**
     * Mark the shell's structural containers so their opaque fill is cleared.
     *
     * The frosted pane sits BELOW the shell content, so any container painting
     * a solid fill in front of it hides the glass entirely. The pane cannot be
     * moved above the content, so those containers have to be cleared.
     *
     * Containers are found by MEASUREMENT (class names are CSS-module hashes
     * that change between builds):
     *
     *   tall track  — a full-height column (sidebar, centre, tab host)
     *   wide bar    — a full-width strip (bottom status bar, title row)
     *
     * Both shapes are structure. Anything that is a control, or that the CSS
     * already gives a deliberate fill (composer, menus, dialogs, bubbles), is
     * excluded — clearing those was what made surfaces go see-through in v0.5.
     */
    /**
     * Build a stable STRUCTURAL selector for an element inside #root.
     *
     * The selector is a chain of positional steps (`> :nth-child(k)`) up to
     * #root. That matters: it describes the POSITION, not the element's own
     * attributes, so a React re-render that rebuilds the node (or rewrites its
     * className) does not invalidate the rule. Marking elements with a class
     * did not survive that — which is exactly why the sidebar kept reverting to
     * its opaque look at random moments.
     *
     * @param el - element inside #root.
     * @returns the selector, or null when the element is not inside #root.
     */
    function structuralSelector(el) {
      const root = document.getElementById('root')
      const steps = []
      let node = el
      while (node !== null && node !== root) {
        const parent = node.parentElement
        if (parent === null) return null
        const index = Array.prototype.indexOf.call(parent.children, node)
        if (index < 0) return null
        steps.unshift(`> :nth-child(${index + 1})`)
        node = parent
      }
      if (node !== root) return null
      return '#root ' + steps.join(' ')
    }

    /**
     * Find the shell's opaque structural containers.
     *
     * The frosted pane sits BELOW the shell content, so any container that
     * paints a solid fill in front of it hides the glass. The pane cannot be
     * moved above the content, so those containers must be cleared.
     *
     * Containers are identified by MEASUREMENT — the shell's class names are
     * CSS-module hashes that change between builds:
     *
     *   tall track — a full-height, reasonably wide column (sidebar, centre,
     *                tab host, session panel)
     *   wide bar   — a full-width strip (bottom status bar, title row)
     *
     * Everything that is a control, or that the stylesheet deliberately fills
     * (composer, menus, dialogs, message bubbles), is excluded — clearing those
     * was what made surfaces go see-through.
     *
     * @returns selectors for the containers that need clearing.
     */
    function findOpaqueContainers() {
      const root = document.getElementById('root')
      if (root === null) return []
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      const selectors = []
      for (const el of root.querySelectorAll('*')) {
        if (el.matches('button, a, input, select, textarea, svg, img, style, script')) continue
        // Never touch anything that lives inside CONTENT. A code block inside a
        // long answer is wide and can be a couple of hundred pixels tall, so it
        // satisfies the "wide bar" geometry — clearing it would strip the block
        // of its own background. The transcript, the composer and every popup
        // are therefore excluded wholesale; only the layout AROUND them is
        // structure.
        if (
          el.closest(
            '[data-conversation-scroll], [data-composer-card], [data-composer-dock], [data-queue-dock], [data-menu-material], [role="menu"], [role="dialog"], [role="tooltip"], [role="button"], button, a, input, select, textarea',
          ) !== null
        )
          continue
        const rect = el.getBoundingClientRect()
        const tallTrack = rect.height >= vh * 0.9 && rect.width >= vw * 0.15
        const wideBar = rect.height >= 20 && rect.height <= vh * 0.25 && rect.width >= vw * 0.5
        // The status line under the composer (turn count, tokens, cache hit) is
        // a short strip pinned to the bottom. It is narrower than a title bar,
        // so `wideBar` misses it and it kept painting a raised white slab over
        // the glass. Anything sitting in the bottom band that spans a real part
        // of the window is chrome, not content.
        const bottomBand =
          rect.bottom >= vh - 150 && rect.height >= 10 && rect.height <= 130 && rect.width >= vw * 0.2
        if (!tallTrack && !wideBar && !bottomBand) continue
        // GEOMETRIC ONLY — never inspect the computed background here.
        //
        // Selecting by "is it opaque?" looks like the obvious filter, and it was
        // there originally, but it is SELF-REFERENTIAL: once a container has
        // been cleared it computes as transparent, so the next pass drops its
        // rule — which makes it opaque again. That is precisely the sidebar
        // reverting to its stock look at seemingly random moments.
        //
        // Clearing something already transparent is a no-op, so geometry alone
        // is both correct and stable.
        const selector = structuralSelector(el)
        if (selector !== null) selectors.push(selector)
      }
      return selectors
    }

    /** The <style> element holding the generated clear rules. */
    function clearSheet() {
      let tag = document.getElementById(CLEAR_STYLE_ID)
      if (tag === null) {
        tag = document.createElement('style')
        tag.id = CLEAR_STYLE_ID
        tag.setAttribute('data-plugin-css', STYLE_ID)
        document.head.appendChild(tag)
      }
      return tag
    }

    /**
     * Regenerate the clear rules.
     *
     * The generated rules are keyed on structural position, so once written
     * they keep applying across React re-renders. Only the SET of containers
     * changes now and then, so the sheet is rewritten only when the selector
     * list actually differs — this keeps the common case allocation-free.
     */
    let lastSelectors = ''

    /**
     * The shell's left sidebar column, as an element.
     *
     * Identified structurally (first full-height child of the frame that starts
     * at the left edge and is narrower than the main area), because the package's
     * class names are CSS-module hashes.
     *
     * @returns the element, or null when the sidebar is collapsed/absent.
     */
    function findSidebarColumn() {
      const root = document.getElementById('root')
      const frame = root?.firstElementChild?.querySelector(':scope > *') ?? null
      if (frame === null) return null
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      for (const el of frame.children) {
        const rect = el.getBoundingClientRect()
        if (rect.left > 2) continue
        if (rect.height < vh * 0.9) continue
        if (rect.width < 140 || rect.width > vw * 0.45) continue
        return el
      }
      return null
    }

    function syncClearSheet() {
      if (typeof document === 'undefined') return
      if (!runtime.settings.enabled) {
        clearSheet().textContent = ''
        lastSelectors = ''
        return
      }
      const selectors = findOpaqueContainers()

      // The divider between the sidebar and the main area.
      //
      // The shell draws one (`border-right: 1px solid rgba(0,0,0,.12)`) and it
      // reads fine on a light background — measured as a 19/255 luminance dip —
      // but on the dark theme that same 12% black line sits on dark glass and
      // disappears completely (measured dip: 0.03). Meanwhile the RIGHT dock's
      // divider is a LIGHT hairline (+40 luminance).
      //
      // So the left divider is re-declared here with a theme-aware colour
      // (`--dsh-glaze-divider`, set from paint()), which keeps the light theme
      // pixel-identical and gives the dark theme the matching light hairline.
      const sidebar = findSidebarColumn()
      const sidebarSelector = sidebar === null ? null : structuralSelector(sidebar)

      const key = selectors.join('|') + '#' + (sidebarSelector ?? '')
      if (key === lastSelectors) return
      lastSelectors = key

      const rules = []
      for (const selector of selectors) {
        const scoped = `html.${ROOT_CLASS} ${selector}`
        rules.push(`${scoped} { background-color: transparent !important; }`)
        // The scroll-fade veil fades to an OPAQUE palette colour. Once the
        // container behind it is transparent, that opaque endpoint becomes a
        // hard-edged coloured strip. Drop the veil's gradient instead.
        rules.push(`${scoped} [class*='fade'] { background-image: none !important; }`)
      }
      if (sidebarSelector !== null) {
        rules.push(
          `html.${ROOT_CLASS} ${sidebarSelector} { border-right: 1px solid var(--dsh-glaze-divider, rgba(0, 0, 0, 0.12)) !important; }`,
        )
      }
      clearSheet().textContent = rules.join('\n')
    }

    /**
     * Re-run the clear pass whenever the shell's DOM changes.
     *
     * Debounced to one pass per animation frame: the shell mounts its chrome in
     * bursts, and a burst only needs the final layout measured once. There is
     * no fixed "settle window" any more — a container that appears five seconds
     * after startup is caught just as reliably as one that appears immediately,
     * which is what the previous time-boxed loop got wrong.
     */
    let clearFrame = 0
    let clearObserver = null

    function scheduleClearSync() {
      if (typeof window === 'undefined') return
      if (clearFrame !== 0) return
      clearFrame = window.requestAnimationFrame(() => {
        clearFrame = 0
        syncClearSheet()
        layoutGlassPane()
      })
    }

    function watchClear() {
      if (clearObserver !== null) return
      const root = document.getElementById('root')
      if (root === null) return
      clearObserver = new MutationObserver(scheduleClearSync)
      clearObserver.observe(root, { childList: true, subtree: true })
      window.addEventListener('resize', scheduleClearSync)
    }

    function unwatchClear() {
      clearObserver?.disconnect()
      clearObserver = null
      if (clearFrame !== 0) {
        window.cancelAnimationFrame(clearFrame)
        clearFrame = 0
      }
    }

    /** Drop the generated rules and stop observing (disable / unload). */
    function clearStructuralContainers() {
      unwatchClear()
      lastSelectors = ''
      document.getElementById(CLEAR_STYLE_ID)?.remove()
    }

    /**
     * Tear the three helper layers out of the document.
     *
     * Called when the skin is switched off. The stylesheet already stops
     * matching once the active class is gone, but removing the nodes as well
     * means "off" leaves the DOM exactly as the shell built it — no leftovers
     * that could interact with a future shell change.
     */
    function removeLayers() {
      if (typeof document === 'undefined') return
      for (const id of [GLASS_ID, SCRIM_ID, DIM_ID]) document.getElementById(id)?.remove()
    }

    /**
     * The frosted pane, plus the readability scrim and the optional dark dim.
     *
     * Paint order (bottom to top): the wallpaper (body background) → scrim →
     * dim → gloss pane → shell content (#root). All three helper layers are
     * fixed-position, non-interactive siblings of #root.
     */
    function ensureLayers() {
      let glass = document.getElementById(GLASS_ID)
      if (glass === null) {
        glass = document.createElement('div')
        glass.id = GLASS_ID
        glass.setAttribute('aria-hidden', 'true')
        document.body.appendChild(glass)
      }
      let scrim = document.getElementById(SCRIM_ID)
      if (scrim === null) {
        scrim = document.createElement('div')
        scrim.id = SCRIM_ID
        scrim.setAttribute('aria-hidden', 'true')
        document.body.appendChild(scrim)
      }
      let dim = document.getElementById(DIM_ID)
      if (dim === null) {
        dim = document.createElement('div')
        dim.id = DIM_ID
        dim.setAttribute('aria-hidden', 'true')
        dim.dataset.visible = 'false'
        document.body.appendChild(dim)
      }
      return { glass, scrim, dim }
    }

    /**
     * Forget the cached palette colours so the next paint re-reads them.
     * Called on `theme/change`: a light->dark switch replaces every colour.
     */
    function invalidatePalette() {
      runtime.palette = null
    }

    /**
     * Resolve (and cache) the few palette colours the glass layers need.
     *
     * v0.3 only needs three values — the base canvas, the raised panel, and the
     * card/control fill — instead of re-deriving 22 tokens. Each lookup can
     * force a style flush, so they are read once per palette change and then
     * handed to CSS as custom properties.
     *
     * @param body - the `body` element.
     * @returns {{ base: string, layer: string, card: string }}
     */
    function palette(body) {
      if (runtime.palette !== null) return runtime.palette
      const base = paletteColor(body, '--dsw-alias-bg-base') || '#ffffff'
      const layer = paletteColor(body, '--dsw-alias-bg-layer-1') || base
      const card = paletteColor(body, '--dsw-alias-bg-layer-2') || layer
      runtime.palette = { base, layer, card }
      return runtime.palette
    }

    /** Handle of the pending animation frame for a coalesced repaint. */
    let paintFrame = 0

    /**
     * Coalesce repaints into one per animation frame.
     *
     * Sliders emit `input` on every pixel of travel; painting synchronously per
     * event would run a full style/layout pass dozens of times per frame. One
     * paint per frame keeps the drag smooth and is all the eye can see anyway.
     */
    function schedulePaint() {
      if (paintFrame !== 0) return
      paintFrame = window.requestAnimationFrame(() => {
        paintFrame = 0
        paint()
      })
    }

    /** Cancel a pending coalesced repaint (plugin unload). */
    function cancelScheduledPaint() {
      if (paintFrame === 0) return
      window.cancelAnimationFrame(paintFrame)
      paintFrame = 0
    }

    /**
     * The frosted pane always covers the WHOLE window.
     *
     * There used to be an "Applies to" choice that could confine the pane to the
     * main column or the sidebar. It was removed because a whole-window pane is
     * the only shape that looks right — a partial pane leaves a visible edge
     * running through the title bar — and because it deleted a whole class of
     * bugs: the pane no longer has to be re-measured against the layout, so it
     * can never lag behind a resize or end up misaligned.
     *
     * `inset: 0` also comes from the stylesheet; this only clears any stale box.
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

    /**
     * Undo everything the skin painted, so the shell is exactly as it was.
     *
     * This is the "off" path and it has to be a COMPLETE teardown:
     *
     *   1. drop the active class      -> every skin rule stops matching
     *   2. remove the helper layers   -> nothing is left painted over #root
     *   3. remove the clear rules     -> structural containers get their own
     *                                    backgrounds back
     *   4. clear the inline variables and the wallpaper on <body>
     *
     * Missing any one of these is what made turning the skin off unable to
     * restore the stock look.
     */
    function paintOff(body) {
      const html = document.documentElement
      html.classList.remove(ROOT_CLASS)
      removeLayers()
      clearStructuralContainers()
      for (const name of GLASS_VARIABLES) body.style.removeProperty(name)
      body.style.removeProperty('--dsh-glaze-pane-filter')
      body.style.removeProperty('--dsw-menu-backdrop-filter')
      body.style.removeProperty('background-image')
      body.style.removeProperty('background-size')
      body.style.removeProperty('background-repeat')
      body.style.removeProperty('background-position')
    }

    /** Repaint the skin: wallpaper layers + translucent surfaces + blur. */
    function paint() {
      if (typeof document === 'undefined') return
      const body = document.body
      if (body === null) return
      const settings = runtime.settings
      const on = settings.enabled

      // Disabled is a full teardown, not "paint with zero opacity": the DOM must
      // end up indistinguishable from a session where the plugin never ran.
      if (!on) {
        paintOff(body)
        return
      }

      const { scrim, dim } = ensureLayers()
      const html = document.documentElement
      html.classList.toggle(ROOT_CLASS, on)

      // wallpaper image — painted as the BODY background (see the CSS block for
      // why a z-index:-1 layer cannot be sampled by backdrop-filter).
      const hasImage = on && runtime.image.present
      if (hasImage) {
        const src = runtime.objectUrl ?? routeUrl('dsh-glaze/image', { v: runtime.image.revision })?.href
        if (typeof src === 'string' && src !== '') {
          body.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`
        }
        body.style.backgroundSize =
          settings.fit === 'repeat' ? 'auto' : settings.fit === 'auto' ? 'auto' : settings.fit
        body.style.backgroundRepeat = settings.fit === 'repeat' ? 'repeat' : 'no-repeat'
        body.style.backgroundPosition =
          settings.position === 'top'
            ? 'center top'
            : settings.position === 'bottom'
              ? 'center bottom'
              : settings.position === 'left'
                ? 'left center'
                : settings.position === 'right'
                  ? 'right center'
                  : 'center center'
      } else {
        body.style.removeProperty('background-image')
      }

      // scrim (readability veil between wallpaper and UI)
      if (scrim !== null) {
        // Light themes veil with white, dark themes with black: the veil's job
        // is to flatten the wallpaper toward the palette, not to darken it.
        const dark = body.hasAttribute('data-ds-dark-theme')
        scrim.style.setProperty('--dsh-glaze-scrim-color', dark ? '#000000' : '#ffffff')
        scrim.style.setProperty('--dsh-glaze-scrim-alpha', String(on ? settings.scrim / 100 : 0))
      }

      // dim (extra dark veil, independent of the palette)
      if (dim !== null) {
        dim.style.setProperty('--dsh-glaze-dim-alpha', String(on ? settings.dim / 100 : 0))
        dim.dataset.visible = on && settings.dim > 0 ? 'true' : 'false'
      }

      // Single frosted pane
      //
      // PERF: every value below is ONE custom-property write. The pane resolves
      // itself from these variables, so a slider drag never re-styles
      // individual nodes and never calls getComputedStyle (that per-token pass
      // is what made dragging stutter in v0.2).
      if (on) {
        const colours = palette(body)

        // ── RANGE ────────────────────────────────────────────────────────
        // The pane covers the WHOLE window, including the text, so its fill is
        // the readability control. It has to be translucent enough that the
        // wallpaper — and therefore the blur — is actually visible, otherwise
        // the glass and the blur slider both look dead.
        //
        // 22% .. 92% across the slider's full travel. The previous 62%..94%
        // band was the bug behind "毛玻璃效果不太灵敏": at 62% the wallpaper is
        // almost entirely painted over, so switching the blur on and off made
        // no visible difference and most of the slider's travel did nothing.
        const want = Math.max(0, Math.min(100, settings.opacity)) / 100
        const paneAlpha = 0.22 + want * 0.7

        // Blur is what keeps text legible over a busy wallpaper. The slider
        // keeps its full 0..60 travel; the only guard is the extreme corner
        // (a nearly clear pane needs some blur, or text sits on a sharp photo).
        let blurPx = Math.max(0, Math.min(60, Math.round(settings.blur)))
        if (paneAlpha < 0.35) blurPx = Math.max(blurPx, 16)

        body.style.setProperty('--dsh-glaze-pane-blur', `${blurPx}px`)
        body.style.setProperty('--dsh-glaze-pane-opacity', `${Math.round(paneAlpha * 100)}%`)
        // The composer card + dock must fully hide the scrolling rows behind
        // them, so they stay near-solid regardless of the slider.
        body.style.setProperty('--dsh-glaze-card-opacity', '96%')
        body.style.setProperty('--dsh-glaze-pane-fill', colours.base)
        body.style.setProperty('--dsh-glaze-card-fill', colours.layer)
        body.style.setProperty('--dsh-glaze-dialog-fill', colours.layer)

        // Column divider colour.
        //
        // The shell's own divider is a 12% BLACK hairline. On the light theme
        // that is exactly right (measured 19/255 luminance dip), so it is kept
        // pixel-identical there. On the dark theme the same line lands on dark
        // glass and vanishes (dip 0.03), while the right dock's divider is a
        // LIGHT hairline (+40). Mirroring that here makes the two sides match.
        const isDark = body.hasAttribute('data-ds-dark-theme')
        body.style.setProperty(
          '--dsh-glaze-divider',
          isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(0, 0, 0, 0.12)',
        )

        // FROST TOGGLE.
        //
        // ON  — the pane carries `backdrop-filter` (true frosted glass).
        // OFF — `--dsh-glaze-pane-filter` becomes `none`, so the pane is a flat
        //       translucent tint with no blur pass at all. No filter means no
        //       compositing layer, which removes every seam/banding artifact the
        //       blur could introduce; the wallpaper is simply dimmed by the tint.
        body.style.setProperty('--dsh-glaze-pane-filter', settings.frosted ? '' : 'none')

        layoutGlassPane()
        // Clear the shell's opaque layout containers so the pane is visible
        // through them, and keep converging over the frames where the shell
        // mounts the rest of its chrome.
        watchClear()
        syncClearSheet()
      } else {
        clearStructuralContainers()
      }

      // menu material: menus already carry a backdrop filter; stack our blur
      // onto it so they stay readable over a busy wallpaper.
      if (on && settings.blur > 0) {
        body.style.setProperty('--dsw-menu-backdrop-filter', `blur(${Math.min(60, settings.blur + 22)}px) saturate(150%)`)
      } else {
        body.style.removeProperty('--dsw-menu-backdrop-filter')
      }
    }

    /**
     * Retract every write this plugin owns (plugin unload).
     *
     * Shares the same teardown as switching the skin off, so "unload" and
     * "disable" cannot drift apart.
     */
    function unpaint() {
      if (typeof document === 'undefined') return
      const body = document.body
      if (body !== null) paintOff(body)
    }

    // ------------------------- settings persistence -----------------------

    /** Lazily resolve the shared config form for this plugin's profile entry. */
    function form() {
      if (runtime.form !== null || runtime.formUnavailable) return runtime.form
      try {
        const forms = runtime.ctx?.get?.('configForms')
        if (forms === undefined || forms === null || typeof forms.get !== 'function') {
          runtime.formUnavailable = true
          return null
        }
        runtime.form = forms.get(SETTINGS_ENTRY_ID)
        return runtime.form
      } catch {
        runtime.formUnavailable = true
        return null
      }
    }

    /** Read the accepted Host value into `runtime.settings` (no write). */
    function adoptFromForm() {
      const configForm = form()
      if (configForm === null) return false
      try {
        const snapshot = configForm.getSnapshot()
        if (snapshot?.status !== 'ready') return false
        runtime.settings = normalizeSettings(snapshot.value)
        runtime.settingsAdopted = true
        return true
      } catch {
        return false
      }
    }

    /**
     * Subscribe to the config form and adopt a snapshot as soon as it is usable.
     *
     * The form materializes asynchronously: at boot `getSnapshot().status` is
     * often not 'ready' yet, so a single read on mount silently fails and the
     * plugin paints with DEFAULTS. That is why a persisted preference (most
     * visibly the frosted-glass switch) came back at its default every restart
     * even though the value was correctly stored on disk.
     *
     * Two lines of defence:
     *   1. subscribe to the form so any later "ready" transition is adopted;
     *   2. retry the read a bounded number of times from the boot path, for the
     *      case where the form never emits a change notification of its own.
     *
     * @returns whether a ready snapshot was adopted on this call.
     */
    let detachForm = null

    function attachToForm() {
      const configForm = form()
      if (configForm === null) return false
      if (detachForm === null) {
        try {
          if (typeof configForm.subscribe === 'function') {
            const off = configForm.subscribe(() => {
              if (adoptFromForm()) {
                schedulePaint()
                notify()
              }
            })
            detachForm = typeof off === 'function' ? off : () => {}
          } else {
            detachForm = () => {}
          }
        } catch {
          detachForm = () => {}
        }
      }
      return adoptFromForm()
    }

    /** Stop listening to the config form. */
    function detachFromForm() {
      if (detachForm === null) return
      try {
        detachForm()
      } catch {
        /* already gone */
      }
      detachForm = null
    }

    /**
     * Keep trying to adopt the persisted settings shortly after boot.
     *
     * Gives up after a couple of seconds: if the Host never publishes a ready
     * snapshot the defaults are the only sane answer, and a permanent timer
     * would be worse than a slightly wrong first paint.
     */
    function adoptSoon(attempt = 0) {
      if (runtime.settingsAdopted) return
      if (attachToForm()) {
        runtime.settingsAdopted = true
        schedulePaint()
        return
      }
      if (attempt >= 40) return
      window.setTimeout(() => adoptSoon(attempt + 1), 50)
    }


    /**
     * Persist one field. The Settings page applies it optimistically so the
     * preview is instant; a rejected write is recovered by re-reading the Host.
     */
    async function writeField(field, value) {
      const configForm = form()
      if (configForm === null) return false
      try {
        if (configForm.getSnapshot()?.writable === false) return false
        return await configForm.set(field, value)
      } catch {
        return false
      }
    }

    // ------------------------ wallpaper transport -------------------------

    /** Refresh `runtime.image` from the Host's cheap state route. */
    async function refreshImageState() {
      const url = routeUrl('dsh-glaze/state')
      if (url === null) return
      try {
        const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json()
        const revision = Number(payload?.revision ?? 0)
        const present = payload?.present === true
        if (
          runtime.image.present !== present
          || runtime.image.revision !== revision
          || runtime.image.name !== (payload?.name ?? null)
        ) {
          runtime.image = {
            present,
            revision,
            mime: typeof payload?.mime === 'string' ? payload.mime : null,
            name: typeof payload?.name === 'string' ? payload.name : null,
            bytes: Number(payload?.bytes ?? 0),
          }
          revokeObjectUrl()
          schedulePaint()
          notify()
        }
      } catch {
        /* the wallpaper simply stays as it was */
      }
    }

    /** Drop the object URL created for a locally previewed upload. */
    function revokeObjectUrl() {
      if (runtime.objectUrl !== null) {
        try {
          URL.revokeObjectURL(runtime.objectUrl)
        } catch {
          /* ignore */
        }
        runtime.objectUrl = null
      }
    }

    /**
     * Upload one image File to the Host.
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    async function uploadImage(file) {
      const url = routeUrl('dsh-glaze/upload')
      if (url === null) return { ok: false, error: 'route-unavailable' }
      try {
        const response = await fetch(url.href, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': file.type === '' ? 'application/octet-stream' : file.type,
            'x-dsh-glaze-name': encodeURIComponent(file.name),
          },
          body: file,
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) return { ok: false, error: String(payload?.error ?? `HTTP ${response.status}`) }
        revokeObjectUrl()
        runtime.image = {
          present: payload?.present !== false,
          revision: Number(payload?.revision ?? 0),
          mime: typeof payload?.mime === 'string' ? payload.mime : file.type,
          name: typeof payload?.name === 'string' ? payload.name : file.name,
          bytes: Number(payload?.bytes ?? file.size),
        }
        schedulePaint()
        notify()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    }

    /** Remove the stored wallpaper. */
    async function clearImage() {
      const url = routeUrl('dsh-glaze/image')
      if (url === null) return { ok: false, error: 'route-unavailable' }
      try {
        const response = await fetch(url.href, { method: 'DELETE', credentials: 'same-origin' })
        const payload = await response.json().catch(() => null)
        if (!response.ok) return { ok: false, error: String(payload?.error ?? `HTTP ${response.status}`) }
        revokeObjectUrl()
        runtime.image = { present: false, revision: Number(payload?.revision ?? 0), mime: null, name: null, bytes: 0 }
        paint()
        notify()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    }

    /** Show a locally chosen file immediately (before/while it uploads). */
    function previewLocalFile(file) {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
      revokeObjectUrl()
      runtime.objectUrl = URL.createObjectURL(file)
      runtime.image = { present: true, revision: runtime.image.revision, mime: file.type, name: file.name, bytes: file.size }
      schedulePaint()
      notify()
    }

    // ---------------------------- settings page ---------------------------

    const ZH = {
      nav: '\u5916\u89c2',
      intro: '\u7ed9 DeepSeek Harness \u6362\u4e00\u5f20\u80cc\u666f\u56fe\uff0c\u5e76\u8c03\u8282\u754c\u9762\u7684\u900f\u660e\u7a0b\u5ea6\u3002\u8bbe\u7f6e\u4fdd\u5b58\u5728\u672c\u673a\uff0c\u91cd\u542f\u540e\u4f9d\u7136\u751f\u6548\u3002',
      wallpaper: '\u80cc\u666f\u56fe',
      wallpaperDesc: '\u652f\u6301 PNG\u3001JPEG\u3001WebP\u3001GIF\u3001AVIF\u3001BMP\u3001SVG\uff0c\u6700\u5927 32 MB\u3002\u56fe\u7247\u5b58\u653e\u5728\u672c\u673a\u7684 DSH \u914d\u7f6e\u76ee\u5f55\u91cc\uff0c\u4e0d\u4f1a\u4e0a\u4f20\u5230\u4efb\u4f55\u670d\u52a1\u5668\u3002',
      choose: '\u9009\u62e9\u56fe\u7247\u2026',
      replace: '\u66f4\u6362\u56fe\u7247\u2026',
      remove: '\u79fb\u9664',
      none: '\u5c1a\u672a\u8bbe\u7f6e\u80cc\u666f\u56fe',
      uploading: '\u4e0a\u4f20\u4e2d\u2026',
      uploadFailed: '\u4e0a\u4f20\u5931\u8d25',
      removeFailed: '\u79fb\u9664\u5931\u8d25',
      opacity: '\u754c\u9762\u4e0d\u900f\u660e\u5ea6',
      opacityDesc: '100% \u5b8c\u5168\u4e0d\u900f\u660e\uff08\u539f\u7248\u5916\u89c2\uff09\uff1b\u6570\u503c\u8d8a\u4f4e\uff0c\u80cc\u666f\u56fe\u900f\u8fc7\u754c\u9762\u7684\u7a0b\u5ea6\u8d8a\u9ad8\u3002',
      blur: '\u80cc\u666f\u6a21\u7cca',
      blurDesc: '\u6a21\u7cca\u754c\u9762\u540e\u65b9\u7684\u80cc\u666f\u56fe\uff0c\u51cf\u5c11\u6587\u5b57\u4e0e\u753b\u9762\u7ec6\u8282\u4e92\u76f8\u5e72\u6270\u3002',
      scrim: '\u80cc\u666f\u660e\u6697\u906e\u7f69',
      scrimDesc: '\u5728\u80cc\u666f\u56fe\u4e0e\u754c\u9762\u4e4b\u95f4\u52a0\u4e00\u5c42\u4e0e\u4e3b\u9898\u540c\u8272\u7684\u906e\u7f69\uff0c\u8ba9\u524d\u666f\u6587\u5b57\u66f4\u6613\u8bfb\u3002',
      dim: '\u6574\u4f53\u538b\u6697',
      dimDesc: '\u518d\u53e0\u4e00\u5c42\u6697\u8272\u906e\u7f69\uff0c\u9002\u5408\u4eae\u5ea6\u8f83\u9ad8\u7684\u80cc\u666f\u56fe\u3002',
      fit: '\u586b\u5145\u65b9\u5f0f',
      fitCover: '\u94fa\u6ee1\uff08\u88c1\u526a\uff09',
      fitContain: '\u5b8c\u6574\u663e\u793a\uff08\u7559\u8fb9\uff09',
      fitAuto: '\u539f\u59cb\u5c3a\u5bf8',
      fitRepeat: '\u5e73\u94fa',
      position: '\u5bf9\u9f50\u4f4d\u7f6e',
      posCenter: '\u5c45\u4e2d',
      posTop: '\u9876\u90e8',
      posBottom: '\u5e95\u90e8',
      posLeft: '\u5de6\u4fa7',
      posRight: '\u53f3\u4fa7',
      enabled: '\u542f\u7528\u5916\u89c2',
      enabledDesc: '\u5173\u95ed\u540e\u6062\u590d\u9ed8\u8ba4\u5916\u89c2\uff0c\u4f46\u4fdd\u7559\u5df2\u4fdd\u5b58\u7684\u80cc\u666f\u56fe\u4e0e\u6570\u503c\u3002',
      frosted: '\u6bdb\u73bb\u7483\u6548\u679c',
      frostedDesc: '\u5f00\u542f\u540e\u754c\u9762\u5e95\u5c42\u5e26\u80cc\u666f\u6a21\u7cca\uff08\u771f\u6b63\u7684\u6bdb\u73bb\u7483\uff09\u3002\u5982\u679c\u89c9\u5f97\u754c\u9762\u53d1\u82b1\u3001\u6709\u63a5\u7f1d\u6216\u5361\u987f\uff0c\u5173\u6389\u5b83\u5c31\u53ea\u5269\u534a\u900f\u660e\u5e95\u8272\uff0c\u66f4\u7a33\u5b9a\u4e5f\u66f4\u5feb\u3002',
      preview: '\u5b9e\u65f6\u9884\u89c8',
      previewDesc: '\u7f29\u7565\u663e\u793a\u80cc\u666f\u56fe\u3001\u906e\u7f69\u4e0e\u754c\u9762\u4e0d\u900f\u660e\u5ea6\u7684\u53e0\u52a0\u6548\u679c\u3002',
      previewCard: '\u754c\u9762\u5361\u7247\u9884\u89c8',
      reset: '\u6062\u590d\u9ed8\u8ba4\u503c',
      saveFailed: '\u4fdd\u5b58\u5931\u8d25\uff0c\u5df2\u56de\u9000\u5230\u4e0a\u6b21\u7684\u53d6\u503c',
      defaults: '\u9ed8\u8ba4',
    }
    const EN = {
      nav: 'Glaze',
      intro: 'Give DeepSeek Harness its own background image and tune how much of it shows through the UI. Settings are stored on this machine and survive restarts.',
      wallpaper: 'Background image',
      wallpaperDesc: 'PNG, JPEG, WebP, GIF, AVIF, BMP or SVG, up to 32 MB. The file is stored locally in your DSH config directory and never uploaded anywhere.',
      choose: 'Choose image\u2026',
      replace: 'Replace image\u2026',
      remove: 'Remove',
      none: 'No background image yet',
      uploading: 'Uploading\u2026',
      uploadFailed: 'Upload failed',
      removeFailed: 'Could not remove',
      opacity: 'Interface opacity',
      opacityDesc: '100% is fully opaque (the stock look); lower values let the wallpaper show through the interface.',
      blur: 'Background blur',
      blurDesc: 'Blurs the wallpaper behind the interface so text and image detail do not fight each other.',
      scrim: 'Background veil',
      scrimDesc: 'A veil in the palette colour between the wallpaper and the UI, for readability.',
      dim: 'Overall dim',
      dimDesc: 'An extra dark layer on top; useful for bright wallpapers.',
      fit: 'Fit',
      fitCover: 'Cover (crop)',
      fitContain: 'Contain (letterbox)',
      fitAuto: 'Original size',
      fitRepeat: 'Tile',
      position: 'Position',
      posCenter: 'Center',
      posTop: 'Top',
      posBottom: 'Bottom',
      posLeft: 'Left',
      posRight: 'Right',
      enabled: 'Enable glaze',
      enabledDesc: 'Turn off to restore the default look; your wallpaper and values are kept.',
      frosted: 'Frosted glass',
      frostedDesc: 'Blurs what is behind the interface (real frosted glass). Turn it off to keep a plain translucent tint instead — cheaper, and it cannot show blur seams or banding.',
      preview: 'Live preview',
      previewDesc: 'A thumbnail of the wallpaper, veil and interface opacity stacked together.',
      previewCard: 'Interface card',
      reset: 'Reset to defaults',
      saveFailed: 'Save failed \u2014 reverted to the last accepted value',
      defaults: 'Defaults',
    }

    /**
     * Localized translator that re-renders on locale change.
     * @param ctx - client context (locale service is optional).
     * @returns `t(key)` bound to the active locale.
     */
    function useTranslator(ctx) {
      const [revision, setRevision] = React.useState(0)
      React.useEffect(() => {
        const locale = ctx?.get?.('locale')
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        try {
          return locale.subscribe(() => setRevision((value) => value + 1))
        } catch {
          return undefined
        }
      }, [ctx])
      return React.useMemo(() => {
        let active = 'zh'
        try {
          active = ctx?.get?.('locale')?.getSnapshot?.()?.active ?? 'zh'
        } catch {
          active = 'zh'
        }
        const dict = active === 'en' ? EN : ZH
        void revision
        return (key) => dict[key] ?? ZH[key] ?? key
      }, [ctx, revision])
    }

    /** One labelled row: title/description on the left, control on the right. */
    function Row({ title, desc, children }) {
      return h(
        'div',
        { className: 'dsh-glaze-row' },
        h(
          'div',
          { className: 'dsh-glaze-rowText' },
          h('div', { className: 'dsh-glaze-title' }, title),
          desc !== undefined ? h('div', { className: 'dsh-glaze-desc' }, desc) : null,
        ),
        h('div', { className: 'dsh-glaze-control' }, children),
      )
    }

    /** A 0..max slider with a numeric readout. */
    function Slider({ value, min, max, step, suffix, onChange, ariaLabel }) {
      return h(
        'div',
        { className: 'dsh-glaze-control' },
        h('input', {
          className: 'dsh-glaze-slider',
          type: 'range',
          min,
          max,
          step: step ?? 1,
          value,
          'aria-label': ariaLabel,
          onChange: (event) => onChange(Number(event.currentTarget.value)),
        }),
        h('span', { className: 'dsh-glaze-number' }, `${Math.round(value)}${suffix ?? ''}`),
      )
    }

    /** A labelled `<select>`. */
    function Select({ value, options, onChange, ariaLabel }) {
      return h(
        'select',
        {
          className: 'dsh-glaze-select',
          value,
          'aria-label': ariaLabel,
          onChange: (event) => onChange(event.currentTarget.value),
        },
        options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
      )
    }

    /** A switch in the shell's visual language. */
    function Switch({ checked, onChange, ariaLabel }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-glaze-switch',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': ariaLabel,
          onClick: () => onChange(!checked),
        },
        h('span', null),
      )
    }

    /**
     * The Settings -> Skin page. Owns a local copy of the settings so every
     * control responds instantly; each change repaints immediately and persists
     * in the background (a rejected write snaps back to the accepted value).
     */
    function SkinSection(props) {
      const ctx = runtime.ctx
      const t = useTranslator(ctx)
      const [settings, setSettings] = React.useState(() => runtime.settings)
      const [image, setImage] = React.useState(() => runtime.image)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const fileRef = React.useRef(null)
      /** Pending debounced Host write (only the settled slider value persists). */
      const commitTimer = React.useRef(0)
      const [, bump] = React.useReducer((n) => n + 1, 0)

      // Mirror runtime changes (another surface, a Host echo) into this page.
      React.useEffect(() => {
        const listener = () => {
          setImage(runtime.image)
          setSettings(runtime.settings)
        }
        runtime.listeners.add(listener)
        return () => {
          runtime.listeners.delete(listener)
        }
      }, [])

      // Adopt the Host's accepted values once they arrive.
      React.useEffect(() => {
        const configForm = form()
        if (configForm === null) return undefined
        const adopt = () => {
          if (adoptFromForm()) {
            setSettings(runtime.settings)
            schedulePaint()
            bump()
          }
        }
        adopt()
        let unsubscribe = () => {}
        try {
          unsubscribe = configForm.subscribe(adopt)
        } catch {
          /* subscribe is best-effort */
        }
        return () => {
          try {
            unsubscribe()
          } catch {
            /* ignore */
          }
        }
      }, [])

      // Refresh the wallpaper state when the page opens.
      React.useEffect(() => {
        void refreshImageState()
      }, [])

      // Clear a pending debounced write when the page unmounts (closing
      // Settings right after a drag must not leave a timer running).
      React.useEffect(
        () => () => {
          if (commitTimer.current !== 0) {
            window.clearTimeout(commitTimer.current)
            commitTimer.current = 0
          }
        },
        [],
      )

      /**
       * Apply one field: optimistic paint, then persist.
       *
       * Two throttles make dragging smooth:
       *  - `paint()` is coalesced into one call per animation frame, so a burst
       *    of `input` events costs one layout pass, not one per event.
       *  - the Host write is debounced (only the settled value is persisted),
       *    so dragging does not queue 100 settings mutations behind the UI.
       */
      const update = React.useCallback(
        (field, value) => {
          setSettings((previous) => {
            const next = normalizeSettings({ ...previous, [field]: value })
            runtime.settings = next
            schedulePaint()
            return next
          })
          // Persist the SETTLED value only; a slider drag emits dozens of
          // intermediate values and each one is an RPC round trip.
          if (commitTimer.current !== 0) window.clearTimeout(commitTimer.current)
          commitTimer.current = window.setTimeout(() => {
            commitTimer.current = 0
            void writeField(field, value).then((ok) => {
              if (ok) {
                setError('')
                return
              }
              if (adoptFromForm()) {
                setSettings(runtime.settings)
                schedulePaint()
              }
              setError(t('saveFailed'))
            })
          }, 120)
        },
        [t],
      )

      /** Revert every field to the schema defaults. */
      const reset = React.useCallback(() => {
        for (const [field, value] of Object.entries(DEFAULTS)) update(field, value)
      }, [update])

      /** Handle a picked file: instant preview, then upload. */
      const onPick = React.useCallback(
        async (file) => {
          if (file === undefined || file === null) return
          setError('')
          if (file.size > 32 * 1024 * 1024) {
            setError(`${t('uploadFailed')}: 32 MB`)
            return
          }
          setBusy(true)
          previewLocalFile(file)
          setImage(runtime.image)
          const result = await uploadImage(file)
          setBusy(false)
          if (!result.ok) {
            setError(`${t('uploadFailed')}: ${result.error}`)
            await refreshImageState()
          }
          setImage(runtime.image)
          bump()
        },
        [t],
      )

      /** Remove the stored wallpaper. */
      const onClear = React.useCallback(async () => {
        setBusy(true)
        const result = await clearImage()
        setBusy(false)
        if (!result.ok) setError(`${t('removeFailed')}: ${result.error}`)
        setImage(runtime.image)
        bump()
      }, [t])

      const previewSrc = runtime.objectUrl ?? routeUrl('dsh-glaze/image', { v: image.revision })?.href ?? ''
      const showPreviewImage = image.present && previewSrc !== ''
      const scrimAlpha = settings.scrim / 100
      const cardAlpha = Math.max(0.06, Math.min(1, settings.opacity / 100))
      void props

      return h(
        'div',
        { className: 'dsh-glaze-page' },
        h('p', { className: 'dsh-glaze-desc', style: { margin: '0 0 4px' } }, t('intro')),

        error !== ''
          ? h('div', { className: 'dsh-glaze-errorRow' }, h('p', { className: 'dsh-glaze-hint dsh-glaze-error' }, error))
          : null,

        h(Row, {
          title: t('enabled'),
          desc: t('enabledDesc'),
          children: h(Switch, {
            checked: settings.enabled,
            ariaLabel: t('enabled'),
            onChange: (value) => update(FIELDS.enabled, value),
          }),
        }),

        h(Row, {
          title: t('frosted'),
          desc: t('frostedDesc'),
          children: h(Switch, {
            checked: settings.frosted,
            ariaLabel: t('frosted'),
            onChange: (value) => update(FIELDS.frosted, value),
          }),
        }),

        h(
          Row,
          { title: t('wallpaper'), desc: t('wallpaperDesc') },
          h(
            'div',
            { className: 'dsh-glaze-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-glaze-btn',
                'data-variant': 'primary',
                disabled: busy,
                onClick: () => fileRef.current?.click(),
              },
              busy ? t('uploading') : image.present ? t('replace') : t('choose'),
            ),
            image.present
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-glaze-btn',
                    'data-variant': 'danger',
                    disabled: busy,
                    onClick: () => void onClear(),
                  },
                  t('remove'),
                )
              : null,
          ),
        ),
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/svg+xml',
          className: 'dsh-glaze-sr',
          'aria-label': t('wallpaper'),
          onChange: (event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void onPick(file)
          },
        }),
        h(
          'p',
          { className: 'dsh-glaze-hint' },
          image.present
            ? `${image.name ?? ''}${image.bytes > 0 ? ` \u00b7 ${(image.bytes / 1024).toFixed(0)} KB` : ''}`
            : t('none'),
        ),

        h(
          Row,
          { title: t('preview'), desc: t('previewDesc') },
          h(
            'div',
            { className: 'dsh-glaze-preview' },
            showPreviewImage
              ? h('img', { src: previewSrc, alt: '' })
              : h('span', { className: 'dsh-glaze-previewEmpty' }, t('none')),
            h('div', {
              className: 'dsh-glaze-previewScrim',
              style: { opacity: String(settings.enabled ? scrimAlpha : 0) },
            }),
            h(
              'div',
              {
                className: 'dsh-glaze-previewCard',
                style: { opacity: String(settings.enabled ? cardAlpha : 1) },
              },
              t('previewCard'),
            ),
          ),
        ),

        h(Row, {
          title: t('opacity'),
          desc: t('opacityDesc'),
          children: h(Slider, {
            value: settings.opacity,
            min: 0,
            max: 100,
            suffix: '%',
            ariaLabel: t('opacity'),
            onChange: (value) => update(FIELDS.opacity, value),
          }),
        }),

        h(Row, {
          title: t('blur'),
          desc: t('blurDesc'),
          children: h(Slider, {
            value: settings.blur,
            min: 0,
            max: 60,
            suffix: 'px',
            ariaLabel: t('blur'),
            onChange: (value) => update(FIELDS.blur, value),
          }),
        }),

        h(Row, {
          title: t('scrim'),
          desc: t('scrimDesc'),
          children: h(Slider, {
            value: settings.scrim,
            min: 0,
            max: 100,
            suffix: '%',
            ariaLabel: t('scrim'),
            onChange: (value) => update(FIELDS.scrim, value),
          }),
        }),

        h(Row, {
          title: t('dim'),
          desc: t('dimDesc'),
          children: h(Slider, {
            value: settings.dim,
            min: 0,
            max: 100,
            suffix: '%',
            ariaLabel: t('dim'),
            onChange: (value) => update(FIELDS.dim, value),
          }),
        }),

        h(Row, {
          title: t('fit'),
          children: h(Select, {
            value: settings.fit,
            ariaLabel: t('fit'),
            options: [
              { value: 'cover', label: t('fitCover') },
              { value: 'contain', label: t('fitContain') },
              { value: 'auto', label: t('fitAuto') },
              { value: 'repeat', label: t('fitRepeat') },
            ],
            onChange: (value) => update(FIELDS.fit, value),
          }),
        }),

        h(Row, {
          title: t('position'),
          children: h(Select, {
            value: settings.position,
            ariaLabel: t('position'),
            options: [
              { value: 'center', label: t('posCenter') },
              { value: 'top', label: t('posTop') },
              { value: 'bottom', label: t('posBottom') },
              { value: 'left', label: t('posLeft') },
              { value: 'right', label: t('posRight') },
            ],
            onChange: (value) => update(FIELDS.position, value),
          }),
        }),

        h(
          'div',
          { className: 'dsh-glaze-row' },
          h(
            'div',
            { className: 'dsh-glaze-rowText' },
            h('div', { className: 'dsh-glaze-title' }, t('defaults')),
            h('div', { className: 'dsh-glaze-desc' }, `${DEFAULTS.opacity}% \u00b7 ${DEFAULTS.blur}px \u00b7 ${DEFAULTS.scrim}%`),
          ),
          h(
            'div',
            { className: 'dsh-glaze-actions' },
            h('button', { type: 'button', className: 'dsh-glaze-btn', onClick: () => reset() }, t('reset')),
          ),
        ),
      )
    }

    // ------------------------------- plugin -------------------------------

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        runtime.ctx = ctx
        runtime.routeBase = resolveRouteBase()
        installStyles(ctx)

        let t = (key) => key
        try {
          ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN }), 'dsh-glaze: locale')
          t = ctx.locale.bind(LOCALE_NS)
        } catch {
          /* locale is optional for painting */
        }

        // paint lifecycle
        ctx.effect(() => {
          const boot = () => {
            // NOT a single read: the config form is often not ready yet at
            // mount, and a silent failure here is what made a persisted
            // preference (the frosted switch) spring back to its default on
            // every restart.
            adoptSoon()
            paint()
            void refreshImageState()
          }
          let offDomContentLoaded = () => {}
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true })
            offDomContentLoaded = () => document.removeEventListener('DOMContentLoaded', boot)
          } else {
            boot()
          }

          // The theme presenter rewrites the alias tokens as body inline styles
          // on every palette change; drop our cached raw values first, otherwise
          // a light->dark switch would keep re-wrapping the old light colours.
          ctx.on('theme/change', () => {
            invalidatePalette()
            queueMicrotask(paint)
          })

          // The Host pushes settings-document updates; adopt the accepted value
          // and repaint (another window may have changed it).
          let offRemote
          try {
            const remote = ctx.get('remote')
            offRemote = remote?.$on?.('settings/document-updated', () => {
              if (adoptFromForm()) {
                schedulePaint()
                notify()
              } else {
                queueMicrotask(paint)
              }
            })
          } catch {
            offRemote = undefined
          }

          // Poll the wallpaper revision: cheap (a 60-byte JSON), and it is how a
          // second window notices a replaced image without a reload.
          const timer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') void refreshImageState()
          }, 4000)

          return () => {
            window.clearInterval(timer)
            offDomContentLoaded()
            if (typeof offRemote === 'function') offRemote()
            cancelScheduledPaint()
            detachFromForm()
            unpaint()
            revokeObjectUrl()
          }
        }, 'dsh-glaze: paint')

        // settings page
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-glaze',
              order: 200,
              label: () => t('nav'),
              locale: LOCALE_NS,
            },
            SkinSection,
          ),
        )
      },
    }
  },
})
