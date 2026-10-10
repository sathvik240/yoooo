import { h } from './dom'

/**
 * Before/after slider. The "after" image is clipped to the right of the
 * divider; a native range input drives it, so it works with keyboard,
 * screen readers and touch.
 */
export function compareSlider(beforeUrl: string, afterUrl: string, label = 'Before and after'): HTMLElement {
  const after = h('img.cmp-after', { src: afterUrl, alt: 'After: the clean copy' })
  const handle = h('div.cmp-handle', { 'aria-hidden': 'true' }, h('span.cmp-knob'))
  const range = h('input.cmp-range', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': `${label}: drag to compare` }) as HTMLInputElement
  const el = h('figure.cmp',
    h('div.cmp-frame', h('img.cmp-before', { src: beforeUrl, alt: 'Before: your original' }), after, handle, range,
      h('span.cmp-tag.cmp-tag-before', { 'aria-hidden': 'true' }, 'Before'),
      h('span.cmp-tag.cmp-tag-after', { 'aria-hidden': 'true' }, 'After')),
    h('figcaption', 'Drag to compare. The redactions are part of the pixels now, not a layer on top.'))
  const set = () => el.style.setProperty('--split', `${range.value}%`)
  range.addEventListener('input', set)
  set()
  return el
}
