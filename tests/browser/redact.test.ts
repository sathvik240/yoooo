import { describe, it, expect } from 'vitest'
import { applyStroke, renderRedacted, type Stroke } from '../../src/lib/redact'
import { stripImage } from '../../src/lib/strip'
import { fixture, pixelAt } from './helpers'

/** A noisy test card so blur/pixelate have detail to destroy. */
function card(w = 200, h = 150): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    ctx.fillStyle = (x + y) % 4 === 0 ? '#ffffff' : '#000000'
    ctx.fillRect(x, y, 2, 2)
  }
  return c
}

const dot = (mode: Stroke['mode'], x: number, y: number, p = 0.5): Stroke => ({ mode, size: 0.2, points: [{ x, y, p }] })

function variance(c: OffscreenCanvas, x: number, y: number, w: number, h: number) {
  const d = c.getContext('2d')!.getImageData(x, y, w, h).data
  let sum = 0, sq = 0, n = 0
  for (let i = 0; i < d.length; i += 4) { sum += d[i]; sq += d[i] * d[i]; n++ }
  const mean = sum / n
  return sq / n - mean * mean
}

describe('redaction brush', () => {
  it('cover replaces pixels with solid ink, fully opaque', () => {
    const c = card()
    applyStroke(c, dot('cover', 0.5, 0.5))
    const px = c.getContext('2d')!.getImageData(100, 75, 1, 1).data
    expect([px[0], px[1], px[2], px[3]]).toEqual([0x17, 0x18, 0x1c, 255])
  })

  it('pixelate and blur destroy detail inside the stroke but not outside', () => {
    for (const mode of ['pixelate', 'blur'] as const) {
      const c = card()
      const before = variance(c, 95, 70, 10, 10)
      applyStroke(c, dot(mode, 0.5, 0.5))
      expect(variance(c, 95, 70, 10, 10), mode).toBeLessThan(before * 0.25)
      expect(variance(c, 2, 2, 10, 10), mode).toBeCloseTo(before, -2) // untouched corner
    }
  })

  it('pen pressure makes strokes wider', () => {
    const light = card(), firm = card()
    applyStroke(light, dot('cover', 0.5, 0.5, 0.05))
    applyStroke(firm, dot('cover', 0.5, 0.5, 1))
    const isInk = (c: OffscreenCanvas, x: number) => c.getContext('2d')!.getImageData(x, 75, 1, 1).data[3] === 255 && c.getContext('2d')!.getImageData(x, 75, 1, 1).data[0] === 0x17
    // brush is 20% of 200px = 40px wide at full pressure, ~15px at light pressure
    expect(isInk(firm, 100 + 17)).toBe(true)
    expect(isInk(light, 100 + 17)).toBe(false)
  })

  it('later blur over an earlier cover keeps the area covered', () => {
    const c = card()
    renderRedacted(card(), 200, 150, [dot('cover', 0.5, 0.5), dot('blur', 0.5, 0.5)], c)
    const px = c.getContext('2d')!.getImageData(100, 75, 1, 1).data
    expect(px[0]).toBeLessThan(40)
  })

  it('redactions are baked into the exported, verified-clean file', async () => {
    // gps.jpg is 64x48: sky blue on top. Cover the middle of the sky.
    const res = await stripImage(await fixture('gps.jpg'), { index: 1, strokes: [{ mode: 'cover', size: 0.3, points: [{ x: 0.2, y: 0.25, p: 0.5 }] }] })
    expect(res.verify.clean).toBe(true)
    const [r, g, b] = await pixelAt(res.blob, 13, 12)
    expect(r + g + b).toBeLessThan(120) // ink, not sky blue
    const [, , bOut] = await pixelAt(res.blob, 2, 2)
    expect(bOut).toBeGreaterThan(120) // outside the stroke is still sky
  })
})
