import { h } from './dom'
import { scanText, KIND_INFO, type TextFinding } from '../lib/scanner'

const SAMPLE = `Just landed in Lisbon!! ☀️ Home alone for the week so the cat is judging me. Starting work at Blue Bottle Coffee on Monday, come say hi 👋 My insta is jamie.d.travels, or email jamie.doe@example.com. Mail still goes to 42 Elm Street, Springfield, IL 62704.`

/**
 * Paste a caption, bio or post; risky bits are highlighted in place and
 * explained underneath. Runs on every keystroke, entirely locally.
 */
export function scannerPanel(): HTMLElement {
  const textarea = h('textarea.scan-input', {
    id: 'scan-input',
    rows: 7,
    spellcheck: 'false',
    placeholder: 'Paste a caption, bio or post here before you publish it…',
    'aria-describedby': 'scan-help',
  }) as HTMLTextAreaElement
  const backdrop = h('div.scan-backdrop', { 'aria-hidden': 'true' })
  const results = h('div.scan-results', { 'aria-live': 'polite' })
  const counter = h('p.scan-count')

  const render = () => {
    const text = textarea.value
    const found = scanText(text)
    // Highlight layer: same text, same wrapping, with <mark>s.
    const frag = document.createDocumentFragment()
    let pos = 0
    found.forEach((f, i) => {
      frag.append(text.slice(pos, f.start))
      frag.append(h(`mark.hl.hl-${f.kind}.conf-${f.confidence}`, { 'data-i': i }, text.slice(f.start, f.end)))
      pos = f.end
    })
    frag.append(text.slice(pos) + '\n')
    backdrop.replaceChildren(frag)
    syncScroll()

    if (!text.trim()) {
      counter.textContent = ''
      results.replaceChildren(h('p.scan-empty', 'Nothing to check yet. Try the example to see how it works.'))
      return
    }
    const likely = found.filter((f) => f.confidence === 'likely').length
    counter.textContent = found.length
      ? `${found.length} thing${found.length === 1 ? '' : 's'} worth a second look${likely && likely < found.length ? ` (${likely} likely, ${found.length - likely} possible)` : ''}`
      : 'Nothing obvious found.'
    results.replaceChildren(
      found.length
        ? h('ol.scan-list', ...found.map((f, i) => item(f, i)))
        : h('p.scan-empty', 'We didn’t spot anything, but this check only knows common patterns. Give it one more read with a stranger’s eyes.'),
    )
  }

  const item = (f: TextFinding, i: number) => {
    const info = KIND_INFO[f.kind]
    const li = h(`li.scan-item.kind-${f.kind}`, { 'data-i': i, tabindex: 0 },
      h('p.scan-item-head', h(`span.chip.chip-${f.kind}`, info.label), f.confidence === 'possible' ? h('span.maybe', 'possible') : null),
      h('p.scan-quote', '“', f.text, '”'),
      h('p.scan-why', info.why))
    const toggle = (on: boolean) => backdrop.querySelector(`mark[data-i="${i}"]`)?.classList.toggle('active', on)
    li.addEventListener('mouseenter', () => toggle(true))
    li.addEventListener('mouseleave', () => toggle(false))
    li.addEventListener('focus', () => toggle(true))
    li.addEventListener('blur', () => toggle(false))
    li.addEventListener('click', () => {
      textarea.focus()
      textarea.setSelectionRange(f.start, f.end)
    })
    return li
  }

  const syncScroll = () => {
    backdrop.scrollTop = textarea.scrollTop
  }
  textarea.addEventListener('input', render)
  textarea.addEventListener('scroll', syncScroll)

  const exampleBtn = h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { textarea.value = SAMPLE; render(); textarea.focus() } }, 'Try an example')
  const clearBtn = h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { textarea.value = ''; render(); textarea.focus() } }, 'Clear')

  render()
  return h('div.scanner',
    h('div.scan-field',
      h('label.eyebrow', { for: 'scan-input' }, 'Your caption'),
      h('div.scan-editor', backdrop, textarea),
      h('div.scan-toolbar', exampleBtn, clearBtn, counter),
      h('p.scan-help#scan-help', 'Checked on this device as you type. It looks for patterns, so it will miss some things and flag some harmless ones. It can’t tell what time of day you usually post, so it doesn’t try.')),
    h('div.scan-side', results))
}
