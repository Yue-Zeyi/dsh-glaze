/**
 * Give the article pipeline three clearly separated directories.
 *
 *   tools/article/assets/  generated wallpapers  (inputs to the capture run)
 *   tools/article/raw/     2x screenshots straight from the browser (ignored by git)
 *   docs/article/images/   the finished figures + cover (the deliverable)
 *
 * Keeping raw captures out of docs/ stops a 2 MB debug PNG from being treated as
 * a published asset, and lets the pipeline be re-run end to end.
 *
 * Run:  node tools/article/layout-path-fix.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)

function patch(file, pairs) {
  const url = new URL(file, ROOT)
  let text = readFileSync(url, 'utf8')
  let touched = 0
  for (const [from, to] of pairs) {
    if (!text.includes(from)) continue
    text = text.split(from).join(to)
    touched += 1
  }
  if (touched > 0) writeFileSync(url, text, 'utf8')
  console.log(`${file}: ${touched} replacement(s)`)
}

patch('tools/article/make-wallpapers.py', [
  ['OUT = Path(__file__).resolve().parents[2] / "docs/article/images"', 'OUT = Path(__file__).resolve().parent / "assets"'],
])

patch('tools/article/compose-figures.py', [
  ['IMAGES = Path(__file__).resolve().parents[2] / "docs/article/images"', 'SRC = Path(__file__).resolve().parent / "raw"\nIMAGES = Path(__file__).resolve().parents[2] / "docs/article/images"'],
  ['def load(name: str) -> Image.Image:\n    return Image.open(IMAGES / name).convert("RGB")', 'def load(name: str) -> Image.Image:\n    return Image.open(SRC / name).convert("RGB")'],
  ['wall = load("wallpaper-mesh.png")', 'wall = Image.open(Path(__file__).resolve().parent / "assets/wallpaper-mesh.png").convert("RGB")'],
])

patch('tools/article/capture-article-shots.cjs', [
  ["const OUT = path.join(ROOT, 'docs/article/images')", "const ASSETS = path.join(ROOT, 'tools/article/assets')\nconst OUT = path.join(ROOT, 'tools/article/raw')"],
  ["const b64 = fs.readFileSync(path.join(OUT, file)).toString('base64')", "const b64 = fs.readFileSync(path.join(ASSETS, file)).toString('base64')"],
])
