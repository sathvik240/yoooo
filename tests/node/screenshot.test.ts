import { describe, it, expect } from 'vitest'
import { detectScreenshot, isScreenSize, looksLikeStatusBar } from '../../src/lib/screenshot'

const base = { kind: 'png' as const, hasCameraExif: false, userComment: undefined, fields: [] }

describe('screenshot detection', () => {
  it('knows common screen sizes in both orientations', () => {
    expect(isScreenSize(1170, 2532)).toBe(true)
    expect(isScreenSize(2532, 1170)).toBe(true)
    expect(isScreenSize(1920, 1080)).toBe(true)
    expect(isScreenSize(4032, 3024)).toBe(false) // a 12 MP photo
  })

  it('flags an iPhone-sized PNG with no camera data', () => {
    const v = detectScreenshot(base, 1170, 2532, true)
    expect(v.isScreenshot).toBe(true)
    expect(v.reasons.join(' ')).toMatch(/1170×2532/)
  })

  it('trusts the iOS "Screenshot" marker even at odd sizes', () => {
    expect(detectScreenshot({ ...base, kind: 'jpeg', userComment: 'Screenshot' }, 1000, 1000, false).isScreenshot).toBe(true)
  })

  it('does not flag a camera photo, even at a screen-like size', () => {
    expect(detectScreenshot({ ...base, kind: 'jpeg', hasCameraExif: true }, 1920, 1080, false).isScreenshot).toBe(false)
  })

  it('does not flag a random image without signals', () => {
    expect(detectScreenshot({ ...base, kind: 'jpeg' }, 800, 600, false).isScreenshot).toBe(false)
  })

  it('status bar heuristic: flat strip with a few marks yes, gradient no', () => {
    const w = 100, h = 200
    const flat = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let x = 5; x < 15; x++) for (let y = 1; y < 6; y++) flat.set([0, 0, 0, 255], (y * w + x) * 4)
    expect(looksLikeStatusBar(flat, w, h)).toBe(true)
    const grad = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) grad.set([(i * 7) % 256, (i * 3) % 256, (i * 11) % 256, 255], i * 4)
    expect(looksLikeStatusBar(grad, w, h)).toBe(false)
  })
})
