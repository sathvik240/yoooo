import { readImageMetadata } from './imageMeta'
import { stripImage } from './strip'
import { ContainerError } from './containers'
import { FriendlyError, filenameFinding, type CleanResult, type Findings } from './handlers'
import { sortFields } from './fields'
import type { Stroke } from './redact'

export async function readImage(file: File): Promise<Findings> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let image
  try {
    image = await readImageMetadata(bytes)
  } catch (err) {
    if (err instanceof ContainerError) {
      throw new FriendlyError(
        'This image looks damaged or only partly downloaded, so we can’t read it safely.',
        'Open it in your photo app and save or export a fresh copy, then drop that copy here.',
      )
    }
    throw err
  }
  const fields = [...image.fields]
  const fn = filenameFinding(file.name)
  if (fn) fields.push(fn)
  const notes: string[] = []
  if (image.kind === 'gif') notes.push('GIF animations are saved as a single still PNG frame.')
  return { fields: sortFields(fields), image, notes }
}

export async function cleanImage(file: File, index: number, strokes?: Stroke[]): Promise<CleanResult> {
  const res = await stripImage(file, { index, strokes })
  return {
    blob: res.blob,
    name: res.name,
    ms: res.ms,
    width: res.width,
    height: res.height,
    removed: [],
    verify: { clean: res.verify.clean, remaining: [...res.verify.remaining], structural: res.verify.structural, notes: res.verify.remainingSegments.map((s) => `Still present: ${s.label}`) },
  }
}
