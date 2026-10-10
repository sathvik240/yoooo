import { h } from './dom'
import type { Field } from '../lib/fields'
import { reducedMotion, sleep } from '../lib/motion'

/**
 * The document "reveal": a sheet of paper with an index card of the names
 * and organisations hidden in its properties. The scrub draws redaction bars
 * across them, one by one.
 */
export class DocSheet {
  readonly el: HTMLElement
  private names: HTMLElement[]

  constructor(ext: string, fields: Field[]) {
    const people = [...new Set(fields.filter((f) => f.group === 'people' || f.label === 'Title').flatMap((f) => f.value.split(/,\s*/)))].slice(0, 5)
    this.names = people.map((p) => h('li.doc-name', h('span.doc-name-text', p)))
    const lines = Array.from({ length: 14 }, (_, i) => h('span.doc-line', { style: `--w:${55 + ((i * 37) % 40)}%` }))
    this.el = h('div.docsheet',
      h('div.doc-page', { 'aria-hidden': 'true' }, h('span.doc-ext', ext.toUpperCase()), h('div.doc-lines', ...lines)),
      h('div.doc-card',
        h('p.doc-card-head', people.length ? 'Hidden in its properties' : 'No names found in its properties'),
        people.length ? h('ul.doc-names', ...this.names) : null))
  }

  async reveal(): Promise<void> {
    this.el.classList.add('revealed')
    if (reducedMotion()) return
    for (const n of this.names) {
      n.classList.add('in')
      await sleep(160)
    }
  }

  async scrub(): Promise<void> {
    for (const n of this.names) {
      n.classList.add('redacted')
      await sleep(reducedMotion() ? 0 : 220)
    }
    this.el.querySelector('.doc-card-head')!.textContent = 'Removed from the clean copy'
    this.el.classList.add('scrubbed')
  }
}
