"""
Turn the raw captures into article-ready figures.

What this does
  1. downscale the 2x captures to a sensible width (the raw ones are 2880px wide,
     which is far more than a WeChat article needs and makes the uploads heavy);
  2. build a labelled side-by-side figure for the frosted-glass on/off pair —
     that comparison is the whole point of the article, and two full screenshots
     stacked makes the reader hunt for the difference;
  3. build the cover image (WeChat recommends 2.35:1 for the shared card).

Run:  <python> tools/article/compose-figures.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = Path(__file__).resolve().parent / "raw"
IMAGES = Path(__file__).resolve().parents[2] / "docs/article/images"
WIDTH = 1800                      # article body image width
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def load(name: str) -> Image.Image:
    return Image.open(SRC / name).convert("RGB")


def downscale(img: Image.Image, width: int = WIDTH) -> Image.Image:
    if img.width <= width:
        return img
    height = round(img.height * width / img.width)
    return img.resize((width, height), Image.LANCZOS)


# ── 1. plain downscales ────────────────────────────────────────────────────
PLAIN = {
    "01-hero-light.png": "fig-01-light.png",
    "04-hero-dark.png": "fig-02-dark.png",
    "05-settings.png": "fig-03-settings.png",
    "06-disabled-stock.png": "fig-04-stock.png",
}
for src, dst in PLAIN.items():
    downscale(load(src)).save(IMAGES / dst, optimize=True)
    print(dst)

# ── 2. frosted on/off comparison ───────────────────────────────────────────
# Crop the same region from both frames: the main panel, where the wallpaper's
# concentric arcs are. Blur destroys those arcs, so the pair reads instantly.
# The left edge starts inside the main panel so the composer card stays whole.
CROP = (1050, 120, 2880, 1520)          # left, top, right, bottom (2x pixels)
LABEL_H = 96
GAP = 24

pairs = []
for name in ("03-frost-off.png", "02-frost-on.png"):
    img = load(name).crop(CROP)
    pairs.append(img.resize((900, round(img.height * 900 / img.width)), Image.LANCZOS))

w = pairs[0].width * 2 + GAP
h = pairs[0].height + LABEL_H
canvas = Image.new("RGB", (w, h), (250, 250, 252))
canvas.paste(pairs[0], (0, LABEL_H))
canvas.paste(pairs[1], (pairs[0].width + GAP, LABEL_H))

draw = ImageDraw.Draw(canvas)
draw.text((6, 26), "关闭毛玻璃", font=font(46), fill=(70, 70, 78))
draw.text((pairs[0].width + GAP + 6, 26), "开启毛玻璃", font=font(46), fill=(31, 90, 200))
canvas.save(IMAGES / "fig-05-compare.png", optimize=True)
print("fig-05-compare.png", canvas.size)

# ── 3. cover ───────────────────────────────────────────────────────────────
# 2.35:1 is what WeChat uses for the shared-card crop.
#
# The background is the WALLPAPER itself, not a screenshot: every screenshot
# carries the app's own text (the hero title, placeholder copy), and any title
# laid over it collides with that text. The wallpaper is clean, is literally what
# the plugin puts behind the UI, and reads well under a dark scrim.
COVER_W, COVER_H = 1410, 600
wall = Image.open(Path(__file__).resolve().parent / "assets/wallpaper-mesh.png").convert("RGB")
target_ratio = COVER_W / COVER_H
wall_ratio = wall.width / wall.height
if wall_ratio > target_ratio:
    new_w = round(wall.height * target_ratio)
    left = (wall.width - new_w) // 2
    band = wall.crop((left, 0, left + new_w, wall.height))
else:
    new_h = round(wall.width / target_ratio)
    top = (wall.height - new_h) // 2
    band = wall.crop((0, top, wall.width, top + new_h))
band = band.resize((COVER_W, COVER_H), Image.LANCZOS)

# Dark scrim, strongest on the left where the type sits, fading to the right so
# the wallpaper's colour still shows.
scrim = Image.new("L", (COVER_W, COVER_H), 0)
sd = ImageDraw.Draw(scrim)
for x in range(COVER_W):
    t = x / COVER_W
    sd.line([(x, 0), (x, COVER_H)], fill=int(212 * max(0.0, 1 - t * 1.18) ** 0.85))
scrim = scrim.filter(ImageFilter.GaussianBlur(24))
cover = Image.composite(Image.new("RGB", (COVER_W, COVER_H), (14, 16, 28)), band, scrim)

cd = ImageDraw.Draw(cover)
cd.text((78, 104), "dsh-glaze", font=font(106), fill=(255, 255, 255))
cd.text((82, 246), "给你的 DeepSeek Harness", font=font(47), fill=(240, 242, 250))
cd.text((82, 304), "上一层玻璃釉", font=font(47), fill=(156, 200, 255))
cd.text((84, 392), "自定义壁纸  ·  真毛玻璃  ·  开源 MIT", font=font(30), fill=(202, 208, 226))
# The hook of the story: this plugin was built by Harness itself, on V4.1-Flash.
cd.text((84, 458), "用 DeepSeek Harness × DeepSeek-V4.1-Flash 写成", font=font(27), fill=(255, 214, 160))
cover.save(IMAGES / "cover.png", optimize=True)
print("cover.png", cover.size)

# the temporary full-page grab is not used by the article
tmp = IMAGES / "_tmp-dark-full.png"
if tmp.exists():
    tmp.unlink()
    print("removed _tmp-dark-full.png")
