import { svg } from './dom'

/** The vermilion map pin, drawn once and reused everywhere. */
export function pinSvg(cls = 'pin'): SVGSVGElement {
  return svg(
    'svg',
    { class: cls, viewBox: '0 0 40 56', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { class: 'pin-body', d: 'M20 1C9.5 1 1 9.2 1 19.6 1 33.4 20 55 20 55s19-21.6 19-35.4C39 9.2 30.5 1 20 1z' }),
    svg('circle', { class: 'pin-hole', cx: 20, cy: 19.5, r: 6.5 }),
  )
}
