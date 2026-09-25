"""アプリのアイコン（ホーム画面用）を作る。

  py tools/make_icons.py   → icons/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FELT_IN = (28, 124, 83)
FELT_OUT = (6, 45, 30)
IVORY = (251, 248, 240)
EDGE = (201, 189, 163)
INK = (22, 23, 27)
RED = (179, 20, 31)
GOLD_TOP = (246, 227, 166)
GOLD_BOTTOM = (170, 132, 49)


def felt(s):
    img = Image.new("RGB", (s, s))
    px = img.load()
    cx, cy = s * 0.5, s * 0.42
    rmax = math.hypot(s * 0.5, s * 0.58)
    for y in range(s):
        for x in range(s):
            t = min(1.0, math.hypot(x - cx, y - cy) / rmax)
            t = t ** 1.3
            px[x, y] = tuple(int(FELT_IN[k] + (FELT_OUT[k] - FELT_IN[k]) * t) for k in range(3))
    return img.convert("RGBA")


def spade(d, cx, cy, r, fill):
    # 逆さハート＋軸
    d.ellipse([cx - r * 0.98, cy - r * 0.05, cx - r * 0.02, cy + r * 0.85], fill=fill)
    d.ellipse([cx + r * 0.02, cy - r * 0.05, cx + r * 0.98, cy + r * 0.85], fill=fill)
    d.polygon([(cx - r * 0.93, cy + r * 0.25), (cx, cy - r * 1.0), (cx + r * 0.93, cy + r * 0.25)], fill=fill)
    d.ellipse([cx - r * 0.35, cy, cx + r * 0.35, cy + r * 0.75], fill=fill)
    d.polygon([(cx, cy + r * 0.35), (cx - r * 0.42, cy + r * 1.15), (cx + r * 0.42, cy + r * 1.15)], fill=fill)


def heart(d, cx, cy, r, fill):
    d.ellipse([cx - r * 0.98, cy - r * 0.85, cx - r * 0.02, cy + r * 0.05], fill=fill)
    d.ellipse([cx + r * 0.02, cy - r * 0.85, cx + r * 0.98, cy + r * 0.05], fill=fill)
    d.polygon([(cx - r * 0.93, cy - r * 0.25), (cx, cy + r * 1.0), (cx + r * 0.93, cy - r * 0.25)], fill=fill)


def card(s, w, h, suit):
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0 = (s - w) / 2, (s - h) / 2
    rad = w * 0.09
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=rad, fill=IVORY, outline=EDGE, width=max(1, int(w * 0.012)))
    if suit == "S":
        spade(d, s / 2, s / 2 - h * 0.06, w * 0.24, INK)
    else:
        heart(d, s / 2, s / 2, w * 0.24, RED)
    return layer


def crown(s, cx, cy, w):
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = Image.new("RGBA", (s, s))
    gp = grad.load()
    for y in range(s):
        t = min(1.0, max(0.0, (y - (cy - w * 0.45)) / (w * 0.75)))
        col = tuple(int(GOLD_TOP[k] + (GOLD_BOTTOM[k] - GOLD_TOP[k]) * t) for k in range(3)) + (255,)
        for x in range(s):
            gp[x, y] = col
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    h = w * 0.62
    top = cy - h / 2
    pts = [
        (cx - w / 2, cy + h / 2), (cx - w / 2, top + h * 0.25), (cx - w * 0.28, top + h * 0.55), (cx - w * 0.12, top),
        (cx, top + h * 0.4), (cx + w * 0.12, top), (cx + w * 0.28, top + h * 0.55), (cx + w / 2, top + h * 0.25), (cx + w / 2, cy + h / 2),
    ]
    md.polygon(pts, fill=255)
    for px_, py_ in [(cx - w / 2, top + h * 0.25), (cx - w * 0.12, top), (cx + w * 0.12, top), (cx + w / 2, top + h * 0.25)]:
        r = w * 0.055
        md.ellipse([px_ - r, py_ - r, px_ + r, py_ + r], fill=255)
    layer.paste(grad, (0, 0), mask)
    return layer


def draw(size, safe=1.0):
    s = size * 4
    img = felt(s)
    # 金の細い輪
    ring = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([s * 0.1, s * 0.12, s * 0.9, s * 0.86], outline=(243, 221, 155, 60), width=int(s * 0.008))
    img = Image.alpha_composite(img, ring)
    cw, ch = s * 0.34 * safe, s * 0.48 * safe
    back = card(s, cw, ch, "H").rotate(14, resample=Image.BICUBIC, center=(s / 2, s * 0.62))
    front = card(s, cw, ch, "S").rotate(-10, resample=Image.BICUBIC, center=(s / 2, s * 0.62))
    shift = int(s * 0.07 * safe)
    for layer, dx in ((back, shift), (front, -shift)):
        shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 110), (0, 0), layer.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(s * 0.015))
        img.alpha_composite(shadow, (dx, int(s * 0.03 + s * 0.06)))
        img.alpha_composite(layer, (dx, int(s * 0.06)))
    img = Image.alpha_composite(img, crown(s, s / 2, s * 0.2 + s * 0.02 * (1 - safe), s * 0.3 * safe))
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = os.path.join(ROOT, "icons")
    os.makedirs(out, exist_ok=True)
    for size in (180, 192, 512):
        draw(size).convert("RGB").save(os.path.join(out, f"icon-{size}.png"), optimize=True)
    draw(512, safe=0.8).convert("RGB").save(os.path.join(out, "icon-maskable-512.png"), optimize=True)
    print("icons:", sorted(os.listdir(out)))


if __name__ == "__main__":
    main()
