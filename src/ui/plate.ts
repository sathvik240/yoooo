import { h } from './dom'
import { Ledger } from './ledger'
import { summarize } from './summary'
import { familyOf, FriendlyError, type CleanResult, type FileFamily, type Findings } from '../lib/handlers'
import { formatBytes, isIdentifying } from '../lib/fields'
import { readImage, cleanImage } from '../lib/imageHandler'
import { sleep } from '../lib/motion'
import { ContourMap } from './contour'
import { liftWordmarkPin } from './wordmark'
import { openEditor } from './editor'
import { compareSlider } from './compare'
import { checklist, PHOTO_CHECKS } from './checklist'
import { decodeAny } from '../lib/strip'
import { renderRedacted, type Stroke } from '../lib/redact'

export type PlateState = 'reading' | 'ready' | 'cleaning' | 'clean' | 'unverified' | 'error'

const FAMILY_LABEL: Record<FileFamily, string> = { image: 'Photo', pdf: 'PDF', office: 'Office file', video: 'Video', unsupported: 'File' }

export interface PlateHost {
  changed(plate: Plate): void
  remove(plate: Plate): void
  announce(text: string): void
}

/**
 * One file's journey: read → reveal → (redact) → unpin → verify → download.
 */
export class Plate {
  readonly el: HTMLElement
  state: PlateState = 'reading'
  family: FileFamily = 'unsupported'
  findings?: Findings
  result?: CleanResult
  private urls: string[] = []
  private ledger?: Ledger
  private map?: ContourMap
  private strokes: Stroke[] = []
  private photoEls: HTMLImageElement[] = []
  private compareSlot: HTMLElement
  private checkSlot: HTMLElement
  private redactNote: HTMLElement
  private stage: HTMLElement
  private ledgerSlot: HTMLElement
  private actions: HTMLElement
  private verifySlot: HTMLElement
  private summary: HTMLElement
  private status: HTMLElement

  constructor(
    readonly file: File,
    readonly index: number,
    private host: PlateHost,
  ) {
    const no = String(index).padStart(2, '0')
    this.stage = h('figure.stage')
    this.ledgerSlot = h('div.ledger-slot')
    this.actions = h('div.plate-actions')
    this.verifySlot = h('div.plate-verify', { 'aria-live': 'polite' })
    this.summary = h('p.plate-summary')
    this.status = h('p.plate-status', 'Reading…')
    this.compareSlot = h('div.plate-compare')
    this.checkSlot = h('div.plate-check')
    this.redactNote = h('p.redact-note', { hidden: true })
    this.el = h(
      'article.plate',
      { 'aria-labelledby': `plate-${index}-title`, 'data-state': 'reading' },
      h(
        'header.plate-head',
        h('p.plate-no', `No. ${no}`),
        h('h3.plate-title', { id: `plate-${index}-title` }, file.name),
        h('p.plate-meta', formatBytes(file.size)),
        h('button.plate-remove', { type: 'button', 'aria-label': `Remove ${file.name}`, onclick: () => this.host.remove(this) }, '×'),
      ),
      h('div.plate-grid', this.stage, h('div.plate-side', this.summary, this.status, this.ledgerSlot, this.redactNote, this.verifySlot, this.actions)),
      this.compareSlot,
      this.checkSlot,
    )
  }

  private setState(s: PlateState) {
    this.state = s
    this.el.dataset.state = s
    this.host.changed(this)
  }

  private url(blob: Blob): string {
    const u = URL.createObjectURL(blob)
    this.urls.push(u)
    return u
  }

  async start(): Promise<void> {
    try {
      const head = new Uint8Array(await this.file.slice(0, 32).arrayBuffer())
      this.family = familyOf(this.file, head)
      this.el.querySelector('.plate-meta')!.textContent = `${FAMILY_LABEL[this.family]} · ${formatBytes(this.file.size)}`
      if (this.family !== 'image') {
        throw new FriendlyError(
          'Unpin can’t clean this kind of file yet.',
          'Photos (JPEG, PNG, WebP, HEIC) are supported. Try exporting this file as one of those.',
        )
      }
      this.findings = await readImage(this.file)
      this.renderStage()
      this.renderFindings()
      this.setState('ready')
      await Promise.all([this.ledger!.reveal(), this.map?.reveal()])
    } catch (err) {
      this.fail(err)
    }
  }

  private renderStage() {
    const img = this.findings?.image
    const photo = h('img.stage-photo', { src: this.url(this.file), alt: 'Your photo', decoding: 'async' })
    this.photoEls.push(photo)
    // Browsers can't show HEIC; fall back to the embedded preview if there is one.
    photo.addEventListener('error', async () => {
      // Browsers other than Safari can't show HEIC: decode it ourselves.
      try {
        const bmp = await decodeAny(this.file)
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas')
        c.width = Math.round(bmp.width * scale)
        c.height = Math.round(bmp.height * scale)
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
        bmp.close()
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
        if (blob) photo.src = this.url(blob)
      } catch {
        if (img?.thumbnail) photo.src = this.url(new Blob([img.thumbnail as BlobPart], { type: 'image/jpeg' }))
        else photo.replaceWith(h('p.stage-nopreview', 'Preview not available in this browser'))
      }
    }, { once: true })
    if (img?.gps) {
      this.map = new ContourMap(img.gps.latitude, img.gps.longitude, img.gps.altitude)
      this.stage.classList.add('has-map')
      this.stage.replaceChildren(this.map.el, h('div.stage-inset', photo))
    } else {
      this.stage.replaceChildren(photo, h('p.stage-tag', 'No location in this file'))
    }
  }

  private renderFindings() {
    const f = this.findings!
    const count = f.fields.filter(isIdentifying).length
    const sentence = summarize(f, this.family)
    this.summary.textContent = sentence ?? ''
    this.summary.hidden = !sentence
    this.status.textContent = count
      ? `This ${FAMILY_LABEL[this.family].toLowerCase()} is broadcasting ${count} piece${count === 1 ? '' : 's'} of information.`
      : 'No hidden information found. You can still make a clean copy.'
    this.ledger = new Ledger(f.fields, { emptyText: 'Nothing hidden in this file.' })
    this.ledgerSlot.replaceChildren(this.ledger.el)
    const thumbRow = this.ledger.el.querySelector('[data-key="ifd1.thumbnail"] dd')
    if (thumbRow && f.image?.thumbnail) {
      thumbRow.append(h('img.thumb-peek', { src: this.url(new Blob([f.image.thumbnail as BlobPart], { type: 'image/jpeg' })), alt: 'The hidden preview image found inside the file' }))
    }
    for (const n of f.notes) this.ledgerSlot.append(h('p.note', n))
    this.renderReadyActions()
    this.renderChecklist()
  }

  /** "Check before you post": shown with every file. */
  protected renderChecklist() {
    if (this.family !== 'image') return
    this.checkSlot.replaceChildren(checklist(PHOTO_CHECKS, {
      title: 'Check before you post',
      intro: 'Stripping metadata can’t change what’s visible in the picture. A quick look for these usually takes ten seconds.',
      onRedact: () => this.redact(),
      idPrefix: `p${this.index}`,
    }))
  }

  private renderReadyActions() {
    this.actions.replaceChildren(h('button.btn.btn-primary', { type: 'button', onclick: () => this.unpin() }, `Unpin this ${FAMILY_LABEL[this.family].toLowerCase()}`))
    if (this.family === 'image') this.actions.append(h('button.btn.btn-ghost', { type: 'button', onclick: () => this.redact() }, this.strokes.length ? 'Edit redactions' : 'Redact areas'))
  }

  /** Open the brush editor. Also reachable from the checklist. */
  async redact(): Promise<void> {
    if (this.family !== 'image' || !['ready', 'clean', 'unverified'].includes(this.state)) return
    let bitmap: ImageBitmap
    try {
      bitmap = await decodeAny(this.file)
    } catch (err) {
      this.fail(err)
      return
    }
    const result = await openEditor(bitmap, this.strokes)
    if (!result) {
      bitmap.close()
      return
    }
    this.strokes = result
    // Show the redacted version in the plate so it's obvious what will ship.
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale), h2 = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    renderRedacted(bitmap, w, h2, this.strokes, canvas)
    bitmap.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (blob) {
      const u = this.url(blob)
      for (const img of this.photoEls) img.src = u
    }
    const n = this.strokes.length
    this.redactNote.hidden = !n
    this.redactNote.textContent = n ? `${n} redaction${n === 1 ? '' : 's'} will be baked into the clean copy.` : ''
    if (this.state === 'ready') this.renderReadyActions()
    else await this.reclean()
  }

  /** After editing redactions on an already-clean file, re-export quietly. */
  private async reclean() {
    this.setState('cleaning')
    try {
      this.result = await cleanImage(this.file, this.index, this.strokes)
      this.renderVerified()
      this.setState(this.result.verify.clean ? 'clean' : 'unverified')
    } catch (err) {
      this.fail(err)
    }
  }

  async unpin(): Promise<void> {
    if (this.state !== 'ready' || !this.findings) return
    this.setState('cleaning')
    this.actions.querySelectorAll('button').forEach((b) => (b.disabled = true))
    try {
      const [result] = await Promise.all([cleanImage(this.file, this.index, this.strokes), this.ledger!.scrub(), this.map?.scrub()])
      this.result = result
      await sleep(150)
      this.renderVerified()
      this.setState(result.verify.clean ? 'clean' : 'unverified')
      if (result.verify.clean) liftWordmarkPin()
      this.host.announce(result.verify.clean ? `${this.file.name}: verified clean, 0 metadata fields remaining.` : `${this.file.name}: cleaning could not be verified.`)
    } catch (err) {
      this.fail(err)
    }
  }

  private renderVerified() {
    const r = this.result!
    const v = r.verify
    const kept = v.structural.filter((f) => /width|height/i.test(f.label)).map((f) => f.value)
    const dims = r.width && r.height ? `${r.width}×${r.height}` : kept.join('×')
    const download = h('a.btn.btn-primary', { href: this.url(r.blob), download: r.name }, `Download ${r.name}`)
    if (v.clean) {
      this.verifySlot.replaceChildren(
        h('div.stamp', { role: 'status' }, h('span.stamp-top', 'Verified'), h('span.stamp-main', '0 metadata fields remaining')),
        h('p.verify-detail', `Re-read with two independent parsers. Only the pixels${dims ? ` (${dims})` : ''} and basic format info needed to display the image are left. Saved as ${r.name}, ${formatBytes(r.blob.size)}.`),
      )
    } else {
      this.verifySlot.replaceChildren(
        h('div.verify-fail', { role: 'alert' }, h('strong', `Not verified: ${v.remaining.length + v.notes.length} item${v.remaining.length + v.notes.length === 1 ? '' : 's'} still found`),
          h('ul', ...v.remaining.map((f) => h('li', `${f.label}: ${f.value}`)), ...v.notes.map((n) => h('li', n))),
          h('p', 'We won’t call this file clean. Try exporting it as a JPEG from your photo app and cleaning that copy.')),
      )
      download.textContent = `Download anyway (not fully clean)`
      download.classList.replace('btn-primary', 'btn-ghost')
    }
    this.actions.replaceChildren(download, h('button.btn.btn-ghost', { type: 'button', onclick: () => this.redact() }, this.strokes.length ? 'Edit redactions' : 'Redact areas'))
    this.redactNote.textContent = this.strokes.length ? `${this.strokes.length} redaction${this.strokes.length === 1 ? '' : 's'} baked into the pixels.` : ''
    this.compareSlot.replaceChildren()
    if (this.strokes.length) this.compareSlot.append(compareSlider(this.url(this.file), this.url(r.blob)))
  }

  private fail(err: unknown) {
    console.error(err)
    const friendly = err instanceof FriendlyError
    this.status.textContent = ''
    this.verifySlot.replaceChildren(
      h('div.verify-fail', { role: 'alert' },
        h('strong', friendly ? err.message : 'Something went wrong while handling this file.'),
        h('p', friendly ? err.hint : 'Try again. If it keeps happening, try a different browser or export a fresh copy of the file.')),
    )
    this.actions.replaceChildren()
    this.setState('error')
  }

  dispose() {
    for (const u of this.urls) URL.revokeObjectURL(u)
    this.el.remove()
  }
}
