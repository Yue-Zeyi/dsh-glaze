/**
 * Find template-literal delimiters that unbalance the big CSS template in
 * plugin/client.js. A stray backtick inside a CSS comment terminates the string
 * early and the rest of the stylesheet is then parsed as JavaScript (that is
 * what produced the runtime `data is not defined`).
 *
 * Run:  node tools/find-backticks.mjs
 */
import { readFileSync } from 'node:fs'

const lines = readFileSync(new URL('../client.js', import.meta.url), 'utf8').split('\n')

const start = lines.findIndex((line) => line.includes('const CSS = '))
if (start === -1) {
  console.log('CSS template not found')
  process.exit(1)
}
console.log(`CSS template opens at line ${start + 1}`)

// Everything from the opening line to the first line that closes it should be
// pure CSS. Report every backtick, since only the final one is legitimate.
for (let i = start; i < lines.length; i += 1) {
  if (!lines[i].includes('`')) continue
  const marker = i === start ? ' (opening line)' : ''
  console.log(`line ${i + 1}${marker}: ${lines[i].trim().slice(0, 120)}`)
  if (i > start) {
    // The first backtick after the opening line is where the string ENDS.
    console.log('  ^ first candidate terminator — everything after it is parsed as JS')
    break
  }
}
