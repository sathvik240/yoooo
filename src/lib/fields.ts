/**
 * Turns raw exifr output into plain-language findings.
 */

export type Group = 'location' | 'time' | 'device' | 'people' | 'place' | 'software' | 'camera' | 'image' | 'other'
export type Risk = 'high' | 'medium' | 'low'

export interface Field {
  /** Stable key, e.g. "gps.GPSLatitude" */
  key: string
  group: Group
  label: string
  value: string
  risk: Risk
  /** One-line plain explanation of why this matters. */
  why?: string
}

export const GROUP_LABEL: Record<Group, string> = {
  location: 'Location',
  time: 'When',
  device: 'Device',
  people: 'Who',
  place: 'Place names',
  software: 'Software',
  camera: 'Camera settings',
  image: 'Image format',
  other: 'Other data',
}

export const GROUP_ORDER: Group[] = ['location', 'people', 'place', 'time', 'device', 'software', 'camera', 'other', 'image']

interface Rule {
  group: Group
  label: string
  risk: Risk
  why?: string
}

const R = (group: Group, label: string, risk: Risk, why?: string): Rule => ({ group, label, risk, why })

/** Known tags, matched by tag name regardless of which segment they came from. */
const RULES: Record<string, Rule> = {
  latitude: R('location', 'Latitude', 'high', 'Together with longitude, this pins the spot the photo was taken, often to a single building.'),
  longitude: R('location', 'Longitude', 'high'),
  GPSAltitude: R('location', 'Altitude', 'medium', 'Can reveal which floor of a building you were on.'),
  GPSImgDirection: R('location', 'Camera direction', 'medium', 'Which way you were facing.'),
  GPSSpeed: R('location', 'Speed', 'low'),
  GPSDateStamp: R('time', 'GPS date', 'medium'),
  GPSTimeStamp: R('time', 'GPS time (UTC)', 'medium'),
  GPSHPositioningError: R('location', 'GPS accuracy', 'low'),
  GPSAreaInformation: R('location', 'Area', 'high'),
  GPSProcessingMethod: R('location', 'Location method', 'low'),

  DateTimeOriginal: R('time', 'Taken', 'medium', 'The exact moment you took the photo. Posting it later doesn’t hide when you were there.'),
  CreateDate: R('time', 'Created', 'medium'),
  ModifyDate: R('time', 'Modified', 'low'),
  DateCreated: R('time', 'Created', 'medium'),
  DateTimeDigitized: R('time', 'Digitized', 'low'),
  OffsetTime: R('time', 'Time zone', 'medium', 'Narrows down which part of the world you live in.'),
  OffsetTimeOriginal: R('time', 'Time zone', 'medium', 'Narrows down which part of the world you live in.'),
  OffsetTimeDigitized: R('time', 'Time zone (digitized)', 'low'),
  SubSecTimeOriginal: R('time', 'Sub-second time', 'low'),
  TimeCreated: R('time', 'Time created', 'medium'),

  Make: R('device', 'Phone / camera maker', 'medium'),
  Model: R('device', 'Phone / camera model', 'medium', 'Narrows down who could have taken it, and links photos taken on the same device.'),
  LensModel: R('device', 'Lens', 'low'),
  LensMake: R('device', 'Lens maker', 'low'),
  LensSerialNumber: R('device', 'Lens serial number', 'high', 'A unique ID that links every photo from this lens back to one owner.'),
  SerialNumber: R('device', 'Camera serial number', 'high', 'A unique ID that links every photo you’ve ever shared from this camera.'),
  BodySerialNumber: R('device', 'Camera serial number', 'high', 'A unique ID that links every photo you’ve ever shared from this camera.'),
  InternalSerialNumber: R('device', 'Internal serial number', 'high', 'A unique ID that links photos from this device.'),
  ImageUniqueID: R('device', 'Unique image ID', 'medium', 'Can match this file to other copies of it.'),
  HostComputer: R('device', 'Computer', 'medium'),
  MakerNote: R('device', 'Maker notes', 'medium', 'Private manufacturer data. Often includes serial numbers and settings.'),

  Artist: R('people', 'Artist', 'high', 'Your name, written into the file.'),
  OwnerName: R('people', 'Camera owner', 'high', 'Your name, written into the file.'),
  CameraOwnerName: R('people', 'Camera owner', 'high', 'Your name, written into the file.'),
  Copyright: R('people', 'Copyright', 'high', 'Often contains your full name.'),
  XPAuthor: R('people', 'Author', 'high'),
  Author: R('people', 'Author', 'high'),
  creator: R('people', 'Creator', 'high', 'Your name, written into the file.'),
  Byline: R('people', 'By-line', 'high', 'Your name, written into the file.'),
  Credit: R('people', 'Credit', 'high'),
  rights: R('people', 'Rights', 'medium'),
  Contact: R('people', 'Contact', 'high'),
  CreatorContactInfo: R('people', 'Contact info', 'high'),
  PersonInImage: R('people', 'People tagged', 'high'),
  RegionInfo: R('people', 'Face regions', 'high', 'Names or positions of faces the phone recognised.'),
  Regions: R('people', 'Face regions', 'high', 'Names or positions of faces the phone recognised.'),

  City: R('place', 'City', 'high'),
  State: R('place', 'State / province', 'high'),
  ProvinceState: R('place', 'State / province', 'high'),
  Country: R('place', 'Country', 'medium'),
  CountryName: R('place', 'Country', 'medium'),
  CountryCode: R('place', 'Country code', 'medium'),
  Sublocation: R('place', 'Neighbourhood', 'high'),
  Location: R('place', 'Location', 'high'),

  Software: R('software', 'Software', 'low', 'Shows your OS version, which helps fingerprint your device.'),
  ProcessingSoftware: R('software', 'Processing software', 'low'),
  CreatorTool: R('software', 'Creator tool', 'low'),
  Comment: R('other', 'Comment', 'medium', 'Free text written into the file.'),
  UserComment: R('other', 'User comment', 'medium', 'Free text written into the file.'),
  ImageDescription: R('other', 'Description', 'medium'),
  description: R('other', 'Description', 'medium'),
  title: R('other', 'Title', 'medium'),
  Caption: R('other', 'Caption', 'medium'),
  Keywords: R('other', 'Keywords', 'medium'),
  subject: R('other', 'Keywords', 'medium'),
  DocumentID: R('device', 'Document ID', 'medium', 'Can link edited copies back to the original.'),
  OriginalDocumentID: R('device', 'Original document ID', 'medium', 'Can link edited copies back to the original.'),
  InstanceID: R('device', 'Instance ID', 'low'),

  ExposureTime: R('camera', 'Shutter speed', 'low'),
  FNumber: R('camera', 'Aperture', 'low'),
  ISO: R('camera', 'ISO', 'low'),
  FocalLength: R('camera', 'Focal length', 'low'),
  Flash: R('camera', 'Flash', 'low'),
  WhiteBalance: R('camera', 'White balance', 'low'),
  ExposureProgram: R('camera', 'Exposure program', 'low'),
  MeteringMode: R('camera', 'Metering', 'low'),
}

/**
 * Format-level fields that describe how to decode the pixels and identify
 * nobody. They are shown under "Image format" and are allowed to remain.
 */
export const STRUCTURAL_KEYS = new Set([
  'JFIFVersion', 'ResolutionUnit', 'XResolution', 'YResolution', 'ThumbnailWidth', 'ThumbnailHeight',
  'ImageWidth', 'ImageHeight', 'BitDepth', 'ColorType', 'Compression', 'Filter', 'Interlace',
])

/** Keys we never show (exifr internals / redundant). */
const SKIP_KEYS = new Set([
  'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef', 'GPSVersionID',
  'ThumbnailOffset', 'ThumbnailLength', 'ExifIFDPointer', 'GPSInfoPointer', 'InteropIFDPointer',
  'ExifVersion', 'FlashpixVersion', 'ComponentsConfiguration', 'InteroperabilityIndex', 'InteroperabilityVersion',
  'xmlns', 'about', 'xmptk',
])

/** Low-risk technical fields we still list so the count is honest. */
function fallbackRule(segment: string, key: string): Rule {
  if (/^GPS/.test(key)) return R('location', humanize(key.replace(/^GPS/, 'GPS ')), 'medium')
  if (/date|time/i.test(key)) return R('time', humanize(key), 'low')
  if (/serial/i.test(key)) return R('device', humanize(key), 'high', 'A unique ID that can link files to one device.')
  if (/owner|author|artist|creator|name/i.test(key)) return R('people', humanize(key), 'high')
  if (segment === 'exif' || segment === 'ifd0') return R('camera', humanize(key), 'low')
  return R('other', humanize(key), 'low')
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

export function formatValue(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? String(v) : formatDate(v)
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return `${formatBytes((v as Uint8Array).byteLength)} of binary data`
  if (Array.isArray(v)) return v.map(formatValue).join(', ')
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.every(([k]) => /^\d+$/.test(k))) return entries.map(([, x]) => formatValue(x)).join(', ')
    return entries.map(([k, x]) => `${k}: ${formatValue(x)}`).join('; ')
  }
  return String(v).replace(/\0+$/, '').trim()
}

/** exifr revives EXIF local times as if they were UTC; print them as written. */
function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`
}

/**
 * Flatten exifr's segmented output (mergeOutput: false) into Fields.
 * Duplicate labels with the same value are collapsed.
 */
export function toFields(raw: Record<string, unknown> | undefined | null): Field[] {
  if (!raw) return []
  const fields: Field[] = []
  const seen = new Set<string>()
  for (const [segment, block] of Object.entries(raw)) {
    if (!block || typeof block !== 'object' || block instanceof Uint8Array) continue
    for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue
      if (segment === 'ifd1') continue // thumbnail IFD; reported separately
      if (value === '' || value == null) continue
      if (key === 'Orientation') continue // applied to pixels, not identifying
      const structural = STRUCTURAL_KEYS.has(key) && (segment === 'jfif' || segment === 'ihdr' || segment === 'ifd0' || segment === 'exif')
      const rule: Rule = structural ? R('image', humanize(key), 'low') : RULES[key] ?? fallbackRule(segment, key)
      let text = formatValue(value)
      if (key === 'latitude' || key === 'longitude') text = (value as number).toFixed(6)
      if (key === 'GPSAltitude' && typeof value === 'number') text = `${value.toFixed(1)} m`
      if (key === 'ExposureTime' && typeof value === 'number' && value < 1) text = `1/${Math.round(1 / value)} s`
      if (key === 'FNumber' && typeof value === 'number') text = `f/${value}`
      if (!text) continue
      if (text.length > 160) text = text.slice(0, 157) + '…'
      const dedupe = `${rule.label}|${text}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      fields.push({ key: `${segment}.${key}`, group: rule.group, label: rule.label, value: text, risk: rule.risk, why: rule.why })
    }
  }
  return sortFields(fields)
}

export function sortFields(fields: Field[]): Field[] {
  const riskRank: Record<Risk, number> = { high: 0, medium: 1, low: 2 }
  return [...fields].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || riskRank[a.risk] - riskRank[b.risk],
  )
}

export function isIdentifying(f: Field): boolean {
  return f.group !== 'image'
}
