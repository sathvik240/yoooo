import exifr from 'exifr'
import { scanSegments, sniff, webpMetadataAsJpegShell, isIdentifyingSegment, type FileKind, type Segment, ContainerError } from './containers'
import { toFields, isIdentifying, formatBytes, type Field } from './fields'

export interface ImageReport {
  kind: FileKind
  fields: Field[]
  gps?: { latitude: number; longitude: number; altitude?: number }
  /** Embedded preview JPEG, if the file carries one. */
  thumbnail?: Uint8Array
  segments: Segment[]
  /** EXIF orientation 1–8 if present */
  orientation?: number
  /** iOS writes "Screenshot" here */
  userComment?: string
  hasCameraExif: boolean
}

const EXIFR_OPTIONS = {
  tiff: true,
  ifd0: true,
  ifd1: true,
  exif: true,
  gps: true,
  interop: false,
  xmp: true,
  iptc: true,
  icc: false,
  jfif: true,
  ihdr: true,
  makerNote: true,
  userComment: true,
  multiSegment: true,
  mergeOutput: false,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  silentErrors: true,
} as const

/**
 * Read everything a photo is broadcasting. Never throws for files that are
 * merely missing metadata; throws ContainerError for files that are broken.
 */
export async function readImageMetadata(bytes: Uint8Array): Promise<ImageReport> {
  const kind = sniff(bytes)
  const segments = scanSegments(bytes)

  let source: Uint8Array | null = bytes
  if (kind === 'webp') source = webpMetadataAsJpegShell(bytes)
  if (kind === 'gif' || kind === 'unknown') source = null

  let raw: Record<string, unknown> | undefined
  if (source) {
    try {
      raw = (await exifr.parse(source, EXIFR_OPTIONS as never)) as Record<string, unknown> | undefined
    } catch (err) {
      // exifr throws on files it doesn't recognise at all. A broken container
      // is reported by scanSegments; anything else means "nothing readable".
      if (!(err instanceof Error) || !/Unknown file format/i.test(err.message)) throw err
    }
  }

  const fields = toFields(raw)
  const gpsBlock = raw?.gps as Record<string, unknown> | undefined
  let gps: ImageReport['gps']
  if (gpsBlock && typeof gpsBlock.latitude === 'number' && typeof gpsBlock.longitude === 'number' && isFinite(gpsBlock.latitude) && isFinite(gpsBlock.longitude)) {
    gps = {
      latitude: gpsBlock.latitude,
      longitude: gpsBlock.longitude,
      altitude: typeof gpsBlock.GPSAltitude === 'number' ? gpsBlock.GPSAltitude : undefined,
    }
  }

  let thumbnail: Uint8Array | undefined
  if (source && (kind === 'jpeg' || kind === 'heic' || kind === 'webp')) {
    try {
      const t = await exifr.thumbnail(source)
      if (t && t.byteLength > 0) thumbnail = t instanceof Uint8Array ? t : new Uint8Array(t as ArrayBuffer)
    } catch {
      /* no thumbnail */
    }
  }
  if (thumbnail) {
    fields.unshift({
      key: 'ifd1.thumbnail',
      group: 'other',
      label: 'Hidden preview image',
      value: `${formatBytes(thumbnail.byteLength)} JPEG`,
      risk: 'high',
      why: 'A small copy of the original photo. If you cropped or edited, it can still show what you cut out.',
    })
  }

  // Segments that exifr doesn't describe but which still leak.
  for (const s of segments) {
    if (s.kind === 'trailing') {
      fields.push({
        key: `segment.trailing`,
        group: 'other',
        label: 'Hidden extra data',
        value: `${formatBytes(s.length)} after the image`,
        risk: 'high',
        why: 'Phones can tuck a short video ("motion photo") or other data after the picture.',
      })
    } else if (s.kind === 'mpf') {
      fields.push({ key: 'segment.mpf', group: 'other', label: 'Extra embedded images', value: 'multi-picture data', risk: 'medium', why: 'Depth maps or extra frames saved alongside the photo.' })
    } else if (s.kind === 'timestamp') {
      fields.push({ key: 'segment.tIME', group: 'time', label: 'Last modified', value: 'PNG tIME chunk', risk: 'low' })
    } else if (s.kind === 'vendor' || s.kind === 'comment') {
      if (!fields.some((f) => f.key === `segment.${s.label}`)) {
        fields.push({ key: `segment.${s.label}`, group: 'other', label: 'Extra data', value: `${s.label}, ${formatBytes(s.length)}`, risk: 'low' })
      }
    }
  }

  const ifd0 = raw?.ifd0 as Record<string, unknown> | undefined
  const exif = raw?.exif as Record<string, unknown> | undefined
  const orientationRaw = await readOrientation(source)
  const uc = exif?.UserComment
  return {
    kind,
    fields,
    gps,
    thumbnail,
    segments,
    orientation: orientationRaw,
    userComment: typeof uc === 'string' ? uc : uc instanceof Uint8Array ? new TextDecoder().decode(uc) : undefined,
    hasCameraExif: Boolean(ifd0?.Make || ifd0?.Model || exif?.ExposureTime || exif?.FNumber || exif?.LensModel),
  }
}

async function readOrientation(source: Uint8Array | null): Promise<number | undefined> {
  if (!source) return undefined
  try {
    const o = await exifr.orientation(source)
    return typeof o === 'number' ? o : undefined
  } catch {
    return undefined
  }
}

export interface VerifyResult {
  clean: boolean
  /** Identifying fields exifr still finds. */
  remaining: Field[]
  /** Metadata segments the byte scanner still finds. */
  remainingSegments: Segment[]
  /** Harmless format info that stays (dimensions, JFIF version...). */
  structural: Field[]
}

/**
 * Re-read a cleaned file with both parsers. Only `clean: true` when neither
 * exifr nor the container scanner finds anything identifying.
 */
export async function verifyImage(bytes: Uint8Array): Promise<VerifyResult> {
  let report: ImageReport
  try {
    report = await readImageMetadata(bytes)
  } catch (err) {
    if (err instanceof ContainerError) {
      return { clean: false, remaining: [{ key: 'verify.error', group: 'other', label: 'Could not re-read file', value: err.message, risk: 'high' }], remainingSegments: [], structural: [] }
    }
    throw err
  }
  const remaining = report.fields.filter(isIdentifying)
  const remainingSegments = report.segments.filter(isIdentifyingSegment)
  return {
    clean: remaining.length === 0 && remainingSegments.length === 0,
    remaining,
    remainingSegments,
    structural: report.fields.filter((f) => !isIdentifying(f)),
  }
}
