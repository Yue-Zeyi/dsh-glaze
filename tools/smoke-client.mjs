/**
 * Load-time smoke test for plugin/client.js.
 *
 * The browser half is a single `window.__ModuleLoader__.load({...})` call whose
 * factory builds the whole plugin. A syntax-valid file can still fail AT IMPORT
 * TIME — most notably when a stray backtick inside the CSS template terminates
 * the string early and the rest of the stylesheet is parsed as JavaScript. The
 * module loader reports that as `dsh-glaze: import failed: <ReferenceError>` and
 * the whole plugin silently does not activate.
 *
 * `node --check` cannot catch it (the file still parses as valid JS), so this
 * harness runs the factory against a minimal React stand-in instead.
 *
 * Run:  node tools/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const src = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')

// ── 1. the CSS template must close where the stylesheet ends ─────────────────
// Count backticks starting at the opening line and stop at the first closer:
// a well-formed template closes at its FIRST backtick after the opener.
const lines = src.split('\n')
const cssStart = lines.findIndex((line) => line.includes('const CSS = '))
assert.notEqual(cssStart, -1, 'CSS template not found')
let cssEnd = -1
for (let i = cssStart + 1; i < lines.length; i += 1) {
  if (lines[i].includes('`')) {
    cssEnd = i + 1
    break
  }
}
assert.notEqual(cssEnd, -1, 'the CSS template is never closed')
// A closing line that is just a backtick is the real terminator; anything with
// CSS text before the backtick means the string ended inside the stylesheet.
const closer = lines[cssEnd - 1].trim()
assert.equal(closer, '`', `the CSS template closes prematurely at line ${cssEnd} (found: "${closer.slice(0, 60)}")`)

// ── 2. the factory must materialize without throwing ─────────────────────────
const react = {
  createElement: () => ({}),
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useReducer: (reducer, initial) => [initial, () => {}],
}

let exported
let failure
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      assert.equal(spec.id, 'dsh-glaze', 'the loader id must stay dsh-glaze')
      try {
        exported = spec.factory(() => react)
      } catch (error) {
        failure = error
      }
    },
  },
}

// `window` and `document` are the only globals the bundle touches at import /
// apply time; the stand-ins let apply() run far enough to prove the paint
// effect and the settings-section registration are wired.
function makeElement(tag = 'div') {
  const props = new Map()
  return {
    tagName: tag.toUpperCase(),
    style: {
      setProperty: (name, value) => props.set(name, value),
      getPropertyValue: (name) => props.get(name) ?? '',
      removeProperty: (name) => props.delete(name),
    },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    appendChild(child) {
      this.children.push(child)
      return child
    },
    insertBefore(child) {
      this.children.unshift(child)
      return child
    },
    remove() {},
    setAttribute() {},
    removeAttribute() {},
    hasAttribute: () => false,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
}

const documentStub = {
  readyState: 'complete',
  documentElement: makeElement('html'),
  head: makeElement('head'),
  body: makeElement('body'),
  createElement: (tag) => makeElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}

const getComputedStyleStub = () => ({ backgroundColor: '', getPropertyValue: () => '' })
class MutationObserverStub {
  observe() {}
  disconnect() {}
}

fakeWindow.requestAnimationFrame = (fn) => {
  fn()
  return 1
}
fakeWindow.cancelAnimationFrame = () => {}
fakeWindow.setInterval = () => 0
fakeWindow.clearInterval = () => {}
fakeWindow.setTimeout = () => 0
fakeWindow.clearTimeout = () => {}
fakeWindow.getComputedStyle = getComputedStyleStub
fakeWindow.MutationObserver = MutationObserverStub

new Function('window', 'document', 'getComputedStyle', 'MutationObserver', src)(
  fakeWindow,
  documentStub,
  getComputedStyleStub,
  MutationObserverStub,
)

assert.equal(failure, undefined, `factory threw at import time: ${failure?.message}`)
assert.equal(typeof exported, 'object', 'factory must return the plugin object')
assert.equal(typeof exported.apply, 'function', 'plugin must expose apply(ctx)')
assert.ok(Array.isArray(exported.inject), 'plugin must declare inject[]')
for (const service of ['slots', 'locale', 'configForms']) {
  assert.ok(exported.inject.includes(service), `inject must include ${service}`)
}

// ── 3. the mount path must survive a realistic ctx ───────────────────────────
const effects = []
const markup = []
const styleTags = []
const ctx = {
  get(name) {
    if (name === 'configForms') {
      return {
        get: () => ({
          getSnapshot: () => ({ status: 'ready', value: { enabled: true, opacity: 35, blur: 22, scrim: 10 }, writable: true }),
          subscribe: () => () => {},
          set: async () => true,
        }),
      }
    }
    if (name === 'locale') return { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {}, bind: () => (k) => k }
    return undefined
  },
  effect(fn) {
    effects.push(fn)
    return () => {}
  },
  on() {
    return () => {}
  },
  slots: { inject: () => () => {}, register: () => () => {} },
  locale: { register: () => () => {}, bind: () => (k) => k },
}
exported.apply(ctx)

// The paint effect must at least be registered.
assert.ok(effects.length >= 1, 'apply() must register at least one effect')

console.log('smoke-client: OK')
console.log(`  CSS template: lines ${cssStart + 1} -> ${cssEnd}`)
console.log(`  effects registered: ${effects.length}`)
