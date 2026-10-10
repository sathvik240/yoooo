/**
 * Minimal ISO base media file format (MP4 / MOV / HEIF) box reader.
 */
import { ascii, concat } from './containers'

export interface Box {
  type: string
  start: number
  size: number
  /** offset of the payload (after size/type/largesize) */
  body: number
  end: number
}

export function readBoxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Box[] = []
  let i = start
  while (i + 8 <= end) {
    let size = dv.getUint32(i)
    const type = ascii(b, i + 4, 4)
    let body = i + 8
    if (size === 1) {
      if (i + 16 > end) break
      size = Number(dv.getBigUint64(i + 8))
      body = i + 16
    } else if (size === 0) {
      size = end - i
    }
    if (size < body - i || i + size > end) break
    out.push({ type, start: i, size, body, end: i + size })
    i += size
  }
  return out
}

export const child = (b: Uint8Array, box: Box, type: string, skip = 0) => readBoxes(b, box.body + skip, box.end).find((x) => x.type === type)

interface HeifItem {
  id: number
  type: string
  contentType?: string
}

function readUint(dv: DataView, at: number, size: number): number {
  if (size === 0) return 0
  if (size === 1) return dv.getUint8(at)
  if (size === 2) return dv.getUint16(at)
  if (size === 4) return dv.getUint32(at)
  if (size === 8) return Number(dv.getBigUint64(at))
  throw new Error('bad int size')
}

/** Item list + locations from a HEIF 'meta' box. */
export function heifItems(b: Uint8Array): { items: HeifItem[]; locate: (id: number) => Uint8Array | null; refs: string[] } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const meta = readBoxes(b).find((x) => x.type === 'meta')
  if (!meta) return null
  const kids = readBoxes(b, meta.body + 4, meta.end) // meta is a full box
  const items: HeifItem[] = []
  const iinf = kids.find((x) => x.type === 'iinf')
  if (iinf) {
    const v = b[iinf.body]
    const entriesStart = iinf.body + 4 + (v === 0 ? 2 : 4)
    for (const infe of readBoxes(b, entriesStart, iinf.end).filter((x) => x.type === 'infe')) {
      const iv = b[infe.body]
      if (iv < 2) continue
      let p = infe.body + 4
      const id = iv === 2 ? dv.getUint16(p) : dv.getUint32(p)
      p += iv === 2 ? 2 : 4
      p += 2 // protection index
      const type = ascii(b, p, 4)
      p += 4
      let contentType: string | undefined
      if (type === 'mime') {
        const rest = ascii(b, p, infe.end - p).split('\0')
        contentType = rest[1]
      }
      items.push({ id, type, contentType })
    }
  }
  const locs = new Map<number, { base: number; extents: [number, number][]; method: number }>()
  const iloc = kids.find((x) => x.type === 'iloc')
  if (iloc) {
    const v = b[iloc.body]
    let p = iloc.body + 4
    const offSize = b[p] >> 4, lenSize = b[p] & 15, baseSize = b[p + 1] >> 4, idxSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0
    p += 2
    const count = v < 2 ? dv.getUint16(p) : dv.getUint32(p)
    p += v < 2 ? 2 : 4
    for (let n = 0; n < count && p < iloc.end; n++) {
      const id = v < 2 ? dv.getUint16(p) : dv.getUint32(p)
      p += v < 2 ? 2 : 4
      let method = 0
      if (v === 1 || v === 2) { method = dv.getUint16(p) & 15; p += 2 }
      p += 2 // data reference index
      const base = readUint(dv, p, baseSize)
      p += baseSize
      const extCount = dv.getUint16(p)
      p += 2
      const extents: [number, number][] = []
      for (let e = 0; e < extCount; e++) {
        p += idxSize
        const off = readUint(dv, p, offSize); p += offSize
        const len = readUint(dv, p, lenSize); p += lenSize
        extents.push([off, len])
      }
      locs.set(id, { base, extents, method })
    }
  }
  const idat = kids.find((x) => x.type === 'idat')
  const locate = (id: number) => {
    const l = locs.get(id)
    if (!l) return null
    const origin = l.method === 1 && idat ? idat.body : 0
    const parts = l.extents.map(([off, len]) => b.subarray(origin + l.base + off, origin + l.base + off + (len || b.length)))
    return parts.length === 1 ? parts[0] : concat(parts)
  }
  const iref = kids.find((x) => x.type === 'iref')
  const refs = iref ? readBoxes(b, iref.body + 4, iref.end).map((r) => r.type) : []
  return { items, locate, refs }
}

/**
 * Wrap a HEIF/AVIF file's Exif and XMP items in a minimal JPEG shell so exifr
 * (whose HEIC parser rejects some valid files) can read them reliably.
 */
export function heifMetadataAsJpegShell(b: Uint8Array): Uint8Array | null {
  let heif
  try {
    heif = heifItems(b)
  } catch {
    return null
  }
  if (!heif) return null
  const enc = new TextEncoder()
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  const app1 = (prefix: Uint8Array, payload: Uint8Array) => {
    const max = 0xffff - 2 - prefix.length
    const body = payload.subarray(0, max)
    const size = prefix.length + body.length + 2
    parts.push(new Uint8Array([0xff, 0xe1, size >> 8, size & 0xff]), prefix, body)
  }
  for (const item of heif.items) {
    const data = heif.locate(item.id)
    if (!data || data.length < 8) continue
    if (item.type === 'Exif') {
      const skip = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
      let tiff = data.subarray(4 + skip)
      if (ascii(tiff, 0, 4) === 'Exif') tiff = tiff.subarray(6)
      app1(enc.encode('Exif\0\0'), tiff)
    } else if (item.type === 'mime' && item.contentType?.includes('rdf+xml')) {
      app1(enc.encode('http://ns.adobe.com/xap/1.0/\0'), data)
    }
  }
  if (parts.length === 1) return null
  parts.push(new Uint8Array([0xff, 0xd9]))
  return concat(parts)
}
