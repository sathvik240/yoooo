/**
 * Redaction rendering. Pure canvas code that runs on the main thread (live
 * preview at screen size) and in the worker (full-size export), so the same
 * strokes produce the same result at any resolution.
 *
 * Blur and pixelate are both *destructive*: the region is shrunk to a handful
 * of pixels and scaled back up, so the original detail is gone from the file
 * and can't be "un-blurred". Strokes are always fully opaque; pen pressure
 * changes width and strength, never transparency.
 */

export type RedactMode = 'blur' | 'pixelate' | 'cover'

export interface StrokePoint {
  /** 0..1, relative to image width */
  x: number
  /** 0..1, relative to image height */
  y: number
  /** 0..1 pen pressure; mouse/touch use 0.5 */
  p: number
}

export interface Stroke {
  mode: RedactMode
  /** Brush diameter as a fraction of the image's longer side. */
  size: number
  points: StrokePoint[]
}

type Canvas = OffscreenCanvas | HTMLCanvasElement
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export const COVER_COLOR = '#17181c'

function make(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const ctx2d = (c: Canvas) => c.getContext('2d') as Ctx

/** Width multiplier from pressure: light touch = thinner, firm = full. */
export const widthFor = (p: number) => 0.35 + 0.65 * Math.min(1, Math.max(0, p))

/** Strength multiplier: firmer pressure = bigger blocks / heavier blur. */
const strengthFor = (stroke: Stroke) => {
  const maxP = stroke.points.reduce((m, pt) => Math.max(m, pt.p), 0)
  return 1 + 1.6 * maxP
}

function strokeBounds(stroke: Stroke, w: number, h: number, pad: number) {
  const long = Math.max(w, h)
  const r = (stroke.size * long) / 2 + pad
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const pt of stroke.points) {
    x0 = Math.min(x0, pt.x * w); y0 = Math.min(y0, pt.y * h)
    x1 = Math.max(x1, pt.x * w); y1 = Math.max(y1, pt.y * h)
  }
  const bx = Math.max(0, Math.floor(x0 - r)), by = Math.max(0, Math.floor(y0 - r))
  const bw = Math.min(w, Math.ceil(x1 + r)) - bx, bh = Math.min(h, Math.ceil(y1 + r)) - by
  return { x: bx, y: by, w: bw, h: bh }
}

/** Draw the stroke shape (opaque) into ctx, offset by (-ox, -oy). */
function drawShape(ctx: Ctx, stroke: Stroke, w: number, h: number, ox: number, oy: number) {
  const long = Math.max(w, h)
  const base = stroke.size * long
  ctx.fillStyle = ctx.strokeStyle = '#000'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const pts = stroke.points
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x * w - ox, pts[0].y * h - oy, (base * widthFor(pts[0].p)) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // Segment by segment so the width can follow pressure along the stroke.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    ctx.lineWidth = base * widthFor((a.p + b.p) / 2)
    ctx.beginPath()
    ctx.moveTo(a.x * w - ox, a.y * h - oy)
    ctx.lineTo(b.x * w - ox, b.y * h - oy)
    ctx.stroke()
  }
}

/** Apply one stroke to the canvas in place, touching only its bounding box. */
export function applyStroke(target: Canvas, stroke: Stroke): void {
  if (!stroke.points.length) return
  const W = target.width, H = target.height
  const long = Math.max(W, H)
  const block = Math.max(4, Math.round((long / 90) * strengthFor(stroke)))
  const b = strokeBounds(stroke, W, H, block * 2)
  if (b.w <= 0 || b.h <= 0) return
  const tctx = ctx2d(target)

  // 1. Effect layer for the bounding box, computed from the current pixels
  //    (so a blur over an earlier cover never reveals what's underneath).
  const fx = make(b.w, b.h)
  const fctx = ctx2d(fx)
  if (stroke.mode === 'cover') {
    fctx.fillStyle = COVER_COLOR
    fctx.fillRect(0, 0, b.w, b.h)
  } else {
    const sw = Math.max(1, Math.round(b.w / block)), sh = Math.max(1, Math.round(b.h / block))
    const small = make(sw, sh)
    const sctx = ctx2d(small)
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(target, b.x, b.y, b.w, b.h, 0, 0, sw, sh)
    if (stroke.mode === 'pixelate') {
      fctx.imageSmoothingEnabled = false
      fctx.drawImage(small, 0, 0, sw, sh, 0, 0, b.w, b.h)
    } else {
      // Blur: upscale through an intermediate size for a soft, even result.
      const mw = Math.max(1, sw * 3), mh = Math.max(1, sh * 3)
      const mid = make(mw, mh)
      const mctx = ctx2d(mid)
      mctx.imageSmoothingEnabled = true
      mctx.imageSmoothingQuality = 'high'
      mctx.drawImage(small, 0, 0, mw, mh)
      fctx.imageSmoothingEnabled = true
      fctx.imageSmoothingQuality = 'high'
      fctx.drawImage(mid, 0, 0, b.w, b.h)
    }
  }

  // 2. Keep the effect only where the brush went. The whole stroke is drawn
  //    into one mask first; masking segment by segment would intersect them.
  const mask = make(b.w, b.h)
  drawShape(ctx2d(mask), stroke, W, H, b.x, b.y)
  fctx.globalCompositeOperation = 'destination-in'
  fctx.drawImage(mask, 0, 0)

  // 3. Composite back. The mask is opaque, so covered pixels are fully replaced.
  tctx.drawImage(fx, b.x, b.y)
}

/** Draw `source` at w×h and apply all strokes. */
export function renderRedacted(source: CanvasImageSource, w: number, h: number, strokes: Stroke[], into?: Canvas): Canvas {
  const c = into ?? make(w, h)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = ctx2d(c)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  for (const s of strokes) applyStroke(c, s)
  return c
}
