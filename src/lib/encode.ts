/**
 * Pixel-level re-encoding. Works in a Worker (OffscreenCanvas) or on the main
 * thread (HTMLCanvasElement). Drawing to a canvas and exporting keeps only
 * pixels: every EXIF/XMP/IPTC block, thumbnail and trailing chunk is left behind.
 */

export type OutputType = 'image/jpeg' | 'image/png' | 'image/webp'

export const JPEG_QUALITY = 0.92

export interface EncodeOptions {
  type: OutputType
  quality?: number
}

export class DecodeError extends Error {
  name = 'DecodeError'
}

/**
 * Decode with EXIF orientation applied to the pixels, so the cleaned image is
 * upright even though the Orientation tag is gone.
 */
export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch (err) {
    // Older engines only know 'none' | 'flipY' and reject 'from-image'; they
    // apply orientation by default, so retry without options.
    if (err instanceof TypeError) {
      try {
        return await createImageBitmap(blob)
      } catch {
        /* fall through */
      }
    }
    throw new DecodeError('This file could not be opened as an image.')
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

export async function canvasToBlob(canvas: AnyCanvas, opts: EncodeOptions): Promise<Blob> {
  const quality = opts.type === 'image/png' ? undefined : (opts.quality ?? JPEG_QUALITY)
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: opts.type, quality })
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), opts.type, quality),
  )
}

/**
 * Draw a bitmap onto a fresh canvas and export. JPEG has no alpha, so we
 * flatten onto white rather than letting transparent pixels turn black.
 */
export async function encodeBitmap(bitmap: ImageBitmap, opts: EncodeOptions): Promise<Blob> {
  const canvas = makeCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Your browser could not create a drawing surface. Try closing other tabs and retry.')
  if (opts.type === 'image/jpeg') {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, bitmap.width, bitmap.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  const blob = await canvasToBlob(canvas, opts)
  // Release the backing store early; phones run out of canvas memory fast.
  canvas.width = canvas.height = 1
  return blob
}

/** Output type for a given input type. Some browsers can't encode WebP; caller checks blob.type. */
export function outputTypeFor(mime: string): OutputType {
  if (mime === 'image/png' || mime === 'image/gif') return 'image/png'
  if (mime === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

export function extensionFor(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}
