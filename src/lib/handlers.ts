/**
 * A common shape for every file type Unpin handles, so the UI can treat
 * photos, PDFs, Office files and videos the same way.
 */
import type { Field } from './fields'
import type { ImageReport } from './imageMeta'

export type FileFamily = 'image' | 'pdf' | 'office' | 'video' | 'unsupported'

export interface Findings {
  fields: Field[]
  /** Photos only */
  image?: ImageReport
  /** Plain warnings that aren't fields (e.g. "tracked changes still contain deleted text"). */
  notes: string[]
}

export interface Verification {
  clean: boolean
  remaining: Field[]
  /** Harmless info that intentionally stays (dimensions, page count...). */
  structural: Field[]
  /** Extra caveats discovered while verifying. */
  notes: string[]
}

export interface CleanResult {
  blob: Blob
  name: string
  verify: Verification
  ms: number
  width?: number
  height?: number
  /** What was removed, for the scrub animation. */
  removed: Field[]
}

export class FriendlyError extends Error {
  constructor(
    message: string,
    public hint: string,
  ) {
    super(message)
    this.name = 'FriendlyError'
  }
}

const OFFICE_EXT = /\.(docx|docm|xlsx|xlsm|pptx|pptm)$/i
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|3gp)$/i

export function familyOf(file: File, head: Uint8Array): FileFamily {
  const t = file.type
  const n = file.name
  const magic = sniffFamily(head)
  if (magic) return magic === 'zip' ? (OFFICE_EXT.test(n) ? 'office' : 'unsupported') : magic
  if (t.startsWith('image/') || IMAGE_EXT.test(n)) return 'image'
  if (t === 'application/pdf' || /\.pdf$/i.test(n)) return 'pdf'
  if (OFFICE_EXT.test(n)) return 'office'
  if (t.startsWith('video/') || VIDEO_EXT.test(n)) return 'video'
  return 'unsupported'
}

function sniffFamily(b: Uint8Array): FileFamily | 'zip' | null {
  if (b.length < 12) return null
  const s = String.fromCharCode(...b.subarray(0, 12))
  if (b[0] === 0xff && b[1] === 0xd8) return 'image'
  if (s.startsWith('\x89PNG') || s.startsWith('GIF8') || (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP')) return 'image'
  if (s.startsWith('%PDF-')) return 'pdf'
  if (s.startsWith('PK\x03\x04')) return 'zip'
  if (s.slice(4, 8) === 'ftyp') {
    const brand = s.slice(8, 12)
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return 'image'
    return 'video'
  }
  return null
}

/** Filenames leak too: camera names like IMG_20240601_081422 contain a timestamp. */
export function filenameFinding(name: string): Field | null {
  const base = name.replace(/\.[^.]+$/, '')
  const date = base.match(/(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?([0-2]\d|3[01])(?:[-_ T]?([01]\d|2[0-3])[-_.]?([0-5]\d)[-_.]?([0-5]\d))?/)
  const words = /[A-Za-z]{4,}/.test(base.replace(/(?<![A-Za-z])(IMG|DSC|DSCN|PXL|VID|MVIMG|Screenshot|Screen Shot|Photo|image|scan|copy|edit|edited|final|untitled|document|export)(?![A-Za-z])/gi, ''))
  if (!date && !words) return null
  return {
    key: 'file.name',
    group: 'other',
    label: 'File name',
    value: name,
    risk: date ? 'medium' : 'low',
    why: date
      ? 'The name contains a date and time. Your clean copy gets a neutral name instead.'
      : 'File names can contain names or places. Your clean copy gets a neutral name instead.',
  }
}
