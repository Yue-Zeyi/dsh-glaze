"""
Generate the wallpapers used for the article's screenshots.

They have to look like something a reader would actually set as a wallpaper, and
they have to be safe to publish — the wallpaper currently installed on the
author's machine is a personal photo, so it is deliberately not reused here.

Design notes
  * The point of the screenshots is to show FROSTED GLASS, so the wallpaper needs
    visible colour variation: large soft colour fields, clear hue changes, and
    some structure for the blur to actually destroy. A near-white gradient looks
    washed out and proves nothing.
  * `mesh` stays light so it reads well under the light theme; `dusk` is deep so
    the dark theme has something to glow against.

Run with the bundled Python:
  <python> tools/article/make-wallpapers.py
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1200


def mesh_gradient(colors, seed, blur, base_color=None) -> Image.Image:
    """Composite large blurred colour fields, brightest-first, into a mesh."""
    rng = random.Random(seed)
    base = Image.new("RGB", (W, H), base_color or colors[0])
    # paint from darkest to brightest so highlights end up on top
    ordered = sorted(colors[1:], key=sum, reverse=False)
    for color in ordered:
        layer = Image.new("RGB", (W, H), color)
        mask = Image.new("L", (W, H), 0)
        draw = ImageDraw.Draw(mask)
        # a couple of overlapping ellipses per colour gives an organic edge
        for _ in range(2):
            cx = rng.randint(-300, W + 300)
            cy = rng.randint(-300, H + 300)
            rx = rng.randint(360, 900)
            ry = rng.randint(300, 760)
            draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
        base = Image.composite(layer, base, mask)
    return base


def add_structure(img: Image.Image, rings: int = 5) -> Image.Image:
    """Faint concentric arcs: fine detail for the blur to visibly obliterate."""
    layer = img.copy()
    draw = ImageDraw.Draw(layer)
    cx, cy = int(W * 0.78), int(H * 0.18)
    for i in range(rings):
        r = 150 + i * 120
        draw.arc((cx - r, cy - r, cx + r, cy + r), start=20, end=250, fill=(255, 255, 255, 40), width=3)
    return Image.blend(img, layer, 0.5)


def bloom(img: Image.Image, center, radius, strength, color=(255, 240, 214)) -> Image.Image:
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = int(center[0] * W), int(center[1] * H)
    r = int(radius * W)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=strength)
    mask = mask.filter(ImageFilter.GaussianBlur(int(r * 0.5)))
    return Image.composite(Image.new("RGB", (W, H), color), img, mask)


def grain(img: Image.Image, strength: int = 5) -> Image.Image:
    """A little noise keeps large flat gradients from banding."""
    rng = random.Random(7)
    px = img.load()
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            n = rng.randint(-strength, strength)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return img


# ── light theme: warm-cool mesh, clearly coloured but still airy ───────────
mesh = mesh_gradient(
    [
        (196, 214, 236),
        (108, 152, 214),
        (232, 138, 162),
        (120, 196, 178),
        (246, 190, 120),
        (168, 148, 222),
    ],
    seed=11,
    blur=210,
)
mesh = bloom(mesh, center=(0.74, 0.2), radius=0.34, strength=60)
mesh = add_structure(mesh)
grain(mesh).save(OUT / "wallpaper-mesh.png", optimize=True)
print("wallpaper-mesh.png")

# ── dark theme: deep dusk with a warm bloom ────────────────────────────────
dusk = mesh_gradient(
    [
        (16, 18, 30),
        (42, 30, 68),
        (22, 54, 82),
        (86, 34, 62),
        (12, 16, 26),
        (58, 46, 104),
    ],
    seed=23,
    blur=230,
)
dusk = bloom(dusk, center=(0.74, 0.18), radius=0.3, strength=120)
dusk = add_structure(dusk, rings=4)
grain(dusk, 4).save(OUT / "wallpaper-dusk.png", optimize=True)
print("wallpaper-dusk.png")
