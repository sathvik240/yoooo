import { makeCanvas } from './encode'

/**
 * Apply an EXIF orientation (1–8) to a bitmap that was decoded without it.
 * Only used as a fallback; modern browsers apply orientation while decoding.
 */
export async function rotateBitmap(src: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  const { width: w, height: h } = src
  const swap = orientation >= 5
  const canvas = makeCanvas(swap ? h : w, swap ? w : h)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  // Standard EXIF orientation transforms.
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break
    case 7: ctx.transform(0, -1, -1, 0, h, w); break
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break
  }
  ctx.drawImage(src, 0, 0)
  return createImageBitmap(canvas)
}
