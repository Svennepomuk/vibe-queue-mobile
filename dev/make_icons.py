"""Draws the home-screen icons (PNG) from the same shapes as icons/icon.svg. Needs numpy only.

python dev/make_icons.py
"""

import struct
import zlib
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = np.array([0x12, 0x12, 0x12], float)
GREEN = np.array([0x1E, 0xD7, 0x60], float)
BLACK = np.array([0, 0, 0], float)

# The glyph in a 16x16 box: three list bars and two sparkles.
BARS = [(1, 4, 9, 5.5), (1, 7.75, 9, 9.25), (1, 11.5, 6.5, 13)]
SPARKLES = [
    [(12.5, 1.25), (13.45, 3.55), (15.75, 4.5), (13.45, 5.45), (12.5, 7.75), (11.55, 5.45), (9.25, 4.5), (11.55, 3.55)],
    [(12.5, 9.25), (13.1, 10.65), (14.5, 11.25), (13.1, 11.85), (12.5, 13.25), (11.9, 11.85), (10.5, 11.25), (11.9, 10.65)],
]
GLYPH_CENTER = (8.375, 7.25)


def inside_polygon(x, y, poly):
    inside = np.zeros(x.shape, bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cross = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        inside ^= cross
        j = i
    return inside


def glyph_mask(x, y, cx, cy, scale):
    gx = (x - cx) / scale + GLYPH_CENTER[0]
    gy = (y - cy) / scale + GLYPH_CENTER[1]
    m = np.zeros(x.shape, bool)
    for x0, y0, x1, y1 in BARS:
        m |= (gx >= x0) & (gx <= x1) & (gy >= y0) & (gy <= y1)
    for poly in SPARKLES:
        m |= inside_polygon(gx, gy, poly)
    return m


def render(size, maskable):
    ss = 4
    n = size * ss
    coords = (np.arange(n) + 0.5) / ss
    x, y = np.meshgrid(coords, coords)
    c = size / 2
    rgb = np.zeros((n, n, 3))
    alpha = np.ones((n, n))
    if maskable:
        # Full-bleed green; the glyph stays inside the central safe circle.
        rgb[:] = GREEN
        glyph = glyph_mask(x, y, c, c, size * 0.50 / 16)
    else:
        r = size * 0.22  # rounded square
        dx = np.maximum(np.abs(x - c) - (c - r), 0)
        dy = np.maximum(np.abs(y - c) - (c - r), 0)
        square = dx * dx + dy * dy <= r * r
        alpha = square.astype(float)
        rgb[:] = BG
        circle = (x - c) ** 2 + (y - c) ** 2 <= (size * 0.39) ** 2
        rgb[circle] = GREEN
        glyph = glyph_mask(x, y, c, c, size * 0.45 / 16)
    rgb[glyph] = BLACK
    # average each ss x ss block
    rgb = rgb.reshape(size, ss, size, ss, 3).mean(axis=(1, 3))
    alpha = alpha.reshape(size, ss, size, ss).mean(axis=(1, 3))
    out = np.dstack([rgb, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    return out


def write_png(path, img):
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[row].tobytes() for row in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "icon-192.png", render(192, False))
    write_png(OUT / "icon-512.png", render(512, False))
    write_png(OUT / "icon-maskable-512.png", render(512, True))
    print("icons written to", OUT)
