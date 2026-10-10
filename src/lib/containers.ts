/**
 * Byte-level container parsing for JPEG, PNG and WebP.
 *
 * This is deliberately independent of exifr: verification runs both, so a
 * file is only called clean when two different parsers agree.
 */

export type FileKind =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'heic'
  | 'avif'
  | 'pdf'
  | 'zip'
  | 'mp4'
  | 'unknown'

export function sniff(bytes: Uint8Array): FileKind {
  const b = bytes
  if (b.length < 12) return 'unknown'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  if (ascii(b, 0, 4) === 'GIF8') return 'gif'
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf'
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip'
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) {
      // mif1 can also be AVIF; look at compatible brands
      const head = ascii(b, 8, Math.min(64, b.length - 8))
      if (brand === 'mif1' && head.includes('avif') && !head.includes('heic')) return 'avif'
      return 'heic'
    }
    if (brand === 'avif' || brand === 'avis') return 'avif'
    return 'mp4'
  }
  return 'unknown'
}

export function ascii(b: Uint8Array, start: number, len: number): string {
  let s = ''
  const end = Math.min(b.length, start + len)
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i])
  return s
}

export type SegmentKind =
  | 'exif'
  | 'xmp'
  | 'iptc'
  | 'icc'
  | 'comment'
  | 'text'
  | 'timestamp'
  | 'mpf'
  | 'vendor'
  | 'trailing'
  | 'structural'

export interface Segment {
  kind: SegmentKind
  /** Human label, e.g. "APP1 EXIF" or "tEXt: Author" */
  label: string
  offset: number
  length: number
}

/** Segments that never identify anyone and are needed to decode the image. */
export const STRUCTURAL: ReadonlySet<SegmentKind> = new Set(['structural'])

/** Colour profiles: not identifying in practice, reported but allowed. */
export const ALLOWED_NON_STRUCTURAL: ReadonlySet<SegmentKind> = new Set(['icc'])

export function isIdentifyingSegment(s: Segment): boolean {
  return !STRUCTURAL.has(s.kind) && !ALLOWED_NON_STRUCTURAL.has(s.kind)
}

export class ContainerError extends Error {}

export function scanSegments(bytes: Uint8Array): Segment[] {
  const kind = sniff(bytes)
  if (kind === 'jpeg') return scanJpeg(bytes)
  if (kind === 'png') return scanPng(bytes)
  if (kind === 'webp') return scanWebp(bytes)
  return []
}

function scanJpeg(b: Uint8Array): Segment[] {
  const out: Segment[] = []
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new ContainerError(`Bad JPEG marker at byte ${i}`)
    let marker = b[i + 1]
    // skip fill bytes
    while (marker === 0xff && i + 2 < b.length) {
      i++
      marker = b[i + 1]
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker === 0xd9) {
      i += 2
      break
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) throw new ContainerError('JPEG segment runs past end of file')
    const dataStart = i + 4
    const id = ascii(b, dataStart, Math.min(32, len - 2))
    const seg = (k: SegmentKind, label: string) => out.push({ kind: k, label, offset: i, length: len + 2 })

    if (marker === 0xe0) seg(id.startsWith('JFIF') || id.startsWith('JFXX') ? 'structural' : 'vendor', 'APP0 ' + (id.startsWith('JFIF') ? 'JFIF' : 'data'))
    else if (marker === 0xe1) {
      if (id.startsWith('Exif')) seg('exif', 'APP1 EXIF')
      else if (id.startsWith('http://ns.adobe.com/xap/1.0/') || id.startsWith('http://ns.adobe.com/xmp/extension/')) seg('xmp', 'APP1 XMP')
      else seg('vendor', 'APP1 data')
    } else if (marker === 0xe2) {
      if (id.startsWith('ICC_PROFILE')) seg('icc', 'APP2 colour profile')
      else if (id.startsWith('MPF')) seg('mpf', 'APP2 multi-picture (extra images)')
      else seg('vendor', 'APP2 data')
    } else if (marker === 0xed) seg('iptc', 'APP13 IPTC/Photoshop')
    else if (marker === 0xee && id.startsWith('Adobe')) seg('structural', 'APP14 Adobe')
    else if (marker >= 0xe3 && marker <= 0xef) seg('vendor', `APP${marker - 0xe0} vendor data`)
    else if (marker === 0xfe) seg('comment', 'COM comment')
    else if (marker === 0xda) {
      // Start of scan: entropy-coded data follows until EOI. Jump to the
      // last EOI; anything after it is trailing data (e.g. motion-photo video).
      out.push({ kind: 'structural', label: 'image data', offset: i, length: len + 2 })
      const eoi = lastIndexOfEoi(b)
      if (eoi < 0) throw new ContainerError('JPEG is cut off (no end-of-image marker)')
      if (b.length - (eoi + 2) > 16) {
        out.push({ kind: 'trailing', label: 'data after end of image', offset: eoi + 2, length: b.length - eoi - 2 })
      }
      return out
    } else seg('structural', `marker ${marker.toString(16)}`)
    i += 2 + len
  }
  return out
}

function lastIndexOfEoi(b: Uint8Array): number {
  for (let i = b.length - 2; i >= 2; i--) if (b[i] === 0xff && b[i + 1] === 0xd9) return i
  return -1
}

const PNG_STRUCTURAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI'])

function scanPng(b: Uint8Array): Segment[] {
  const out: Segment[] = []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let i = 8
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i)
    const type = ascii(b, i + 4, 4)
    if (i + 12 + len > b.length) throw new ContainerError('PNG chunk runs past end of file')
    const seg = (k: SegmentKind, label: string) => out.push({ kind: k, label, offset: i, length: len + 12 })
    if (PNG_STRUCTURAL.has(type)) seg('structural', type)
    else if (type === 'eXIf') seg('exif', 'eXIf')
    else if (type === 'iCCP') seg('icc', 'iCCP colour profile')
    else if (type === 'tIME') seg('timestamp', 'tIME last-modified time')
    else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const key = ascii(b, i + 8, Math.min(79, len)).split('\0')[0]
      seg(key.startsWith('XML:com.adobe.xmp') ? 'xmp' : key === 'Raw profile type exif' || key === 'Raw profile type APP1' ? 'exif' : 'text', `${type}: ${key}`)
    } else seg('vendor', `${type} chunk`)
    i += 12 + len
    if (type === 'IEND') break
  }
  if (b.length - i > 16) out.push({ kind: 'trailing', label: 'data after end of image', offset: i, length: b.length - i })
  return out
}

const WEBP_STRUCTURAL = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'])

function scanWebp(b: Uint8Array): Segment[] {
  const out: Segment[] = []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let i = 12
  const end = Math.min(b.length, 8 + dv.getUint32(4, true))
  while (i + 8 <= end) {
    const type = ascii(b, i, 4)
    const len = dv.getUint32(i + 4, true)
    if (i + 8 + len > b.length) throw new ContainerError('WebP chunk runs past end of file')
    const seg = (k: SegmentKind, label: string) => out.push({ kind: k, label, offset: i, length: len + 8 + (len & 1) })
    if (WEBP_STRUCTURAL.has(type)) seg('structural', type.trim())
    else if (type === 'EXIF') seg('exif', 'EXIF chunk')
    else if (type === 'XMP ') seg('xmp', 'XMP chunk')
    else if (type === 'ICCP') seg('icc', 'ICCP colour profile')
    else seg('vendor', `${type.trim()} chunk`)
    i += 8 + len + (len & 1)
  }
  if (b.length - end > 16) out.push({ kind: 'trailing', label: 'data after end of image', offset: end, length: b.length - end })
  return out
}

/**
 * exifr cannot read WebP. Wrap the WebP's EXIF and XMP chunks in a minimal
 * JPEG shell (SOI, APP1 EXIF, APP1 XMP, EOI) that exifr can parse.
 */
export function webpMetadataAsJpegShell(b: Uint8Array): Uint8Array | null {
  const segs = scanWebp(b).filter((s) => s.kind === 'exif' || s.kind === 'xmp')
  if (!segs.length) return null
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  const enc = new TextEncoder()
  for (const s of segs) {
    let payload = b.subarray(s.offset + 8, s.offset + 8 + (s.length - 8 - ((s.length - 8) & 1)))
    let prefix: Uint8Array
    if (s.kind === 'exif') {
      // Some writers include the "Exif\0\0" header, most don't.
      const hasHeader = ascii(payload, 0, 4) === 'Exif'
      prefix = hasHeader ? new Uint8Array(0) : enc.encode('Exif\0\0')
    } else {
      prefix = enc.encode('http://ns.adobe.com/xap/1.0/\0')
    }
    const len = prefix.length + payload.length + 2
    if (len > 0xffff) payload = payload.subarray(0, 0xffff - 2 - prefix.length)
    const size = prefix.length + payload.length + 2
    parts.push(new Uint8Array([0xff, 0xe1, size >> 8, size & 0xff]), prefix, payload)
  }
  parts.push(new Uint8Array([0xff, 0xd9]))
  return concat(parts)
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Pixel dimensions as stored in the file (before EXIF orientation). */
export function storedDimensions(b: Uint8Array): { width: number; height: number } | null {
  const kind = sniff(b)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (kind === 'png') return { width: dv.getUint32(16), height: dv.getUint32(20) }
  if (kind === 'jpeg') {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      const len = (b[i + 2] << 8) | b[i + 3]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      }
      i += 2 + len
    }
  }
  return null
}
