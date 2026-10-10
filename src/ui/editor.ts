import { h } from './dom'
import { applyStroke, renderRedacted, widthFor, type RedactMode, type Stroke } from '../lib/redact'

const MODES: { id: RedactMode; label: string; key: string }[] = [
  { id: 'blur', label: 'Blur', key: '1' },
  { id: 'pixelate', label: 'Pixelate', key: '2' },
  { id: 'cover', label: 'Cover', key: '3' },
]

const MAX_DISPLAY = 1800

let lastMode: RedactMode = 'blur'
let lastSize = 5

/**
 * Full-screen redaction editor. Resolves with the stroke list on "Apply", or
 * null on cancel. Strokes are stored in image-relative coordinates, so the
 * worker can replay them on the full-resolution photo at export time.
 */
export function openEditor(source: ImageBitmap, initial: Stroke[]): Promise<Stroke[] | null> {
  return new Promise((resolve) => {
    const strokes: Stroke[] = initial.map((s) => ({ ...s, points: [...s.points] }))
    const redo: Stroke[] = []
    let mode: RedactMode = lastMode
    let sizePct = lastSize
    let current: Stroke | null = null
    let comparing = false
    let split = 0.5
    let pending = false

    // Display-resolution working canvases.
    const scale = Math.min(1, MAX_DISPLAY / Math.max(source.width, source.height))
    const W = Math.round(source.width * scale), H = Math.round(source.height * scale)
    const base = document.createElement('canvas')
    base.width = W
    base.height = H
    base.getContext('2d')!.drawImage(source, 0, 0, W, H)
    const committed = renderRedacted(base, W, H, strokes, document.createElement('canvas')) as HTMLCanvasElement
    const view = h('canvas.editor-canvas', { width: W, height: H, 'aria-label': 'Photo. Draw over anything you want to hide.' }) as HTMLCanvasElement
    const vctx = view.getContext('2d')!
    const scratch = document.createElement('canvas')

    const cursor = h('div.brush-cursor', { 'aria-hidden': 'true' })
    const pressureFill = h('span.pressure-fill')
    const pressureLabel = h('span.pressure-label', 'Pen pressure: use a pen tablet for variable width')
    const count = h('span.editor-count')

    const modeButtons = MODES.map((m) =>
      h('button.seg', { type: 'button', role: 'radio', 'aria-checked': String(m.id === mode), 'data-mode': m.id, onclick: () => setMode(m.id), title: `${m.label} (${m.key})` },
        h(`span.mode-swatch.swatch-${m.id}`, { 'aria-hidden': 'true' }), m.label),
    )
    const size = h('input.size', { type: 'range', min: 1, max: 15, step: 0.5, value: sizePct, 'aria-label': 'Brush size', oninput: () => { sizePct = Number(size.value); lastSize = sizePct } }) as HTMLInputElement
    const undoBtn = h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => undo(), title: 'Undo (Ctrl+Z)' }, 'Undo')
    const redoBtn = h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => redoStroke(), title: 'Redo (Ctrl+Shift+Z)' }, 'Redo')
    const compareBtn = h('button.btn.btn-ghost.btn-small', { type: 'button', 'aria-pressed': 'false', onclick: () => toggleCompare() }, 'Compare')
    const compareRange = h('input.compare-range', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Before and after divider', hidden: true, oninput: () => { split = Number(compareRange.value) / 100; draw() } }) as HTMLInputElement

    const dialog = h(
      'dialog.editor',
      { 'aria-labelledby': 'editor-title' },
      h('header.editor-bar',
        h('div.editor-heading', h('h2#editor-title', 'Redact'), h('p.editor-hint', 'Paint over faces, street signs, house numbers, licence plates and reflections. Redactions are baked into the clean copy.')),
        h('div.editor-actions',
          h('button.btn.btn-ghost', { type: 'button', onclick: () => close(null) }, 'Cancel'),
          h('button.btn.btn-primary', { type: 'button', onclick: () => close(strokes) }, 'Apply'))),
      h('div.editor-stage', h('div.editor-canvas-wrap', view, cursor, compareRange)),
      h('footer.editor-tools',
        h('div.segmented', { role: 'radiogroup', 'aria-label': 'Effect' }, ...modeButtons),
        h('label.size-label', h('span', 'Size'), size),
        h('div.editor-history', undoBtn, redoBtn, compareBtn, count),
        h('div.pressure', { 'aria-hidden': 'true' }, h('span.pressure-track', pressureFill), pressureLabel)),
    ) as HTMLDialogElement

    function setMode(m: RedactMode) {
      mode = lastMode = m
      for (const b of modeButtons) b.setAttribute('aria-checked', String(b.dataset.mode === m))
      cursor.dataset.mode = m
    }
    setMode(mode)

    function draw() {
      pending = false
      if (comparing) {
        vctx.drawImage(committed, 0, 0)
        const sx = Math.round(W * split)
        if (sx > 0) vctx.drawImage(base, 0, 0, sx, H, 0, 0, sx, H)
        vctx.fillStyle = '#e5432a'
        vctx.fillRect(sx - 1, 0, 2, H)
        return
      }
      if (current) {
        // Preview: committed state + the in-progress stroke.
        if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H }
        const sctx = scratch.getContext('2d')!
        sctx.drawImage(committed, 0, 0)
        applyStroke(scratch, current)
        vctx.drawImage(scratch, 0, 0)
      } else {
        vctx.drawImage(committed, 0, 0)
      }
    }
    const schedule = () => {
      if (!pending) {
        pending = true
        requestAnimationFrame(draw)
      }
    }

    function refreshHistory() {
      undoBtn.toggleAttribute('disabled', !strokes.length)
      redoBtn.toggleAttribute('disabled', !redo.length)
      count.textContent = strokes.length ? `${strokes.length} stroke${strokes.length === 1 ? '' : 's'}` : ''
    }
    function rebuild() {
      renderRedacted(base, W, H, strokes, committed)
      refreshHistory()
      schedule()
    }
    function undo() {
      const s = strokes.pop()
      if (s) { redo.push(s); rebuild() }
    }
    function redoStroke() {
      const s = redo.pop()
      if (s) { strokes.push(s); rebuild() }
    }
    function toggleCompare() {
      comparing = !comparing
      compareBtn.setAttribute('aria-pressed', String(comparing))
      compareRange.hidden = !comparing
      view.classList.toggle('comparing', comparing)
      schedule()
    }

    // ------------------------------------------------------------ pointer
    const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5)
    const pos = (e: PointerEvent) => {
      const r = view.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r }
    }
    function moveCursor(e: PointerEvent) {
      const { x, y, r } = pos(e)
      const p = pressureOf(e)
      const d = (sizePct / 100) * Math.max(r.width, r.height) * widthFor(p)
      cursor.style.width = cursor.style.height = `${d}px`
      cursor.style.transform = `translate(${x * r.width - d / 2}px, ${y * r.height - d / 2}px)`
      cursor.hidden = comparing
      if (e.pointerType === 'pen') {
        pressureFill.style.transform = `scaleX(${e.pressure || 0})`
        pressureLabel.textContent = `Pen pressure ${Math.round((e.pressure || 0) * 100)}%: width and strength follow it`
        dialog.classList.add('has-pen')
      }
    }

    view.addEventListener('pointerdown', (e) => {
      if (comparing || e.button > 0) return
      e.preventDefault()
      try {
        view.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic or already-released pointer */
      }
      const { x, y } = pos(e)
      current = { mode, size: sizePct / 100, points: [{ x, y, p: pressureOf(e) }] }
      moveCursor(e)
      schedule()
    })
    view.addEventListener('pointermove', (e) => {
      moveCursor(e)
      if (!current) return
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
      for (const ev of events.length ? events : [e]) {
        const { x, y, r } = pos(ev)
        const last = current.points[current.points.length - 1]
        if (Math.hypot((x - last.x) * r.width, (y - last.y) * r.height) < 1.5) continue
        current.points.push({ x, y, p: pressureOf(ev) })
      }
      schedule()
    })
    const finish = () => {
      if (!current) return
      applyStroke(committed, current)
      strokes.push(current)
      redo.length = 0
      current = null
      refreshHistory()
      schedule()
    }
    view.addEventListener('pointerup', finish)
    view.addEventListener('pointercancel', finish)
    view.addEventListener('pointerleave', () => { if (!current) cursor.hidden = true })
    view.addEventListener('pointerenter', () => { cursor.hidden = comparing })

    // ----------------------------------------------------------- keyboard
    dialog.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { redoStroke() } else { undo() } }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redoStroke() }
      else if (e.target instanceof HTMLInputElement) return
      else if (e.key === '[' || e.key === ']') { size.value = String(Number(size.value) + (e.key === ']' ? 1 : -1)); size.dispatchEvent(new Event('input')) }
      else {
        const m = MODES.find((x) => x.key === e.key)
        if (m) setMode(m.id)
      }
    })
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null) })

    function close(result: Stroke[] | null) {
      ro.disconnect()
      dialog.close()
      dialog.remove()
      document.documentElement.classList.remove('editor-open')
      resolve(result)
    }

    // Fit the canvas to the stage (scaling small photos up, big ones down).
    const stage = dialog.querySelector<HTMLElement>('.editor-stage')!
    const fit = () => {
      const availW = stage.clientWidth - 32, availH = stage.clientHeight - 56
      const k = Math.max(0.01, Math.min(availW / W, availH / H))
      view.style.width = `${Math.floor(W * k)}px`
      view.style.height = `${Math.floor(H * k)}px`
    }
    const ro = new ResizeObserver(fit)
    ro.observe(stage)

    document.body.append(dialog)
    document.documentElement.classList.add('editor-open')
    dialog.showModal()
    fit()
    refreshHistory()
    draw()
  })
}
