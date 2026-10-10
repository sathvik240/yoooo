import { h } from './dom'
import { GROUP_LABEL, GROUP_ORDER, isIdentifying, type Field } from '../lib/fields'
import { reducedMotion, sleep } from '../lib/motion'

/**
 * The ledger: what the file was broadcasting, grouped and typed out line by
 * line during the reveal, then struck out one at a time during the scrub.
 */
export class Ledger {
  readonly el: HTMLElement
  private rows: HTMLElement[] = []
  private fields: Field[]

  constructor(fields: Field[], opts: { emptyText: string }) {
    this.fields = fields
    this.el = h('div.ledger')
    const identifying = fields.filter(isIdentifying)
    if (!identifying.length) {
      this.el.append(h('p.ledger-empty', opts.emptyText))
    }
    const saidWhy = new Set<string>()
    for (const group of GROUP_ORDER) {
      // Format-only info (JFIF version, dimensions) identifies nobody; it is
      // summarised in the verification note instead of cluttering the ledger.
      if (group === 'image') continue
      const inGroup = fields.filter((f) => f.group === group)
      if (!inGroup.length) continue
      const list = h('dl.ledger-list')
      for (const f of inGroup) {
        const row = h(
          `div.ledger-row.risk-${f.risk}`,
          { 'data-key': f.key },
          h('dt', h('span.risk-mark', { 'aria-hidden': 'true' }), f.label, f.risk === 'high' ? h('span.sr-only', ' (high risk)') : null),
          h('dd', h('span.value', f.value), f.why && !saidWhy.has(f.why) ? h('span.why', f.why) : null),
        )
        if (f.why) saidWhy.add(f.why)
        this.rows.push(row)
        list.append(row)
      }
      this.el.append(h(`section.ledger-group.group-${group}`, h('h4.ledger-heading', GROUP_LABEL[group], h('span.count', String(inGroup.length))), list))
    }
  }

  get identifyingCount(): number {
    return this.fields.filter(isIdentifying).length
  }

  /** Rows appear one at a time with their values typed out. */
  async reveal(): Promise<void> {
    if (reducedMotion()) return
    this.el.classList.add('revealing')
    const budget = Math.min(2400, 120 * this.rows.length)
    const per = Math.max(45, budget / Math.max(1, this.rows.length))
    for (const row of this.rows) row.classList.add('pending')
    for (const row of this.rows) {
      row.classList.remove('pending')
      row.classList.add('in')
      const v = row.querySelector('.value')
      if (v && !row.classList.contains('structural')) typeOut(v, Math.min(per * 0.9, 380))
      await sleep(per)
    }
    this.el.classList.remove('revealing')
  }

  /** Identifying rows are struck through and collapsed, one at a time. */
  async scrub(): Promise<void> {
    const rows = this.rows.filter((r) => !r.classList.contains('structural'))
    const per = reducedMotion() ? 0 : Math.max(40, Math.min(160, 1800 / Math.max(1, rows.length)))
    for (const row of rows) {
      row.classList.add('scrubbed')
      const v = row.querySelector('.value')
      if (v && !reducedMotion()) scramble(v)
      await sleep(per)
    }
    await sleep(350)
    for (const g of this.el.querySelectorAll('.ledger-group')) {
      if (!g.querySelector('.ledger-row:not(.scrubbed)')) g.classList.add('cleared')
    }
  }
}

function typeOut(el: Element, ms: number) {
  const full = el.textContent ?? ''
  if (full.length < 2) return
  const steps = Math.min(full.length, 24)
  let i = 0
  el.textContent = ''
  const tick = () => {
    i++
    el.textContent = full.slice(0, Math.ceil((full.length * i) / steps))
    if (i < steps) setTimeout(tick, ms / steps)
  }
  tick()
}

const GLYPHS = '#%&*+=-/\\|<>~'

/** Characters decay into noise, then into a dash. */
function scramble(el: Element) {
  const full = el.textContent ?? ''
  const len = Math.min(full.length, 28)
  let n = 0
  const tick = () => {
    n++
    const keep = Math.max(0, len - Math.round((len * n) / 8))
    el.textContent = full.slice(0, keep) + Array.from({ length: len - keep }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('')
    if (n < 8) setTimeout(tick, 28)
    else el.textContent = '—'
  }
  tick()
}
