import { h } from './dom'
import { pinSvg } from './pin'

/**
 * The one bold typographic moment: "unpin" set huge, with the dot of the i
 * replaced by a vermilion map pin. The pin lifts out when a file is cleaned.
 */
export function wordmark(): HTMLElement {
  return h(
    'span.wordmark',
    { 'aria-label': 'Unpin' },
    h('span', { 'aria-hidden': 'true' }, 'unp'),
    h('span.wordmark-i', { 'aria-hidden': 'true' }, 'ı', pinSvg('pin wordmark-pin')),
    h('span', { 'aria-hidden': 'true' }, 'n'),
  )
}

/** Briefly lift the pin out of the wordmark (called after a file is cleaned). */
export function liftWordmarkPin(): void {
  const pin = document.querySelector('.wordmark-pin')
  if (!pin) return
  pin.classList.remove('lift')
  void (pin as SVGElement).getBoundingClientRect()
  pin.classList.add('lift')
}
