import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { scanVideo, cleanVideo } from '../../src/lib/video'
import { FriendlyError } from '../../src/lib/handlers'

const fx = (n: string) => new Blob([readFileSync(resolve(import.meta.dirname, '../fixtures', n))])
const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Ask ffprobe (an independent parser) what tags and streams it sees. */
function probe(bytes: Uint8Array, ext: string) {
  const dir = mkdtempSync(join(tmpdir(), 'unpin-'))
  const path = join(dir, `out.${ext}`)
  writeFileSync(path, bytes)
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]).toString())
  // Decode every frame to prove the file still plays.
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'])
  return out
}

describe('video (MP4/MOV) metadata', () => {
  it('MP4: finds 3GPP location, artist, comment and the recording time', async () => {
    const s = await scanVideo(fx('gps.mp4'))
    expect(s.gps?.latitude).toBeCloseTo(40.7488, 3)
    expect(s.gps?.longitude).toBeCloseTo(-73.9854, 3)
    const l = Object.fromEntries(s.fields.map((f) => [f.label, f.value]))
    expect(l['Artist']).toBe('Jamie Doe')
    expect(l['Comment']).toBe('filmed from my balcony')
    expect(l['Recorded (file header)']).toBe('2024-06-01 08:14:22 UTC')
  })

  it('MOV: reads Apple QuickTime keys (location, make, model, software, date)', async () => {
    const s = await scanVideo(fx('gps.mov'))
    expect(s.kind).toBe('mov')
    expect(s.gps).toEqual({ latitude: 40.7488, longitude: -73.9854, altitude: 44.3 })
    const l = Object.fromEntries(s.fields.map((f) => [f.label, f.value]))
    expect(l['Phone / camera maker']).toBe('Apple')
    expect(l['Phone / camera model']).toBe('iPhone 15')
    expect(l['Software']).toBe('17.5')
    expect(l['Recorded']).toBe('2024-06-01T08:14:22-0400')
  })

  for (const [name, ext] of [['gps.mp4', 'mp4'], ['gps.mov', 'mov']] as const) {
    it(`${ext.toUpperCase()}: cleans in place, same size, verified, and still plays`, async () => {
      const original = fx(name)
      const res = await cleanVideo(original, 1)
      expect(res.name).toBe(`unpinned-1.${ext}`)
      expect(res.blob.size).toBe(original.size) // nothing moved
      expect(res.verify.remaining).toEqual([])
      expect(res.verify.clean).toBe(true)
      const bytes = new Uint8Array(await res.blob.arrayBuffer())
      const raw = new TextDecoder('latin1').decode(bytes)
      for (const leak of ['Jamie Doe', '+40.7488', 'iPhone 15', 'balcony', 'quicktime.location']) expect(raw).not.toContain(leak)
      if (hasFfprobe) {
        const p = probe(bytes, ext)
        const tags = Object.keys(p.format.tags ?? {}).filter((k) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k))
        expect(tags).toEqual([])
        expect(p.streams[0].codec_name).toBe('h264')
        expect(p.streams[0].tags?.creation_time).toBeUndefined()
        expect(Number(p.format.duration)).toBeCloseTo(1, 0)
      }
    })
  }

  it('large files: only the small index is read, so 100 MB cleans in well under a second', async () => {
    const mov = new Uint8Array(await fx('gps.mov').arrayBuffer())
    const moovAt = 1759 + 20 + 8 // ftyp(20) + wide(8) + mdat(1759) in the fixture
    const big = 100 * 1024 * 1024
    const header = new Uint8Array(8)
    new DataView(header.buffer).setUint32(0, big + 8)
    header.set([0x6d, 0x64, 0x61, 0x74], 4) // 'mdat'
    const file = new Blob([mov.subarray(0, 28), header, new Uint8Array(big), mov.subarray(moovAt)])
    const t0 = performance.now()
    const res = await cleanVideo(file, 1)
    const ms = performance.now() - t0
    console.log(`100 MB video cleaned in ${ms.toFixed(0)} ms`)
    expect(res.verify.clean).toBe(true)
    expect(res.blob.size).toBe(file.size)
    expect(ms).toBeLessThan(1500)
  })

  it('a non-video file gives a plain-language error', async () => {
    const err = await scanVideo(fx('sample.pdf')).catch((e) => e)
    expect(err).toBeInstanceOf(FriendlyError)
  })

  it('a video cut off before its index is refused rather than half-cleaned', async () => {
    const full = new Uint8Array(await fx('gps.mov').arrayBuffer())
    const cut = new Blob([full.subarray(0, 1800)]) // mov has mdat before moov
    const err = await scanVideo(cut).catch((e) => e)
    expect(err).toBeInstanceOf(FriendlyError)
  })
})
