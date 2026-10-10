/**
 * "Is this a screenshot?" Screenshots leak differently from photos (names,
 * tabs, notifications), so they get their own warning list. Signals:
 *  - the OS marked it (iOS/macOS write "Screenshot" into the metadata)
 *  - no camera data (no make/model/exposure)
 *  - exact pixel size of a common phone, tablet or desktop screen
 *  - a status-bar-like strip at the top: mostly one flat colour with a few
 *    small high-contrast marks (clock, battery, signal)
 */
import type { ImageReport } from './imageMeta'

const SCREENS: [number, number][] = [
  // iPhone
  [750, 1334], [828, 1792], [1080, 1920], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868], [640, 1136],
  // Android
  [720, 1280], [720, 1600], [1080, 2160], [1080, 2220], [1080, 2280], [1080, 2340], [1080, 2400], [1080, 2408], [1080, 2412], [1440, 2560], [1440, 2960], [1440, 3040], [1440, 3088], [1440, 3120], [1440, 3200], [1344, 2992], [1280, 2856], [1220, 2712],
  // Tablets
  [1536, 2048], [1620, 2160], [1640, 2360], [1668, 2224], [1668, 2388], [2048, 2732], [1600, 2560], [1200, 1920], [1800, 2880],
  // Desktop / laptop
  [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440], [2560, 1600], [2560, 1664], [2880, 1800], [2880, 1864], [2940, 1912], [3024, 1964], [3440, 1440], [3456, 2234], [3840, 2160], [5120, 2880],
]

export function isScreenSize(w: number, h: number): boolean {
  return SCREENS.some(([a, b]) => (w === a && h === b) || (w === b && h === a))
}

/**
 * Look at the top strip of an image (RGBA pixels, already downscaled). A
 * status bar is mostly one flat colour with a little bit of crisp text/icons.
 */
export function looksLikeStatusBar(data: Uint8ClampedArray, width: number, height: number): boolean {
  const rows = Math.max(2, Math.round(height * 0.035))
  const counts = new Map<number, number>()
  let n = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      n++
    }
  }
  const dominant = Math.max(...counts.values()) / n
  // Photos have smooth gradients / texture at the top; status bars don't.
  return dominant > 0.8 && dominant < 0.995
}

export interface ScreenshotVerdict {
  isScreenshot: boolean
  reasons: string[]
}

export function detectScreenshot(r: Pick<ImageReport, 'kind' | 'hasCameraExif' | 'userComment' | 'fields'>, width: number, height: number, statusBar: boolean): ScreenshotVerdict {
  const reasons: string[] = []
  const marked = /screenshot/i.test(r.userComment ?? '') || r.fields.some((f) => /screenshot/i.test(f.value) && f.key !== 'file.name')
  const named = r.fields.some((f) => f.key === 'file.name' && /screen ?shot|screen_?cap|capture/i.test(f.value))
  if (marked) reasons.push('Your device labelled it as a screenshot.')
  if (named) reasons.push('The file name says it’s a screenshot.')
  const sized = isScreenSize(width, height)
  if (sized) reasons.push(`It’s exactly ${width}×${height}, the size of a common screen.`)
  if (!r.hasCameraExif) reasons.push('It has no camera information, so it wasn’t taken with a camera.')
  if (statusBar) reasons.push('The top edge looks like a phone status bar.')
  const isScreenshot = marked || named || (!r.hasCameraExif && (sized || (statusBar && r.kind === 'png')))
  return { isScreenshot, reasons: isScreenshot ? reasons : [] }
}
