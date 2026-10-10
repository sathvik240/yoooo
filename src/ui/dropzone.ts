import { h } from './dom'

export const ACCEPT = [
  'image/*', '.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp',
  'application/pdf', '.pdf', '.docx', '.xlsx', '.pptx',
  'video/mp4', 'video/quicktime', '.mp4', '.mov', '.m4v',
].join(',')

/**
 * The drop zone. Files can be dropped on it or anywhere on the page, picked
 * with the button, or chosen from a phone's camera roll (image/* in accept).
 */
export function dropzone(onFiles: (files: File[]) => void): HTMLElement {
  const input = h('input.visually-hidden', { type: 'file', multiple: true, accept: ACCEPT, id: 'file-input', tabindex: -1, 'aria-hidden': 'true' })
  input.addEventListener('change', () => {
    if (input.files?.length) onFiles([...input.files])
    input.value = ''
  })
  const pick = () => input.click()

  const zone = h(
    'div.drop',
    h('span.corner.tl', { 'aria-hidden': 'true' }),
    h('span.corner.tr', { 'aria-hidden': 'true' }),
    h('span.corner.bl', { 'aria-hidden': 'true' }),
    h('span.corner.br', { 'aria-hidden': 'true' }),
    h('p.drop-title', h('span.only-fine', 'Drop photos, videos or documents'), h('span.only-coarse', 'Pick photos from your camera roll')),
    h('button.btn.btn-primary.drop-btn', { type: 'button', onclick: pick }, h('span.only-fine', 'Choose files'), h('span.only-coarse', 'Choose photos')),
    h('p.drop-hint', 'JPEG, PNG, WebP, HEIC · PDF, Word, Excel, PowerPoint · MP4, MOV · several at once'),
    h('p.drop-promise', h('span.lock', { 'aria-hidden': 'true' }), 'Files never leave this device. There is no server to send them to.'),
    input,
  )

  // Whole-page drag target with a visible state on the zone.
  let depth = 0
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return
    depth++
    document.body.classList.add('dragging')
  })
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (!depth) document.body.classList.remove('dragging')
  })
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    document.body.classList.remove('dragging')
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length) onFiles(files)
  })
  // Paste a screenshot straight from the clipboard.
  window.addEventListener('paste', (e) => {
    const target = e.target as HTMLElement | null
    if (target?.closest('textarea, input')) return
    const files = [...(e.clipboardData?.files ?? [])]
    if (files.length) {
      e.preventDefault()
      onFiles(files)
    }
  })
  return zone
}
