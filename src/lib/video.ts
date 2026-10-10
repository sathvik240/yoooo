/**
 * MP4 / MOV metadata removal without re-encoding or remuxing.
 *
 * Metadata in these files lives in small boxes ('udta', 'meta', XMP 'uuid')
 * and in the creation/modification times of the movie, track and media
 * headers. Unpin rewrites those bytes *in place*: metadata boxes become
 * 'free' boxes (which every player skips) with their contents zeroed, and the
 * timestamps are set to zero. No box changes size, so no offsets move, and
 * the video data itself is copied through untouched as Blob slices. That
 * makes it instant and memory-light, even for large files on a phone.
 *
 * What it can't remove: timed-metadata *tracks* (GoPro GPS telemetry 'gpmd',
 * Google 'camm', Apple 'mebx'). Those are reported so the file is never
 * called clean while one is present.
 */
import { ascii } from './containers'
import { FriendlyError, type CleanResult, type Findings, type Verification } from './handlers'
import { sortFields, type Field, type Group, type Risk } from './fields'

interface Box {
  type: string
  start: number
  end: number
  body: number
}

interface Patch {
  offset: number
  bytes: Uint8Array
}

export interface VideoScan {
  fields: Field[]
  patches: Patch[]
  telemetry: string[]
  gps?: { latitude: number; longitude: number; altitude?: number }
  kind: 'mp4' | 'mov'
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'tref'])
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac'
const TELEMETRY = new Set(['gpmd', 'camm', 'mebx', 'mett', 'metx', 'rtmd', 'tmcd_gps'])
const EPOCH_1904 = Date.UTC(1904, 0, 1)

const TAGS: Record<string, [Group, string, Risk, string?]> = {
  '©xyz': ['location', 'Location', 'high', 'GPS coordinates of where the video was filmed.'],
  'location.ISO6709': ['location', 'Location', 'high', 'GPS coordinates of where the video was filmed.'],
  'location.name': ['place', 'Place name', 'high'],
  loci: ['location', 'Location', 'high', 'GPS coordinates of where the video was filmed.'],
  '©mak': ['device', 'Phone / camera maker', 'medium'],
  make: ['device', 'Phone / camera maker', 'medium'],
  '©mod': ['device', 'Phone / camera model', 'medium', 'Narrows down who could have filmed it.'],
  model: ['device', 'Phone / camera model', 'medium', 'Narrows down who could have filmed it.'],
  '©swr': ['software', 'Software', 'low'],
  software: ['software', 'Software', 'low'],
  '©too': ['software', 'Encoder', 'low'],
  '©day': ['time', 'Recorded', 'medium'],
  creation_time: ['time', 'Recorded (file header)', 'medium', 'When the file was created, stored in the movie header.'],
  creationdate: ['time', 'Recorded', 'medium', 'The exact moment you filmed it, often with your time zone.'],
  '©ART': ['people', 'Artist', 'high', 'Your name, written into the file.'],
  author: ['people', 'Author', 'high', 'Your name, written into the file.'],
  artist: ['people', 'Artist', 'high', 'Your name, written into the file.'],
  auth: ['people', 'Author', 'high'],
  '©aut': ['people', 'Author', 'high'],
  '©wrt': ['people', 'Writer', 'high'],
  cprt: ['people', 'Copyright', 'medium'],
  '©cpy': ['people', 'Copyright', 'medium'],
  '©nam': ['other', 'Title', 'medium'],
  displayname: ['other', 'Title', 'medium'],
  '©cmt': ['other', 'Comment', 'medium', 'Free text written into the file.'],
  comment: ['other', 'Comment', 'medium', 'Free text written into the file.'],
  description: ['other', 'Description', 'medium'],
  '©des': ['other', 'Description', 'medium'],
  keywords: ['other', 'Keywords', 'medium'],
}

function boxesIn(b: Uint8Array, start: number, end: number, base = 0): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Box[] = []
  let i = start
  while (i + 8 <= end) {
    let size = dv.getUint32(i)
    let body = i + 8
    if (size === 1) {
      size = Number(dv.getBigUint64(i + 8))
      body = i + 16
    } else if (size === 0) size = end - i
    if (size < body - i || i + size > end) break
    out.push({ type: ascii(b, i + 4, 4), start: base + i, end: base + i + size, body: base + body })
    i += size
  }
  return out
}

/** Read the top-level box headers of a (possibly huge) file without loading it. */
async function topLevel(file: Blob): Promise<Box[]> {
  const out: Box[] = []
  let i = 0
  while (i + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(i, i + 16).arrayBuffer())
    const dv = new DataView(h.buffer)
    let size = dv.getUint32(0)
    let body = i + 8
    if (size === 1) {
      size = Number(dv.getBigUint64(8))
      body = i + 16
    } else if (size === 0) size = file.size - i
    const type = ascii(h, 4, 4)
    if (size < 8 || i + size > file.size || !/^[\x20-\x7e\xa9]{4}$/.test(type)) {
      if (!out.length) throw new FriendlyError('This video file couldn’t be read. It may be damaged or not an MP4/MOV.', 'Try exporting or saving the video again from your phone or editor, then drop the new copy here.')
      break
    }
    out.push({ type, start: i, end: i + size, body })
    i += size
  }
  return out
}

/** The 'meta' box is a full box in MP4 but not in QuickTime; detect which. */
function metaChildrenStart(b: Uint8Array, body: number, end: number): number {
  const looksLikeBox = (at: number) => at + 8 <= end && /^[a-z]{4}$/.test(ascii(b, at + 4, 4))
  return looksLikeBox(body) ? body : body + 4
}

function textAtom(b: Uint8Array, box: Box, base: number): string {
  const lb = box.body - base
  const le = box.end - base
  // iTunes-style: contains a 'data' box
  const inner = boxesIn(b, lb, le)
  const data = inner.find((x) => x.type === 'data')
  if (data) return decodeText(b.subarray(data.start + 16, data.end))
  // QuickTime-style: [u16 length][u16 language][text]
  const len = (b[lb] << 8) | b[lb + 1]
  return decodeText(b.subarray(lb + 4, Math.min(le, lb + 4 + len)))
}

const decodeText = (u: Uint8Array) => new TextDecoder().decode(u).replace(/\0+$/, '').trim()

function iso6709(s: string): VideoScan['gps'] {
  const m = s.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/)
  if (!m) return undefined
  return { latitude: Number(m[1]), longitude: Number(m[2]), altitude: m[3] ? Number(m[3]) : undefined }
}

function freeBox(b: Uint8Array, box: Box, base: number): Patch {
  // Keep the size (and 64-bit size if present); rename to 'free'; zero the rest.
  const headerLen = box.body - box.start
  const bytes = new Uint8Array(box.end - box.start - 4)
  bytes.set([0x66, 0x72, 0x65, 0x65]) // 'free'
  if (headerLen === 16) bytes.set(b.subarray(box.start - base + 8, box.start - base + 16), 4)
  return { offset: box.start + 4, bytes }
}

/**
 * Scan an in-memory slice (moov, or a top-level metadata box) for fields and
 * the patches that would remove them. `base` is the slice's file offset.
 */
function scanTree(b: Uint8Array, base: number, scan: VideoScan, boxes: Box[]): void {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const add = (key: string, value: string) => {
    if (!value) return
    const short = key.replace(/^com\.apple\.quicktime\./, '').replace(/^com\.android\./, '')
    const rule = TAGS[short] ?? TAGS[key] ?? ['other', short, 'medium']
    if (rule[0] === 'location') scan.gps ??= iso6709(value)
    if (!scan.fields.some((f) => f.label === rule[1] && f.value === value)) {
      scan.fields.push({ key: `video.${short}`, group: rule[0], label: rule[1], value, risk: rule[2], why: rule[3] })
    }
  }

  const readMeta = (box: Box) => {
    const lb = box.body - base
    const kids = boxesIn(b, metaChildrenStart(b, lb, box.end - base), box.end - base, base)
    const keysBox = kids.find((k) => k.type === 'keys')
    const keys: string[] = []
    if (keysBox) {
      let p = keysBox.body - base + 4
      const n = dv.getUint32(p)
      p += 4
      for (let k = 0; k < n; k++) {
        const size = dv.getUint32(p)
        keys.push(ascii(b, p + 8, size - 8))
        p += size
      }
    }
    const ilst = kids.find((k) => k.type === 'ilst')
    if (ilst) {
      for (const item of boxesIn(b, ilst.body - base, ilst.end - base, base)) {
        const idx = dv.getUint32(item.start - base + 4)
        const name = keys.length && idx >= 1 && idx <= keys.length ? keys[idx - 1] : item.type
        add(name, textAtom(b, item, base))
      }
    }
  }

  const readUdta = (box: Box) => {
    for (const child of boxesIn(b, box.body - base, box.end - base, base)) {
      if (child.type === 'meta') readMeta(child)
      else if (child.type === 'loci') {
        const lb = child.body - base + 4 + 2 // full box + language
        let p = lb
        while (p < child.end - base && b[p] !== 0) p++
        const name = decodeText(b.subarray(lb, p))
        p += 2 // terminator + role
        const lon = dv.getInt32(p) / 65536, lat = dv.getInt32(p + 4) / 65536, alt = dv.getInt32(p + 8) / 65536
        scan.gps ??= { latitude: lat, longitude: lon, altitude: alt || undefined }
        add('loci', `${lat >= 0 ? '+' : ''}${lat.toFixed(4)}${lon >= 0 ? '+' : ''}${lon.toFixed(4)}${name ? ` (${name})` : ''}`)
      } else if (child.type.charCodeAt(0) === 0xa9 || TAGS[child.type]) {
        add(child.type, textAtom(b, child, base))
      } else if (child.type !== 'free' && child.type !== 'skip') {
        scan.fields.push({ key: `video.udta.${child.type}`, group: 'other', label: `Vendor data (${child.type})`, value: `${child.end - child.start} bytes`, risk: 'medium', why: 'Manufacturer data that can include serial numbers or settings.' })
      }
    }
  }

  const walk = (list: Box[], trak?: { handler?: string; formats: string[] }) => {
    for (const box of list) {
      boxes.push(box)
      const lb = box.body - base
      if (box.type === 'mvhd' || box.type === 'tkhd' || box.type === 'mdhd') {
        const v = b[lb]
        const w = v === 1 ? 8 : 4
        const created = v === 1 ? Number(dv.getBigUint64(lb + 4)) : dv.getUint32(lb + 4)
        const modified = v === 1 ? Number(dv.getBigUint64(lb + 12)) : dv.getUint32(lb + 8)
        if (created || modified) {
          if (box.type === 'mvhd' && created) {
            const d = new Date(EPOCH_1904 + created * 1000)
            add('creation_time', d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))
          }
          scan.patches.push({ offset: box.body + 4, bytes: new Uint8Array(w * 2) })
        }
      } else if (box.type === 'udta') {
        readUdta(box)
        scan.patches.push(freeBox(b, box, base))
      } else if (box.type === 'meta') {
        readMeta(box)
        scan.patches.push(freeBox(b, box, base))
      } else if (box.type === 'uuid' && Array.from(b.subarray(lb, lb + 16), (x) => x.toString(16).padStart(2, '0')).join('') === XMP_UUID) {
        const xmp = decodeText(b.subarray(lb + 16, box.end - base))
        const creator = xmp.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]*)</)?.[1]
        add('xmp', creator ? `XMP (creator: ${creator})` : 'XMP metadata block')
        scan.patches.push(freeBox(b, box, base))
      } else if (box.type === 'hdlr' && trak) {
        trak.handler = ascii(b, lb + 8, 4)
      } else if (box.type === 'stsd' && trak) {
        for (const entry of boxesIn(b, lb + 8, box.end - base, base)) trak.formats.push(entry.type)
      } else if (box.type === 'trak') {
        const info = { formats: [] as string[], handler: undefined as string | undefined }
        walk(boxesIn(b, lb, box.end - base, base), info)
        if (info.handler === 'meta' || info.formats.some((f) => TELEMETRY.has(f))) scan.telemetry.push(info.formats[0] ?? info.handler ?? 'meta')
      } else if (CONTAINERS.has(box.type)) {
        walk(boxesIn(b, lb, box.end - base, base), trak)
      }
    }
  }
  walk(boxesIn(b, 0, b.length, base))
  if (base === 0 && !b.length) return
}

export async function scanVideo(file: Blob): Promise<VideoScan> {
  const top = await topLevel(file)
  const ftyp = top.find((t) => t.type === 'ftyp')
  const brand = ftyp ? ascii(new Uint8Array(await file.slice(ftyp.body, ftyp.body + 4).arrayBuffer()), 0, 4) : ''
  const scan: VideoScan = { fields: [], patches: [], telemetry: [], kind: brand === 'qt  ' ? 'mov' : 'mp4' }
  if (!top.some((t) => t.type === 'moov')) {
    throw new FriendlyError('This video has no index (“moov” box), so it can’t be cleaned safely.', 'It may still be recording or only partly downloaded. Save or export it again and try the new copy.')
  }
  const seen: Box[] = []
  for (const box of top) {
    if (box.type === 'moov' || box.type === 'udta' || box.type === 'meta' || box.type === 'uuid') {
      if (box.end - box.start > 512 * 1024 * 1024) throw new FriendlyError('This video’s index is unusually large.', 'Try trimming or re-exporting the video, then clean the shorter copy.')
      const bytes = new Uint8Array(await file.slice(box.start, box.end).arrayBuffer())
      // Re-root the slice: parse it as a list holding just this box.
      scanTree(bytes, box.start, scan, seen)
    }
  }
  for (const t of scan.telemetry) {
    scan.fields.push({ key: `video.track.${t}`, group: 'location', label: 'Sensor track', value: `${t} timed metadata`, risk: 'high', why: 'A separate data track (for example GPS telemetry from an action camera). It can’t be removed without re-encoding.' })
  }
  scan.fields = sortFields(scan.fields)
  return scan
}

export async function readVideo(file: Blob): Promise<Findings> {
  const s = await scanVideo(file)
  return { fields: s.fields, notes: [], image: s.gps ? ({ gps: s.gps } as Findings['image']) : undefined }
}

/** Apply byte patches to a Blob without loading the untouched parts. */
function patchBlob(file: Blob, patches: Patch[], type: string): Blob {
  const sorted = [...patches].sort((a, b) => a.offset - b.offset)
  const parts: BlobPart[] = []
  let pos = 0
  for (const p of sorted) {
    if (p.offset < pos) continue // nested inside an already-patched box
    parts.push(file.slice(pos, p.offset), p.bytes as BlobPart)
    pos = p.offset + p.bytes.length
  }
  parts.push(file.slice(pos))
  return new Blob(parts, { type })
}

export async function cleanVideo(file: Blob, index: number): Promise<CleanResult> {
  const t0 = performance.now()
  const before = await scanVideo(file)
  const ext = before.kind === 'mov' ? 'mov' : 'mp4'
  const type = ext === 'mov' ? 'video/quicktime' : 'video/mp4'
  const blob = patchBlob(file, before.patches, type)
  const verify = await verifyVideo(blob)
  return {
    blob,
    name: `unpinned-${index}.${ext}`,
    verify,
    ms: performance.now() - t0,
    removed: before.fields,
    notes: before.telemetry.length ? ['This video has a sensor data track that may contain GPS. Unpin can’t remove tracks without re-encoding; re-export the video without telemetry, or screen-record it, before sharing.'] : [],
  }
}

export async function verifyVideo(blob: Blob): Promise<Verification> {
  const again = await scanVideo(blob)
  const notes = again.patches.length ? [`${again.patches.length} metadata box(es) or timestamps still present`] : []
  return { clean: again.fields.length === 0 && notes.length === 0, remaining: again.fields, structural: [], notes }
}
