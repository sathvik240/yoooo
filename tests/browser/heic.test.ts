import { describe, it, expect } from 'vitest'
import exifr from 'exifr'
import { readImageMetadata } from '../../src/lib/imageMeta'
import { stripImage } from '../../src/lib/strip'
import { fixture, bytesOf } from './helpers'

describe('HEIC (iPhone photos)', () => {
  it('reads GPS and device info from a HEIC file', async () => {
    const r = await readImageMetadata(await bytesOf(await fixture('gps.heic')))
    expect(r.kind).toBe('heic')
    expect(r.gps?.latitude).toBeCloseTo(40.7488, 3)
    expect(r.fields.some((f) => f.value === 'Pixelphone 9 Pro')).toBe(true)
  })

  it('converts with the lazily loaded decoder and outputs a clean JPEG', async () => {
    const res = await stripImage(await fixture('gps.heic'), { index: 5 })
    expect(res.name).toBe('unpinned-5.jpg')
    expect(res.blob.type).toBe('image/jpeg')
    expect([res.width, res.height]).toEqual([64, 48])
    expect(res.verify.clean).toBe(true)
    expect(await exifr.gps(await bytesOf(res.blob))).toBeUndefined()
  })
})
