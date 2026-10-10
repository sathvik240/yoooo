import { svg } from './dom'
import { pinSvg } from './pin'
import { formatCoord } from '../lib/fields'
import { reducedMotion, sleep } from '../lib/motion'

/**
 * The location "reveal": a survey plate drawn entirely on this device. No map
 * tiles, no geocoding: the terrain is invented from a seeded noise field and
 * only the printed coordinates are real.
 *
 * The seed is coarsened so the drawing can't be reverse-engineered into a
 * position more precise than the coordinates already printed on screen.
 */
const W = 640
const H = 480
const COLS = 64
const ROWS = 48

export class ContourMap {
  readonly el: HTMLElement
  private svgEl: SVGSVGElement
  private pinGroup: SVGGElement
  private readout: HTMLElement
  private coordText: string

  constructor(lat: number, lon: number, altitude?: number) {
    this.coordText = formatCoord(lat, lon)
    const seed = Math.round(lat * 10) * 7919 + Math.round(lon * 10) * 104729
    const field = noiseField(seed)
    this.svgEl = svg('svg', { class: 'contour-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' })

    // Graticule
    const grid = svg('g', { class: 'graticule' })
    for (let x = 80; x < W; x += 80) grid.append(svg('line', { x1: x, y1: 0, x2: x, y2: H }))
    for (let y = 80; y < H; y += 80) grid.append(svg('line', { x1: 0, y1: y, x2: W, y2: y }))
    this.svgEl.append(grid)

    // Contours (marching squares), every 5th one is an "index" contour.
    const lines = svg('g', { class: 'contours' })
    const levels = 14
    for (let i = 1; i < levels; i++) {
      const level = i / levels
      const d = marchingSquares(field, level)
      if (!d) continue
      const path = svg('path', { d, class: i % 5 === 0 ? 'index' : '', pathLength: 1 })
      path.style.setProperty('--i', String(i))
      lines.append(path)
    }
    this.svgEl.append(lines)

    // Graticule labels with the real degrees/minutes around the pin.
    const labels = svg('g', { class: 'grid-labels' })
    const latLabel = dms(lat, 'NS')
    const lonLabel = dms(lon, 'EW')
    labels.append(svg('text', { x: 8, y: H / 2 - 6 }, latLabel))
    labels.append(svg('text', { x: W / 2 + 6, y: H - 10 }, lonLabel))
    this.svgEl.append(labels)

    // Crosshair + precision rings at the centre
    const cx = W / 2, cy = H / 2
    const target = svg('g', { class: 'target' })
    target.append(svg('line', { x1: cx - 26, y1: cy, x2: cx - 8, y2: cy }), svg('line', { x1: cx + 8, y1: cy, x2: cx + 26, y2: cy }))
    target.append(svg('line', { x1: cx, y1: cy - 26, x2: cx, y2: cy - 8 }), svg('line', { x1: cx, y1: cy + 8, x2: cx, y2: cy + 26 }))
    for (let r = 1; r <= 3; r++) target.append(svg('circle', { class: `ring ring-${r}`, cx, cy, r: 18 * r }))
    this.svgEl.append(target)

    // Scale bar (decorative but honest: the plate is not to any real scale)
    const scale = svg('g', { class: 'scale', transform: `translate(${W - 150}, ${H - 26})` })
    scale.append(svg('rect', { x: 0, y: 0, width: 60, height: 5 }), svg('rect', { x: 60, y: 0, width: 60, height: 5, class: 'hollow' }))
    scale.append(svg('text', { x: 0, y: -6 }, 'NOT TO SCALE'))
    this.svgEl.append(scale)

    // The pin
    this.pinGroup = svg('g', { class: 'map-pin-wrap' })
    const pin = pinSvg('pin')
    for (const [k, v] of Object.entries({ x: cx - 20, y: cy - 56, width: 40, height: 56 })) pin.setAttribute(k, String(v))
    this.pinGroup.append(svg('ellipse', { class: 'pin-shadow', cx, cy: cy + 1, rx: 9, ry: 3 }), svg('g', { class: 'map-pin' }, pin))
    this.svgEl.append(this.pinGroup)

    this.readout = document.createElement('div')
    this.readout.className = 'map-readout'
    const coords = document.createElement('p')
    coords.className = 'map-coords'
    coords.textContent = this.coordText
    const sub = document.createElement('p')
    sub.className = 'map-sub'
    sub.textContent = altitude != null ? `Altitude ${altitude.toFixed(0)} m · accurate to a few metres` : 'Accurate to a few metres'
    this.readout.append(coords, sub)

    const caption = document.createElement('p')
    caption.className = 'map-caption'
    caption.textContent = 'Anyone who gets this file can paste these numbers into a map and see this spot. This drawing is made on your device; no map service was asked.'

    this.el = document.createElement('div')
    this.el.className = 'contour'
    this.el.setAttribute('role', 'img')
    this.el.setAttribute('aria-label', `Location found in the file: ${this.coordText}`)
    this.el.append(this.svgEl, this.readout, caption)
  }

  /** Contours draw in, then the pin drops and the rings pulse. */
  async reveal(): Promise<void> {
    if (reducedMotion()) {
      this.el.classList.add('revealed', 'pinned')
      return
    }
    this.el.classList.add('revealed')
    await sleep(700)
    this.el.classList.add('pinned')
    await sleep(900)
  }

  /** The pin lifts and dissolves into particles; the coordinates decay. */
  async scrub(): Promise<void> {
    this.el.classList.add('unpinning')
    if (!reducedMotion()) this.burst()
    const coords = this.readout.querySelector('.map-coords')!
    const text = this.coordText
    const steps = reducedMotion() ? 1 : 14
    for (let s = 1; s <= steps; s++) {
      coords.textContent = text.replace(/\d/g, (d) => (Math.random() < s / steps ? '·' : d))
      await sleep(55)
    }
    coords.textContent = 'Location removed'
    this.readout.querySelector('.map-sub')!.textContent = 'No coordinates left in the clean copy'
    this.el.querySelector('.map-caption')!.textContent = 'The clean copy carries no location. Check the picture itself for street signs or landmarks.'
    this.el.setAttribute('aria-label', 'Location removed from the clean copy')
    this.el.classList.add('unpinned')
  }

  private burst() {
    const cx = W / 2, cy = H / 2 - 30
    const g = svg('g', { class: 'particles' })
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4
      const dist = 40 + Math.random() * 70
      const p = svg('circle', { cx, cy, r: 1.5 + Math.random() * 2.5 })
      p.style.setProperty('--dx', `${Math.cos(a) * dist}px`)
      p.style.setProperty('--dy', `${Math.sin(a) * dist - 30}px`)
      p.style.animationDelay = `${Math.random() * 120}ms`
      g.append(p)
    }
    this.svgEl.append(g)
    setTimeout(() => g.remove(), 1600)
  }
}

function dms(v: number, hemi: string): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = Math.floor((a - d) * 60)
  return `${d}°${String(m).padStart(2, '0')}′ ${v >= 0 ? hemi[0] : hemi[1]}`
}

// ---------------------------------------------------------------- terrain

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sum of a few soft radial "hills" plus value noise; normalised to 0..1. */
function noiseField(seed: number): Float32Array {
  const rand = mulberry32(seed)
  const f = new Float32Array((COLS + 1) * (ROWS + 1))
  const hills = Array.from({ length: 7 }, () => ({
    x: rand() * COLS, y: rand() * ROWS, r: 8 + rand() * 18, h: (rand() * 2 - 1) * (0.6 + rand()),
  }))
  // A guaranteed rise near the centre so the pin sits on a hill.
  hills.push({ x: COLS / 2 + (rand() - 0.5) * 8, y: ROWS / 2 + (rand() - 0.5) * 6, r: 14, h: 1.2 })
  const grid = 6
  const g = Array.from({ length: (grid + 2) * (grid + 2) }, () => rand())
  const vn = (x: number, y: number) => {
    const gx = (x / COLS) * grid, gy = (y / ROWS) * grid
    const x0 = Math.floor(gx), y0 = Math.floor(gy)
    const tx = smooth(gx - x0), ty = smooth(gy - y0)
    const at = (i: number, j: number) => g[j * (grid + 2) + i]
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty)
  }
  let min = Infinity, max = -Infinity
  for (let y = 0; y <= ROWS; y++) {
    for (let x = 0; x <= COLS; x++) {
      let v = vn(x, y) * 0.9
      for (const hl of hills) {
        const d2 = ((x - hl.x) ** 2 + (y - hl.y) ** 2) / (hl.r * hl.r)
        v += hl.h * Math.exp(-d2)
      }
      f[y * (COLS + 1) + x] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - min) / (max - min)
  return f
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Marching squares → one SVG path of line segments, joined into polylines. */
function marchingSquares(f: Float32Array, level: number): string {
  const sx = W / COLS, sy = H / ROWS
  const at = (x: number, y: number) => f[y * (COLS + 1) + x]
  const segs: [number, number, number, number][] = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1)
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const t = (p: number, q: number) => (level - p) / (q - p)
      const top: [number, number] = [x + t(a, b), y]
      const right: [number, number] = [x + 1, y + t(b, c)]
      const bottom: [number, number] = [x + t(d, c), y + 1]
      const left: [number, number] = [x, y + t(a, d)]
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0] * sx, p[1] * sy, q[0] * sx, q[1] * sy])
      switch (idx) {
        case 1: case 14: add(left, bottom); break
        case 2: case 13: add(bottom, right); break
        case 3: case 12: add(left, right); break
        case 4: case 11: add(top, right); break
        case 5: add(left, top); add(bottom, right); break
        case 6: case 9: add(top, bottom); break
        case 7: case 8: add(left, top); break
        case 10: add(top, right); add(left, bottom); break
      }
    }
  }
  return joinSegments(segs)
}

/** Chain segments sharing endpoints so the paths can be stroke-animated. */
function joinSegments(segs: [number, number, number, number][]): string {
  const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`
  const byStart = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const arr = byStart.get(k)
      if (arr) arr.push(i)
      else byStart.set(k, [i])
    }
  })
  const used = new Uint8Array(segs.length)
  let d = ''
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const pts: [number, number][] = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]]
    // extend forward
    for (let grow = true; grow; ) {
      grow = false
      const [lx, ly] = pts[pts.length - 1]
      for (const j of byStart.get(key(lx, ly)) ?? []) {
        if (used[j]) continue
        used[j] = 1
        const s = segs[j]
        pts.push(key(s[0], s[1]) === key(lx, ly) ? [s[2], s[3]] : [s[0], s[1]])
        grow = true
        break
      }
    }
    d += 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')
  }
  return d
}
