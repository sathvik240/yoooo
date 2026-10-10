"""Draw the demo photo used by "Try a sample": an illustrated street scene
with a house number, street sign, mailbox name and licence plate (things to
redact), plus phone-style EXIF with GPS pointing at a public landmark.

Run: python3 scripts/make-demo.py   (needs Pillow + piexif)
"""
import io, random, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import piexif

sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
fx = import_module("make-fixtures")  # reuse exif_bytes / iptc helpers

W, H = 1600, 1200
random.seed(7)
img = Image.new("RGB", (W, H))
d = ImageDraw.Draw(img)

def font(size, bold=True):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()

# sky
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(150 + 80 * t), int(190 + 40 * t), int(230 - 10 * t)))
d.ellipse([1240, 90, 1400, 250], fill=(255, 236, 170))
# distant hills
d.polygon([(0, 600), (300, 470), (620, 560), (900, 450), (1250, 560), (1600, 480), (1600, 700), (0, 700)], fill=(124, 156, 128))
# house facade
d.rectangle([120, 330, 880, 960], fill=(186, 92, 70))
for y in range(340, 960, 26):
    off = 0 if (y // 26) % 2 else 30
    for x in range(120 + off, 880, 60):
        d.rectangle([x, y, min(x + 56, 879), y + 22], outline=(160, 76, 58))
d.polygon([(90, 340), (500, 160), (910, 340)], fill=(70, 62, 66))
# window with reflection
d.rectangle([200, 430, 440, 650], fill=(240, 240, 235))
d.rectangle([212, 442, 428, 638], fill=(120, 160, 190))
d.polygon([(220, 630), (330, 450), (360, 450), (250, 630)], fill=(190, 215, 235))
d.line([(320, 442), (320, 638)], fill=(240, 240, 235), width=8)
# door + house number plaque
d.rectangle([560, 560, 760, 960], fill=(40, 70, 90))
d.ellipse([725, 750, 745, 770], fill=(220, 190, 90))
d.rectangle([590, 470, 730, 545], fill=(250, 246, 236), outline=(30, 30, 30), width=4)
d.text((660, 507), "42", fill=(20, 20, 20), font=font(58), anchor="mm")
# mailbox with name
d.rectangle([800, 760, 940, 840], fill=(50, 50, 55))
d.rectangle([812, 790, 928, 820], fill=(245, 245, 240))
d.text((870, 805), "J. DOE", fill=(20, 20, 20), font=font(22), anchor="mm")
d.rectangle([862, 840, 878, 1000], fill=(50, 50, 55))
# pavement + road
d.rectangle([0, 960, W, 1030], fill=(196, 192, 184))
d.rectangle([0, 1030, W, H], fill=(70, 72, 78))
for x in range(0, W, 160):
    d.rectangle([x + 20, 1110, x + 110, 1122], fill=(235, 220, 120))
# street sign
d.rectangle([1090, 420, 1104, 1000], fill=(90, 96, 100))
d.rectangle([960, 440, 1300, 520], fill=(28, 112, 72), outline=(240, 240, 240), width=5)
d.text((1130, 480), "ELM ST", fill=(255, 255, 255), font=font(50), anchor="mm")
d.rectangle([1000, 530, 1200, 575], fill=(28, 112, 72), outline=(240, 240, 240), width=3)
d.text((1100, 552), "200 BLOCK", fill=(255, 255, 255), font=font(24), anchor="mm")
# car with plate
d.rounded_rectangle([1050, 860, 1560, 1060], radius=40, fill=(214, 64, 52))
d.rounded_rectangle([1130, 780, 1460, 900], radius=36, fill=(196, 56, 46))
d.rectangle([1160, 800, 1290, 880], fill=(150, 190, 215))
d.rectangle([1310, 800, 1430, 880], fill=(150, 190, 215))
for cx in (1150, 1460):
    d.ellipse([cx - 60, 1000, cx + 60, 1120], fill=(30, 30, 32))
    d.ellipse([cx - 26, 1034, cx + 26, 1086], fill=(170, 170, 175))
d.rectangle([1225, 965, 1385, 1015], fill=(250, 250, 245), outline=(30, 30, 30), width=3)
d.text((1305, 990), "7ABC123", fill=(20, 30, 90), font=font(30), anchor="mm")
# a little texture so it reads as a photo
noise = Image.effect_noise((W, H), 10).convert("RGB")
img = Image.blend(img, noise, 0.04).filter(ImageFilter.GaussianBlur(0.6))

exif = piexif.load(fx.exif_bytes())
exif["0th"][piexif.ImageIFD.Model] = b"Pixelphone 9 Pro"
exif["Exif"][piexif.ExifIFD.DateTimeOriginal] = b"2024:06:01 08:14:22"
thumb = img.resize((160, 120))
tb = io.BytesIO(); thumb.save(tb, "JPEG", quality=70)
exif["thumbnail"] = tb.getvalue()
buf = io.BytesIO()
img.save(buf, "JPEG", quality=86, exif=piexif.dump(exif), xmp=fx.XMP.encode())
out = Path(__file__).resolve().parent.parent / "public" / "samples" / "IMG_20240601_081422.jpg"
out.write_bytes(fx.insert_after_soi(buf.getvalue(), fx.iptc_app13()))
print(out, out.stat().st_size)
