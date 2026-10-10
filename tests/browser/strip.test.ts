import { describe, it, expect } from 'vitest'
import exifr from 'exifr'
import { stripImage, StripError } from '../../src/lib/strip'
import { readImageMetadata, verifyImage } from '../../src/lib/imageMeta'
import { scanSegments, concat } from '../../src/lib/containers'
import { fixture, bytesOf, pixelAt } from './helpers'

const IDENTIFYING = ['exif', 'xmp', 'iptc', 'comment', 'text', 'timestamp', 'mpf', 'vendor', 'trailing']

/** Independent check straight against exifr, not through our own field mapping. */
async function exifrSees(blob: Blob) {
  const out = (await exifr.parse(await bytesOf(blob), {
    tiff: true, xmp: true, iptc: true, gps: true, jfif: false, ihdr: false, icc: false, mergeOutput: false,
  } as never)) as Record<string, unknown> | undefined
  return out ? Object.keys(out) : []
}

describe('reading what a photo broadcasts', () => {
  it('finds GPS, device, people, thumbnail, XMP and IPTC in a phone JPEG', async () => {
    const r = await readImageMetadata(await bytesOf(await fixture('gps.jpg')))
    expect(r.gps?.latitude).toBeCloseTo(40.748817, 4)
    expect(r.gps?.longitude).toBeCloseTo(-73.985428, 4)
    const labels = r.fields.map((f) => `${f.label}=${f.value}`)
    expect(labels).toContain('Phone / camera model=Pixelphone 9 Pro')
    expect(labels).toContain('Camera serial number=SN-48151623')
    expect(labels).toContain('Camera owner=Jamie Doe')
    expect(labels).toContain('By-line=Jamie Doe') // IPTC
    expect(labels).toContain('Creator=Jamie Doe') // XMP
    expect(labels.some((l) => l.startsWith('Hidden preview image='))).toBe(true)
    expect(r.thumbnail?.byteLength).toBeGreaterThan(100)
    expect(r.hasCameraExif).toBe(true)
  })

  it('reads WebP metadata, which exifr cannot parse on its own', async () => {
    const r = await readImageMetadata(await bytesOf(await fixture('meta.webp')))
    expect(r.kind).toBe('webp')
    expect(r.gps?.latitude).toBeCloseTo(40.7488, 3)
    expect(r.fields.some((f) => f.value === 'Jamie Doe')).toBe(true)
  })

  it('reads PNG text chunks and eXIf', async () => {
    const r = await readImageMetadata(await bytesOf(await fixture('meta.png')))
    expect(r.fields.map((f) => f.value)).toEqual(expect.arrayContaining(['Jamie Doe', 'Shot from my bedroom window']))
    expect(r.gps).toBeDefined()
  })

  it('verify is not vacuous: the original files fail verification', async () => {
    for (const name of ['gps.jpg', 'meta.png', 'meta.webp', 'rotated.jpg']) {
      const v = await verifyImage(await bytesOf(await fixture(name)))
      expect(v.clean, name).toBe(false)
      expect(v.remaining.length, name).toBeGreaterThan(0)
    }
  })

  it('a JPEG with no metadata verifies clean', async () => {
    const v = await verifyImage(await bytesOf(await fixture('clean.jpg')))
    expect(v.clean).toBe(true)
  })
})

describe('stripping and verifying', () => {
  it('JPEG: removes EXIF, GPS, XMP, IPTC and the thumbnail', async () => {
    const res = await stripImage(await fixture('gps.jpg'), { index: 1 })
    expect(res.name).toBe('unpinned-1.jpg')
    expect(res.blob.type).toBe('image/jpeg')
    expect(res.verify.clean).toBe(true)
    expect(res.verify.remaining).toEqual([])
    const bytes = await bytesOf(res.blob)
    const kinds = scanSegments(bytes).map((s) => s.kind)
    for (const k of IDENTIFYING) expect(kinds).not.toContain(k)
    expect(await exifrSees(res.blob)).toEqual([])
    expect(await exifr.gps(bytes)).toBeUndefined()
    expect(await exifr.thumbnail(bytes)).toBeUndefined()
    expect([res.width, res.height]).toEqual([64, 48])
  })

  it('JPEG: bakes EXIF rotation into the pixels so the clean copy stays upright', async () => {
    const res = await stripImage(await fixture('rotated.jpg'), { index: 2 })
    // stored 60x30 landscape + Orientation 6 => displayed 30x60 portrait
    expect([res.width, res.height]).toEqual([30, 60])
    expect(res.verify.clean).toBe(true)
    expect(await exifr.orientation(await bytesOf(res.blob))).toBeUndefined()
    const top = await pixelAt(res.blob, 15, 5)
    const bottom = await pixelAt(res.blob, 15, 55)
    expect(top[0]).toBeGreaterThan(180) // red stripe now on top
    expect(top[2]).toBeLessThan(80)
    expect(bottom[2]).toBeGreaterThan(180) // blue below
    expect(bottom[0]).toBeLessThan(80)
  })

  it('PNG: drops tEXt, iTXt (XMP) and eXIf chunks, stays PNG', async () => {
    const res = await stripImage(await fixture('meta.png'), { index: 3 })
    expect(res.name).toBe('unpinned-3.png')
    expect(res.blob.type).toBe('image/png')
    expect(res.verify.clean).toBe(true)
    const labels = scanSegments(await bytesOf(res.blob)).map((s) => s.label)
    expect(labels.filter((l) => /tEXt|iTXt|zTXt|eXIf|tIME/.test(l))).toEqual([])
  })

  it('WebP: drops EXIF and XMP chunks', async () => {
    const res = await stripImage(await fixture('meta.webp'), { index: 4 })
    expect(res.blob.type).toBe('image/webp')
    expect(res.name).toBe('unpinned-4.webp')
    expect(res.verify.clean).toBe(true)
    expect(scanSegments(await bytesOf(res.blob)).map((s) => s.kind)).not.toContain('exif')
  })

  it('never reuses the original filename', async () => {
    const f = new File([await fixture('gps.jpg')], 'IMG_20240601_081422_Springfield.jpg', { type: 'image/jpeg' })
    const res = await stripImage(f, { index: 7 })
    expect(res.name).toBe('unpinned-7.jpg')
  })

  it('JPEG output quality is high (>= 0.92): output is not tiny', async () => {
    const res = await stripImage(await fixture('gps.jpg'), { index: 1 })
    // At q=0.92 the 64x48 test image re-encodes to well over 1 KB.
    expect(res.blob.size).toBeGreaterThan(1000)
  })

  it('corrupt file: fails with a plain-language message and a fix', async () => {
    const err = await stripImage(await fixture('corrupt.jpg'), { index: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(StripError)
    expect(err.message).toMatch(/couldn.t be opened/)
    expect(err.hint).toMatch(/fresh copy/)
  })

  it('corrupt file: reading reports a broken container instead of crashing', async () => {
    const err = await readImageMetadata(await bytesOf(await fixture('corrupt.jpg'))).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/JPEG/)
  })
})

describe('performance', () => {
  it('cleans a 12 MP (4032x3024) phone-sized JPEG with GPS in reasonable time', async () => {
    // Build a 12 MP JPEG with real-looking detail, then splice in the EXIF
    // block from the GPS fixture so it carries location data.
    const w = 4032, h = 3024
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#345'); g.addColorStop(1, '#c96')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`
      ctx.fillRect((i * 7919) % w, (i * 104729) % h, 40, 40)
    }
    const plain = await bytesOf(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }))
    const donor = await bytesOf(await fixture('gps.jpg'))
    const exifSeg = scanSegments(donor).find((s) => s.kind === 'exif')!
    const big = concat([plain.subarray(0, 2), donor.subarray(exifSeg.offset, exifSeg.offset + exifSeg.length), plain.subarray(2)])
    const file = new File([big as BlobPart], 'big.jpg', { type: 'image/jpeg' })
    expect((await readImageMetadata(big)).gps).toBeDefined()

    const res = await stripImage(file, { index: 1 })
    console.log(`12MP: input ${(file.size / 1e6).toFixed(1)} MB -> output ${(res.blob.size / 1e6).toFixed(1)} MB in ${res.ms.toFixed(0)} ms`)
    expect([res.width, res.height]).toEqual([w, h])
    expect(res.verify.clean).toBe(true)
    expect(res.ms).toBeLessThan(15_000)
  })
})
