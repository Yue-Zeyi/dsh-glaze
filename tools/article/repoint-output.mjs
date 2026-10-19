/**
 * Point the article tooling at docs/article/images.
 *
 * The generators originally wrote into tools/article/images. The article and its
 * images are a deliverable, so they live under docs/; only the generators stay
 * in tools/.
 *
 * Run:  node tools/article/repoint-output.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)

const EDITS = [
  [
    'tools/article/make-wallpapers.py',
    'OUT = Path(__file__).resolve().parent / "images"',
    'OUT = Path(__file__).resolve().parents[2] / "docs/article/images"',
  ],
  [
    'tools/article/compose-figures.py',
    'IMAGES = Path(__file__).resolve().parent / "images"',
    'IMAGES = Path(__file__).resolve().parents[2] / "docs/article/images"',
  ],
  [
    'tools/article/capture-article-shots.cjs',
    "const OUT = path.join(ROOT, 'tools/article/images')",
    "const OUT = path.join(ROOT, 'docs/article/images')",
  ],
]

for (const [file, from, to] of EDITS) {
  const url = new URL(file, ROOT)
  const text = readFileSync(url, 'utf8')
  if (!text.includes(from)) {
    console.log(`skip (already updated or no match): ${file}`)
    continue
  }
  writeFileSync(url, text.split(from).join(to), 'utf8')
  console.log(`updated ${file}`)
}
