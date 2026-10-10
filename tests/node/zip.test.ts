import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { zipFiles, ZIP_DATE } from '../../src/lib/zip'

describe('batch ZIP', () => {
  it('contains the cleaned files under neutral names with a fixed timestamp', async () => {
    const zipBlob = await zipFiles([
      { name: 'unpinned-1.jpg', blob: new Blob([new Uint8Array([1, 2, 3])]) },
      { name: 'unpinned-2.png', blob: new Blob([new Uint8Array([4, 5])]) },
    ])
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['unpinned-1.jpg', 'unpinned-2.png'])
    for (const f of Object.values(zip.files)) {
      // DOS dates have 2 s resolution and JSZip reads them back in local time.
      expect(Math.abs(f.date.getTime() - ZIP_DATE.getTime())).toBeLessThan(24 * 3600 * 1000)
      expect(f.date.getUTCFullYear()).toBeLessThanOrEqual(1980)
    }
    expect(Array.from(await zip.file('unpinned-1.jpg')!.async('uint8array'))).toEqual([1, 2, 3])
  })
})
