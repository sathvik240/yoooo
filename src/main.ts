import './styles/fonts.css'
import './styles/base.css'
import './styles/app.css'
import { h, $ } from './ui/dom'
import { dropzone } from './ui/dropzone'
import { Plate, type PlateHost } from './ui/plate'
import { wordmark } from './ui/wordmark'

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
  if (ready.length > 1) batchbar.append(h('button.btn.btn-ghost', { type: 'button', onclick: unpinAll }, `Unpin all ${ready.length}`))
}

async function unpinAll() {
  for (const p of plates.filter((x) => x.state === 'ready')) await p.unpin()
}

$('.drop-slot')!.append(dropzone(addFiles))
