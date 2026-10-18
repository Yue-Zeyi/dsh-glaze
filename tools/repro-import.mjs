/**
 * Reproduce the module-loader failure and pin it to a file line.
 *
 * The browser reported `dsh-glaze: import failed: data is not defined`, so the
 * factory throws while materializing. V8 reports the line inside the evaluated
 * function, which does not match the source file directly — this script maps it
 * back by evaluating with an offset.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')

// Minimal React stand-in: enough for the factory body to reach the throw.
const react = {
  createElement: () => ({}),
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useReducer: (reducer, initial) => [initial, () => {}],
}
const fakeRequire = () => react

let captured
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      try {
        spec.factory(fakeRequire)
        console.log('factory OK')
      } catch (error) {
        captured = error
      }
    },
  },
}

new Function('window', src)(globalThis.window)

if (captured === undefined) {
  process.exit(0)
}

console.log('ERROR:', captured.message)

// V8 gives `<anonymous>:LINE:COL` for the evaluated function. The function body
// starts right after `factory(require) {`, so subtract that prefix.
const match = /<anonymous>:(\d+):(\d+)/.exec(captured.stack ?? '')
if (match !== null) {
  const evalLine = Number(match[1])
  const prefixLine = src.slice(0, src.indexOf('factory(require) {')).split('\n').length
  const fileLine = prefixLine + evalLine - 1
  const lines = src.split('\n')
  console.log(`approx file line: ${fileLine}`)
  for (let i = Math.max(0, fileLine - 4); i < Math.min(lines.length, fileLine + 3); i += 1) {
    console.log(`${i + 1}: ${lines[i]}`)
  }
}
