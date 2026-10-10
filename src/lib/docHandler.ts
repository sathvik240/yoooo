import { readPdf, cleanPdf } from './pdf'
import { readOffice, cleanOffice, type ImageCleaner } from './office'
import { stripImage } from './strip'
import type { CleanResult, Findings } from './handlers'
import { filenameFinding } from './handlers'
import { sortFields } from './fields'

const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
}

export const officeExt = (name: string) => (name.match(/\.(docx|docm|xlsx|xlsm|pptx|pptm)$/i)?.[1] ?? 'docx').toLowerCase()

/** Re-encode a photo embedded in a document, keeping its format. */
const browserImageCleaner: ImageCleaner = async (bytes, name) => {
  const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
  try {
    const res = await stripImage(new Blob([bytes as BlobPart], { type }), { index: 0 })
    if (!res.verify.clean || res.blob.type !== type) return null
    return new Uint8Array(await res.blob.arrayBuffer())
  } catch {
    return null
  }
}

function withName(f: Findings, name: string): Findings {
  const fn = filenameFinding(name)
  return fn ? { ...f, fields: sortFields([...f.fields, fn]) } : f
}

export async function readDocument(file: File, family: 'pdf' | 'office'): Promise<Findings> {
  const f = family === 'pdf' ? await readPdf(file) : await readOffice(file, { cleanImage: browserImageCleaner })
  return withName(f, file.name)
}

export async function cleanDocument(file: File, family: 'pdf' | 'office', index: number): Promise<CleanResult> {
  if (family === 'pdf') return cleanPdf(file, index)
  const ext = officeExt(file.name)
  const typed = new Blob([await file.arrayBuffer()], { type: OFFICE_TYPES[ext] })
  return cleanOffice(typed, index, ext, { cleanImage: browserImageCleaner })
}
