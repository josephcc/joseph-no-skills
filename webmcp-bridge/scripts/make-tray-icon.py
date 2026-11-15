#!/usr/bin/env python3
"""Draws plugin/daemon/tray/webmcp-bridge-icon.png, the menu bar glyph: a small bridge (two piers, a deck, an arch)
as a macOS template image, black shape with alpha only, 72×72 px (shown at 18×18 pt by the tray helper, so 4× for
Retina headroom). As a template image the menu bar colours it itself: white on a dark menu bar, black on a light one.
Drawn from nothing, so the file carries no branding. Needs Pillow:  python3 -I scripts/make-tray-icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

SIZE, SCALE = 72, 4
S = SIZE * SCALE
dst = Path(__file__).resolve().parent.parent / 'plugin' / 'daemon' / 'tray' / 'webmcp-bridge-icon.png'
im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
ink = (0, 0, 0, 255)
u = S / 72   # one source pixel
# the arch: the top half of an ellipse spanning the width, its crown near the top
d.arc([8 * u, 16 * u, 64 * u, 92 * u], start=180, end=360, fill=ink, width=int(7 * u))
# the deck across the arch's springing line
d.rectangle([4 * u, 42 * u, 68 * u, 48 * u], fill=ink)
# two piers down from the deck
d.rectangle([17 * u, 48 * u, 24 * u, 64 * u], fill=ink)
d.rectangle([48 * u, 48 * u, 55 * u, 64 * u], fill=ink)
im = im.resize((SIZE, SIZE), Image.LANCZOS)
dst.parent.mkdir(parents=True, exist_ok=True)
im.save(dst)
print(f'wrote {dst} ({SIZE}×{SIZE})')
