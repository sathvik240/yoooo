import exifr from 'exifr'
import { decode, encodeBitmap, extensionFor, outputTypeFor, DecodeError, type OutputType } from './encode'
import { verifyImage, type VerifyResult } from './imageMeta'
import { sniff, storedDimensions } from './containers'
import type { StripRequest, StripResponse } from '../workers/strip.worker'
import { FriendlyError } from './handlers'

export interface StripResult {
  blob: Blob
  name: string
  width: number
  height: number
  verify: VerifyResult
  ms: number
}

export class StripError extends FriendlyError {
  name = 'StripError'
}

// ---------------------------------------------------------------------------
// Worker plumbing: one shared worker, requests matched by id. Falls back to the
// main thread if workers or OffscreenCanvas aren't available.

let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, (r: StripResponse) => void>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return (worker = null)
  try {
    worker = new Worker(new URL('../workers/strip.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<StripResponse>) => {
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
    worker.onerror = () => {
      // A worker that can't start (e.g. strict CSP) shouldn't break cleaning.
      for (const [id, done] of pending) done({ id, ok: false, error: 'worker failed', decode: false })
      pending.clear()
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

async function encodeOnMainThread(source: Blob | ImageBitmap, type: OutputType, quality?: number) {
  const bitmap = source instanceof Blob ? await decode(source) : source
  const { width, height } = bitmap
  const blob = await encodeBitmap(bitmap, { type, quality })
  bitmap.close()
  return { blob, width, height }
}

export const usingWorker = () => getWorker() !== null

async function encode(source: Blob | ImageBitmap, type: OutputType, quality?: number) {
  const w = getWorker()
  if (!w) return encodeOnMainThread(source, type, quality)
  const id = nextId++
  const res = await new Promise<StripResponse>((resolve) => {
    pending.set(id, resolve)
    const msg: StripRequest = { id, source, type, quality }
    w.postMessage(msg, source instanceof ImageBitmap ? [source] : [])
  })
  if (res.ok) return { blob: res.blob, width: res.width, height: res.height }
  if (res.decode) throw new DecodeError(res.error)
  if (res.error === 'worker failed' && !(source instanceof ImageBitmap)) return encodeOnMainThread(source, type, quality)
  throw new Error(res.error)
}

// ---------------------------------------------------------------------------

export interface StripOptions {
  /** 1-based position used in the neutral output name. */
  index: number
  /** Redacted pixels to encode instead of the original file. */
  pixels?: ImageBitmap
  quality?: number
}

/**
 * Re-encode an image from its pixels only, then verify the result with two
 * independent parsers. Throws StripError with a fix-it hint on failure.
 */
export async function stripImage(file: Blob, opts: StripOptions): Promise<StripResult> {
  const t0 = performance.now()
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const kind = sniff(head)
  let source: Blob = file
  let mime = file.type || mimeFromKind(kind)

  if (kind === 'heic' || kind === 'avif' || mime === 'image/heic' || mime === 'image/heif') {
    if (!opts.pixels) source = await heicToDecodable(file)
    mime = 'image/jpeg'
  }

  const wanted = outputTypeFor(mime)
  let result: { blob: Blob; width: number; height: number }
  try {
    result = await encode(opts.pixels ?? source, wanted, opts.quality)
  } catch (err) {
    if (err instanceof DecodeError) {
      throw new StripError(
        'This file couldn’t be opened as an image. It may be damaged or only partly downloaded.',
        'Try opening it in your photo app and saving or exporting a fresh copy, then drop that copy here.',
      )
    }
    throw new StripError(
      'Your browser ran out of room while cleaning this image.',
      'Close other tabs and try again. On a phone, try one photo at a time.',
    )
  }

  // Safety net for engines that ignore imageOrientation: if EXIF said "rotate
  // 90°" but the decoded size matches the stored size, rotate it ourselves.
  if (!opts.pixels && kind === 'jpeg') {
    result = await fixOrientationIfIgnored(file, result, wanted, opts.quality)
  }

  const bytes = new Uint8Array(await result.blob.arrayBuffer())
  const verify = await verifyImage(bytes)
  const ext = extensionFor(result.blob.type || wanted)
  return {
    blob: result.blob,
    name: `unpinned-${opts.index}.${ext}`,
    width: result.width,
    height: result.height,
    verify,
    ms: performance.now() - t0,
  }
}

function mimeFromKind(kind: string): string {
  return { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif' }[kind] ?? 'application/octet-stream'
}

async function fixOrientationIfIgnored(file: Blob, result: { blob: Blob; width: number; height: number }, type: OutputType, quality?: number) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const stored = storedDimensions(bytes)
  if (!stored || stored.width === stored.height) return result
  const orientation = await exifr.orientation(bytes).catch(() => undefined)
  const swaps = typeof orientation === 'number' && orientation >= 5 && orientation <= 8
  if (!swaps || result.width !== stored.width) return result
  // Orientation was not applied. Redraw with the transform ourselves.
  const raw = await createImageBitmap(file)
  const { rotateBitmap } = await import('./orient')
  const rotated = await rotateBitmap(raw, orientation)
  raw.close()
  return encodeOnMainThread(rotated, type, quality)
}

/** Lazy-load the HEIC decoder only when someone actually picks a HEIC file. */
async function heicToDecodable(file: Blob): Promise<Blob> {
  // Safari decodes HEIC natively; try that first and skip the 1 MB download.
  try {
    const bmp = await createImageBitmap(file)
    bmp.close()
    return file
  } catch {
    /* not supported natively */
  }
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob: file, toType: 'image/png' })
    return Array.isArray(out) ? out[0] : out
  } catch {
    throw new StripError(
      'This HEIC photo couldn’t be converted in your browser.',
      'On iPhone, go to Settings → Camera → Formats and choose “Most Compatible”, or share the photo to yourself as JPEG, then try again.',
    )
  }
}
