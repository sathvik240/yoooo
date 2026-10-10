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
import { checklist, PHOTO_CHECKS, SCREENSHOT_CHECKS, DOC_CHECKS, VIDEO_CHECKS } from './checklist'
import { DocSheet } from './docsheet'
import { readDocument, cleanDocument, officeExt } from '../lib/docHandler'
import { readVideo, cleanVideo } from '../lib/video'
import { detectScreenshot, looksLikeStatusBar, type ScreenshotVerdict } from '../lib/screenshot'
import { decodeAny } from '../lib/strip'
import { renderRedacted, type Stroke } from '../lib/redact'

export type PlateState = 'reading' | 'ready' | 'cleaning' | 'clean' | 'unverified' | 'error'

const FAMILY_LABEL: Record<FileFamily, string> = { image: 'Photo', pdf: 'PDF', office: 'Document', video: 'Video', unsupported: 'File' }

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
  private sheet?: DocSheet
  private screenshot?: ScreenshotVerdict
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
      if (this.family === 'image') {
        this.findings = await readImage(this.file)
        this.screenshot = await this.checkScreenshot()
        this.renderStage()
      } else if (this.family === 'pdf' || this.family === 'office') {
        this.findings = await readDocument(this.file, this.family)
        const ext = this.family === 'pdf' ? 'pdf' : officeExt(this.file.name)
        this.sheet = new DocSheet(ext, this.findings.fields)
        this.stage.classList.add('has-sheet')
        this.stage.replaceChildren(this.sheet.el)
      } else if (this.family === 'video') {
        this.findings = await readVideo(this.file)
        this.renderVideoStage()
      } else {
        throw new FriendlyError(
          'Unpin can\u2019t clean this kind of file.',
          'Supported: photos (JPEG, PNG, WebP, HEIC), PDFs, and Word, Excel or PowerPoint files (.docx, .xlsx, .pptx).',
        )
      }
      this.renderFindings()
      this.setState('ready')
      await Promise.all([this.ledger!.reveal(), this.map?.reveal(), this.sheet?.reveal()])
    } catch (err) {
      this.fail(err)
    }
  }

  /** Screenshots get their own warnings (usernames, tabs, notifications...). */
  private async checkScreenshot(): Promise<ScreenshotVerdict | undefined> {
    const img = this.findings?.image
    if (!img || img.kind === 'heic' || img.kind === 'avif') return undefined
    try {
      const bmp = await createImageBitmap(this.file, { imageOrientation: 'from-image' })
      const { width, height } = bmp
      const sw = 200, sh = Math.max(1, Math.round((height / width) * sw))
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, sw, sh)
      bmp.close()
      const bar = looksLikeStatusBar(ctx.getImageData(0, 0, sw, sh).data, sw, sh)
      return detectScreenshot(img, width, height, bar)
    } catch {
      return undefined
    }
  }

  private renderVideoStage() {
    const video = h('video.stage-photo', { src: this.url(this.file), muted: true, playsinline: true, controls: true, preload: 'metadata', 'aria-label': 'Your video' }) as HTMLVideoElement
    video.addEventListener('error', () => video.replaceWith(h('p.stage-nopreview', 'This browser can\u2019t preview this video, but it can still be cleaned.')), { once: true })
    const gps = this.findings?.image?.gps
    if (gps) {
      this.map = new ContourMap(gps.latitude, gps.longitude, gps.altitude)
      this.stage.classList.add('has-map')
      this.stage.replaceChildren(this.map.el, h('div.stage-inset', video))
    } else {
      this.stage.replaceChildren(video, h('p.stage-tag', 'No location in this file'))
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
    const noun = this.screenshot?.isScreenshot ? 'screenshot' : FAMILY_LABEL[this.family].toLowerCase()
    this.status.textContent = count
      ? `This ${noun} is carrying ${count} hidden detail${count === 1 ? '' : 's'}.`
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
    const parts: HTMLElement[] = []
    if (this.screenshot?.isScreenshot) {
      parts.push(h('div.shot-warning', { role: 'note' },
        h('p.shot-title', 'This looks like a screenshot'),
        h('ul.shot-reasons', ...this.screenshot.reasons.map((r) => h('li', r))),
        h('p.shot-body', 'Screenshots rarely carry location, but they often show things that identify you directly. Check the list below, then use the brush to cover anything you find.'),
        h('button.btn.btn-primary.btn-small', { type: 'button', onclick: () => this.redact() }, 'Open the redaction brush')))
      parts.push(checklist(SCREENSHOT_CHECKS, { title: 'Screenshot check', intro: 'Look for each of these before you share it.', onRedact: () => this.redact(), idPrefix: `s${this.index}` }))
    } else if (this.family === 'image') {
      parts.push(checklist(PHOTO_CHECKS, {
        title: 'Check before you post',
        intro: 'Stripping metadata can\u2019t change what\u2019s visible in the picture. A quick look for these usually takes ten seconds.',
        onRedact: () => this.redact(),
        idPrefix: `p${this.index}`,
      }))
    } else if (this.family === 'video') {
      parts.push(checklist(VIDEO_CHECKS, { title: 'Check before you post', intro: 'Cleaning removes hidden data. Videos show and say a lot more than photos; watch it through once.', idPrefix: `v${this.index}` }))
    } else {
      parts.push(checklist(DOC_CHECKS, { title: 'Check before you send', intro: 'Cleaning removes hidden properties. These live in the document itself.', idPrefix: `d${this.index}` }))
    }
    this.checkSlot.replaceChildren(...parts)
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
      const clean = this.family === 'image'
        ? cleanImage(this.file, this.index, this.strokes)
        : this.family === 'video'
          ? cleanVideo(this.file, this.index)
          : cleanDocument(this.file, this.family as 'pdf' | 'office', this.index)
      const [result] = await Promise.all([clean, this.ledger!.scrub(), this.map?.scrub(), this.sheet?.scrub()])
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
    const caveats = (r.notes ?? []).map((n) => h('p.note', n))
    const before = this.findings?.fields.filter(isIdentifying).length ?? 0
    if (v.clean) this.status.textContent = before ? `It carried ${before} hidden detail${before === 1 ? '' : 's'}. The clean copy carries none.` : 'The clean copy carries no hidden details.'
    if (v.clean) {
      const detail = this.family === 'video'
        ? `Re-read after cleaning: location, device, names and timestamps are gone. The video and audio are byte-for-byte untouched (no re-encoding). Saved as ${r.name}, ${formatBytes(r.blob.size)}.`
        : this.family === 'image'
        ? `Re-read with two independent parsers. Only the pixels${dims ? ` (${dims})` : ''} and basic format info needed to display the image are left. Saved as ${r.name}, ${formatBytes(r.blob.size)}.`
        : `Re-read after cleaning: properties, hidden XML and author names are gone; the content is untouched. Saved as ${r.name}, ${formatBytes(r.blob.size)}.`
      this.verifySlot.replaceChildren(
        h('div.stamp', { role: 'status' }, h('span.stamp-top', 'Verified'), h('span.stamp-main', '0 metadata fields remaining')),
        h('p.verify-detail', detail),
        ...caveats,
      )
    } else {
      this.verifySlot.replaceChildren(
        h('div.verify-fail', { role: 'alert' }, h('strong', `Not verified: ${v.remaining.length + v.notes.length} item${v.remaining.length + v.notes.length === 1 ? '' : 's'} still found`),
          h('ul', ...v.remaining.map((f) => h('li', `${f.label}: ${f.value}`)), ...v.notes.map((n) => h('li', n))),
          h('p', this.family === 'image' ? 'We won\u2019t call this file clean. Try exporting it as a JPEG from your photo app and cleaning that copy.' : 'We won\u2019t call this file clean. Try \u201cSave as\u201d a fresh copy (or \u201cPrint \u2192 Save as PDF\u201d) and clean that.')),
        ...caveats,
      )
      download.textContent = `Download anyway (not fully clean)`
      download.classList.replace('btn-primary', 'btn-ghost')
    }
    this.actions.replaceChildren(download)
    if (this.family === 'image') this.actions.append(h('button.btn.btn-ghost', { type: 'button', onclick: () => this.redact() }, this.strokes.length ? 'Edit redactions' : 'Redact areas'))
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
