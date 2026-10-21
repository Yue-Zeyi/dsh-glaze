"""
Measure the two column boundaries in a screenshot of the app.

The user reports a crisp divider between the main area and the right dock but
none between the left sidebar and the main area. Rather than guess at a colour,
this measures the actual pixels: for every column it computes the mean luminance
over a vertical band, then reports where the luminance dips (a divider is a dark
1-2px line) and how strong the dip is.

Run:  <python> tools/measure-dividers.py <screenshot.png> [x1] [x2]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def luma(px: tuple[int, int, int]) -> float:
    r, g, b = px
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def column_means(img: Image.Image, y0: int, y1: int) -> list[float]:
    w, _ = img.size
    px = img.convert("RGB").load()
    out = []
    for x in range(w):
        total = 0.0
        for y in range(y0, y1):
            total += luma(px[x, y])
        out.append(total / (y1 - y0))
    return out


def report(means: list[float], lo: int, hi: int, label: str) -> None:
    lo = max(0, lo)
    hi = min(len(means) - 1, hi)
    best = None
    for x in range(lo, hi + 1):
        neighbours = [means[x - 1], means[x + 1]]
        dip = (sum(neighbours) / 2) - means[x]
        if best is None or dip > best[1]:
            best = (x, dip)
    print(f"\n{label}: strongest dip at x={best[0]}  magnitude={best[1]:.2f} (0-255)")
    print("  x    mean-luma   delta-vs-neighbours")
    for x in range(max(lo, best[0] - 3), min(hi, best[0] + 4) + 1):
        n = (means[x - 1] + means[x + 1]) / 2
        print(f"  {x:4d}  {means[x]:8.2f}   {n - means[x]:+7.2f}")


def main() -> None:
    path = Path(sys.argv[1])
    img = Image.open(path)
    w, h = img.size
    print(f"image: {path.name}  {w}x{h}")

    # sample a tall band that is clear of buttons and text blocks
    y0, y1 = int(h * 0.55), int(h * 0.92)
    means = column_means(img, y0, y1)

    left_edge = int(sys.argv[2]) if len(sys.argv) > 2 else int(w * 0.205)
    right_edge = int(sys.argv[3]) if len(sys.argv) > 3 else int(w * 0.682)

    report(means, left_edge - 14, left_edge + 14, f"left boundary (~x={left_edge})")
    report(means, right_edge - 14, right_edge + 14, f"right boundary (~x={right_edge})")


if __name__ == "__main__":
    main()
