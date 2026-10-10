"""Generate image test fixtures that carry identifying metadata.

Run: python3 scripts/make-fixtures.py  (needs Pillow + piexif)
The generated files are committed, so tests don't need Python.
"""
import io
import struct
import zlib
from pathlib import Path

import piexif
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)

XMP = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" '
    'xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" '
    'photoshop:City="Springfield"><dc:creator><rdf:Seq><rdf:li>Jamie Doe</rdf:li>'
    "</rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>"
)


def deg_to_rational(value):
    d = int(value)
    m_float = (value - d) * 60
    m = int(m_float)
    s = round((m_float - m) * 60 * 100)
    return ((d, 1), (m, 1), (s, 100))


def exif_bytes(orientation=1, with_thumb=True):
    thumb = Image.new("RGB", (16, 12), (200, 30, 30))
    tb = io.BytesIO()
    thumb.save(tb, "JPEG")
    zeroth = {
        piexif.ImageIFD.Make: b"Pixelphone",
        piexif.ImageIFD.Model: b"Pixelphone 9 Pro",
        piexif.ImageIFD.Software: b"PhoneOS 17.2",
        piexif.ImageIFD.Artist: b"Jamie Doe",
        piexif.ImageIFD.DateTime: b"2024:06:01 08:14:22",
        piexif.ImageIFD.Orientation: orientation,
    }
    exif = {
        piexif.ExifIFD.DateTimeOriginal: b"2024:06:01 08:14:22",
        piexif.ExifIFD.LensModel: b"Pixelphone back camera 6.9mm f/1.7",
        piexif.ExifIFD.BodySerialNumber: b"SN-48151623",
        piexif.ExifIFD.CameraOwnerName: b"Jamie Doe",
        piexif.ExifIFD.ExposureTime: (1, 120),
        piexif.ExifIFD.FNumber: (17, 10),
    }
    gps = {
        piexif.GPSIFD.GPSLatitudeRef: b"N",
        piexif.GPSIFD.GPSLatitude: deg_to_rational(40.748817),
        piexif.GPSIFD.GPSLongitudeRef: b"W",
        piexif.GPSIFD.GPSLongitude: deg_to_rational(73.985428),
        piexif.GPSIFD.GPSAltitudeRef: 0,
        piexif.GPSIFD.GPSAltitude: (443, 10),
    }
    data = {"0th": zeroth, "Exif": exif, "GPS": gps, "1st": {}, "thumbnail": None}
    if with_thumb:
        data["1st"] = {piexif.ImageIFD.Compression: 6}
        data["thumbnail"] = tb.getvalue()
    return piexif.dump(data)


def iptc_app13():
    """Minimal Photoshop APP13 segment with an IPTC By-line and City."""
    def ds(record, tag, value):
        v = value.encode()
        return bytes([0x1C, record, tag]) + struct.pack(">H", len(v)) + v

    iptc = ds(2, 80, "Jamie Doe") + ds(2, 90, "Springfield")
    block = b"8BIM" + struct.pack(">H", 0x0404) + b"\x00\x00" + struct.pack(">I", len(iptc)) + iptc
    if len(iptc) % 2:
        block += b"\x00"
    payload = b"Photoshop 3.0\x00" + block
    return b"\xFF\xED" + struct.pack(">H", len(payload) + 2) + payload


def insert_after_soi(jpeg: bytes, segment: bytes) -> bytes:
    assert jpeg[:2] == b"\xFF\xD8"
    return jpeg[:2] + segment + jpeg[2:]


def photo(w, h):
    img = Image.new("RGB", (w, h), (60, 110, 160))
    d = ImageDraw.Draw(img)
    d.rectangle([0, h * 2 // 3, w, h], fill=(90, 140, 70))
    d.ellipse([w // 2, h // 6, w // 2 + h // 4, h // 6 + h // 4], fill=(250, 220, 90))
    return img


# 1. A phone photo with EXIF, GPS, thumbnail, XMP and IPTC.
buf = io.BytesIO()
photo(64, 48).save(buf, "JPEG", quality=92, exif=exif_bytes(), xmp=XMP.encode())
(OUT / "gps.jpg").write_bytes(insert_after_soi(buf.getvalue(), iptc_app13()))

# 2. Rotated: pixels stored landscape 60x30, left third red; Orientation=6
#    (rotate 90 CW to display) means the red stripe should end up on TOP of a
#    30x60 portrait image.
img = Image.new("RGB", (60, 30), (20, 60, 220))
ImageDraw.Draw(img).rectangle([0, 0, 19, 29], fill=(230, 20, 20))
buf = io.BytesIO()
img.save(buf, "JPEG", quality=95, exif=exif_bytes(orientation=6, with_thumb=False))
(OUT / "rotated.jpg").write_bytes(buf.getvalue())

# 3. PNG with text chunks, an eXIf chunk and XMP.
def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

buf = io.BytesIO()
photo(32, 24).save(buf, "PNG")
png = buf.getvalue()
iend = png.rfind(b"IEND") - 4
extra = (
    png_chunk(b"tEXt", b"Author\x00Jamie Doe")
    + png_chunk(b"tEXt", b"Comment\x00Shot from my bedroom window")
    + png_chunk(b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + XMP.encode())
    + png_chunk(b"eXIf", exif_bytes(with_thumb=False)[6:])  # strip "Exif\0\0"
)
(OUT / "meta.png").write_bytes(png[:iend] + extra + png[iend:])

# 4. WebP with EXIF + XMP.
buf = io.BytesIO()
photo(32, 24).save(buf, "WEBP", quality=90, exif=exif_bytes(with_thumb=False), xmp=XMP.encode())
(OUT / "meta.webp").write_bytes(buf.getvalue())

# 5. A clean JPEG with no metadata at all (negative control).
buf = io.BytesIO()
photo(32, 24).save(buf, "JPEG", quality=90)
(OUT / "clean.jpg").write_bytes(buf.getvalue())

# 6. A phone screenshot: iPhone 14 dimensions, flat status bar, no camera EXIF.
shot = Image.new("RGB", (1170, 2532), (250, 250, 250))
d = ImageDraw.Draw(shot)
d.rectangle([0, 0, 1170, 140], fill=(255, 255, 255))
d.text((60, 60), "9:41", fill=(0, 0, 0))
d.rectangle([1000, 60, 1100, 90], fill=(0, 0, 0))
for i in range(12):
    d.rectangle([60, 220 + i * 180, 1110, 360 + i * 180], fill=(235, 238, 242))
shot.save(OUT / "screenshot.png", "PNG", optimize=True)

# 7. Corrupt "JPEG": a valid start marker followed by junk, then cut off.
(OUT / "corrupt.jpg").write_bytes(b"\xFF\xD8\xFF\xE0" + bytes(range(256)) * 3)

print("fixtures written to", OUT)
for p in sorted(OUT.iterdir()):
    print(f"  {p.name:16} {p.stat().st_size:>8} bytes")
