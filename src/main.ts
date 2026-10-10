import './styles/fonts.css'
import './styles/base.css'
import './styles/app.css'
import { h, $ } from './ui/dom'
import { dropzone } from './ui/dropzone'
import { Plate, type PlateHost } from './ui/plate'
import { wordmark } from './ui/wordmark'
import { scannerPanel } from './ui/scannerPanel'

const app = $('#app')!

app.innerHTML = /* html */ `
  <header class="masthead">
    <a class="masthead-mark" href="./" aria-label="Unpin home">unpin</a>
    <nav class="masthead-nav" aria-label="Sections">
      <a href="#clean">Clean files</a>
      <a href="#caption">Check a caption</a>
      <a href="#limits">What it can’t do</a>
      <a href="./beyond.html">Beyond files</a>
    </nav>
  </header>
  <main id="main" tabindex="-1">
    <section class="hero" id="clean" aria-labelledby="hero-title">
      <h1 id="hero-title" class="wordmark-wrap"></h1>
      <p class="lede">Your photos are talking. Unpin shows you what they say: <em>where</em> you were, <em>when</em>, on <em>which phone</em>. Then it makes them stop.</p>
      <div class="drop-slot"></div>
    </section>
    <section class="plates-section" aria-label="Your files" hidden>
      <div class="batchbar" role="toolbar" aria-label="All files"></div>
      <div class="plates"></div>
    </section>
    <section class="section caption" id="caption" aria-labelledby="caption-title">
      <header class="section-head">
        <p class="eyebrow">02 — Before you hit post</p>
        <h2 id="caption-title" class="section-title">Words give you away too.</h2>
        <p class="section-lede">Paste your caption or bio. Unpin highlights the details that help a stranger find you, and says why.</p>
      </header>
      <div class="caption-slot"></div>
    </section>
    <section class="section limits" id="limits" aria-labelledby="limits-title">
      <header class="section-head">
        <p class="eyebrow">03 — Straight talk</p>
        <h2 id="limits-title" class="section-title">What Unpin can’t protect you from.</h2>
        <p class="section-lede">Removing metadata closes one door. These stay open, and it’s better you know.</p>
      </header>
      <ol class="limits-list">
        <li><h3>What’s visible in the picture</h3><p>Faces, signs, reflections, the view from your window. That’s what the checklist and the redaction brush are for.</p></li>
        <li><h3>Your IP address and device fingerprint</h3><p>When you upload or post anywhere, that site sees your network address and details about your browser and device. Unpin never connects to anything, but the place you post to does.</p></li>
        <li><h3>Accounts that link you</h3><p>Reused usernames, reused profile photos, the same email everywhere, and even your writing style can connect accounts you meant to keep apart.</p></li>
        <li><h3>Records that already exist</h3><p>Data brokers, people-search sites, public records and domain WHOIS entries may already list your name and address. Unpin can’t remove those, but <a href="./beyond.html">Beyond files</a> shows where to start.</p></li>
        <li><h3>Other people</h3><p>Friends and family can tag you, check you in, or post the same moment with their location on.</p></li>
        <li><h3>Platforms</h3><p>Some sites re-compress your upload or add their own metadata, and many keep the original you sent them. A clean file is a better file to send, not a guarantee about what happens next.</p></li>
      </ol>
    </section>
  </main>
  <footer class="footer">
    <p>Unpin runs entirely in your browser. No uploads, no analytics, no cookies.</p>
  </footer>
  <div class="sr-only" aria-live="polite" id="announcer"></div>
`

$('.wordmark-wrap')!.append(wordmark())

const platesSection = $('.plates-section')!
const platesEl = $('.plates')!
const batchbar = $('.batchbar')!
const announcer = $('#announcer')!
const plates: Plate[] = []
let counter = 0

const host: PlateHost = {
  changed: () => renderBatchbar(),
  remove: (p) => {
    plates.splice(plates.indexOf(p), 1)
    p.dispose()
    renderBatchbar()
  },
  announce: (text) => {
    announcer.textContent = text
  },
}

function addFiles(files: File[]) {
  platesSection.hidden = false
  const added: Plate[] = []
  for (const file of files) {
    const plate = new Plate(file, ++counter, host)
    plates.push(plate)
    added.push(plate)
    platesEl.append(plate.el)
  }
  added[0]?.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  // Read sequentially so a batch of big photos doesn't exhaust phone memory.
  ;(async () => {
    for (const p of added) await p.start()
  })()
  renderBatchbar()
}

function renderBatchbar() {
  platesSection.hidden = plates.length === 0
  const ready = plates.filter((p) => p.state === 'ready')
  batchbar.replaceChildren(h('p.batch-count', `${plates.length} file${plates.length === 1 ? '' : 's'}`))
  if (ready.length > 1) batchbar.append(h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: unpinAll }, `Unpin all ${ready.length}`))
  const done = plates.filter((p) => p.result && (p.state === 'clean' || p.state === 'unverified'))
  if (done.length > 1) {
    const allClean = done.every((p) => p.state === 'clean')
    batchbar.append(h('button.btn.btn-primary.btn-small', { type: 'button', onclick: () => downloadZip(done) }, `Download ${done.length} as ZIP${allClean ? '' : ' (some not verified)'}`))
  }
}

async function downloadZip(list: Plate[]) {
  const { zipFiles } = await import('./lib/zip')
  const blob = await zipFiles(list.map((p) => ({ name: p.result!.name, blob: p.result!.blob })))
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: 'unpinned.zip' })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function unpinAll() {
  for (const p of plates.filter((x) => x.state === 'ready')) await p.unpin()
}

$('.drop-slot')!.append(dropzone(addFiles))
$('.caption-slot')!.append(scannerPanel())
