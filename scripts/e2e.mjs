/**
 * End-to-end smoke test against the production build.
 *
 *   npm run build && npm run e2e            (add --shots to save screenshots)
 *
 * It drives the real UI in headless Chromium and records every network
 * request the page makes. The run fails if anything is requested from an
 * origin other than the local preview server, or if anything at all is
 * requested while a file is being read, cleaned and downloaded.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fx = (n) => resolve(root, 'tests/fixtures', n)
const SHOTS = process.argv.includes('--shots')
const shotDir = resolve(root, 'docs/screenshots')
if (SHOTS) mkdirSync(shotDir, { recursive: true })
const PORT = 4179
const ORIGIN = `http://localhost:${PORT}`

const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' })
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && ok())
  server.on('exit', (c) => fail(new Error('preview server exited ' + c)))
  setTimeout(() => fail(new Error('preview server did not start')), 15000)
})

const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync)
const browser = await chromium.launch({ executablePath })
let failures = 0
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`)
  if (!ok) failures++
}

async function run(viewport, label) {
  console.log(`\n${label} (${viewport.width}x${viewport.height})`)
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 2, colorScheme: process.env.SCHEME || 'light' })
  const page = await ctx.newPage()
  const requests = []
  const errors = []
  page.on('request', (r) => requests.push({ url: r.url(), phase }))
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  let phase = 'load'

  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' })
  if (SHOTS) await page.screenshot({ path: `${shotDir}/${label}-1-hero.png` })

  phase = 'use'
  const before = requests.length
  await page.setInputFiles('#file-input', [fx('gps.jpg'), fx('meta.png')])
  await page.waitForSelector('.plate[data-state="ready"]', { timeout: 15000 })
  await page.waitForTimeout(3200) // let the reveal animation finish
  const plate = page.locator('.plate').first()
  if (SHOTS) await plate.screenshot({ path: `${shotDir}/${label}-2-reveal.png` })
  const ledgerText = await plate.locator('.ledger').innerText()
  check(/Pixelphone 9 Pro/.test(ledgerText), 'ledger shows the phone model')
  check(/SN-48151623/.test(ledgerText), 'ledger shows the serial number')

  // Redaction brush: one mouse stroke, then one simulated pen stroke whose
  // pressure ramps up (pointerType 'pen' + pressure, like a Wacom tablet).
  await plate.getByRole('button', { name: 'Redact areas' }).click()
  const canvas = page.locator('.editor-canvas')
  await canvas.waitFor()
  const box = await canvas.boundingBox()
  await page.getByRole('radio', { name: /Cover/ }).click()
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 12 })
  await page.mouse.up()
  await page.getByRole('radio', { name: /Pixelate/ }).click()
  await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const fire = (type, i, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'pen', isPrimary: true, pressure: p, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + r.width * (0.55 + i * 0.02), clientY: r.top + r.height * (0.7 - i * 0.015) }))
    fire('pointerdown', 0, 0.1)
    for (let i = 1; i <= 15; i++) fire('pointermove', i, 0.1 + i * 0.06)
    fire('pointerup', 15, 0)
  })
  check((await page.locator('.editor-count').innerText()) === '2 strokes', 'editor recorded a mouse stroke and a pen stroke')
  check(/Pen pressure \d+%/.test(await page.locator('.pressure-label').innerText()), 'pen pressure is read and shown')
  if (SHOTS) await page.screenshot({ path: `${shotDir}/${label}-2b-editor.png` })
  await page.getByRole('button', { name: 'Apply' }).click()
  await plate.locator('.redact-note').waitFor()

  await plate.getByRole('button', { name: /^Unpin this/ }).click()
  await plate.locator('.stamp').waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  if (SHOTS) await plate.screenshot({ path: `${shotDir}/${label}-3-verified.png` })
  check((await plate.locator('.stamp').innerText()).includes('0 METADATA FIELDS REMAINING'), 'verified stamp says 0 fields remaining')
  check(await plate.locator('.cmp').isVisible(), 'before/after slider shown for the redacted photo')

  const [download] = await Promise.all([page.waitForEvent('download'), plate.getByRole('link', { name: /Download unpinned-1/ }).click()])
  check(download.suggestedFilename() === 'unpinned-1.jpg', `download is named ${download.suggestedFilename()}`)

  // Checklist + caption scanner
  check(await plate.locator('.checklist').isVisible(), 'check-before-you-post panel is shown with the file')
  await plate.locator('.check-box').first().check()
  check((await plate.locator('.check-progress').innerText()) === '1 of 7', 'checklist items can be ticked')
  await page.locator('#caption').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Try an example' }).click()
  const items = await page.locator('.scan-item').count()
  check(items >= 6, `caption scanner flags the example (${items} findings)`)
  if (SHOTS) await page.locator('#caption').screenshot({ path: `${shotDir}/${label}-4-caption.png` })
  if (SHOTS) await page.locator('#limits').screenshot({ path: `${shotDir}/${label}-5-limits.png` })

  const foreign = requests.filter((r) => !r.url.startsWith(ORIGIN) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'))
  check(foreign.length === 0, `no requests to other origins (${foreign.map((r) => r.url).join(', ') || 'none'})`)
  const during = requests.slice(before).filter((r) => !r.url.startsWith('blob:') && !r.url.startsWith('data:'))
  console.log(`    requests while using the app: ${during.length ? during.map((r) => r.url.replace(ORIGIN, '')).join(', ') : 'none'}`)
  check(during.every((r) => r.url.startsWith(ORIGIN + '/assets/')), 'only same-origin app code was fetched during use (no file data can leave)')
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()
}

async function batch() {
  console.log('\nbatch + HEIC (1280x800)')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const requests = []
  const errors = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' })
  await page.setInputFiles('#file-input', [fx('gps.heic'), fx('rotated.jpg'), fx('meta.webp')])
  await page.waitForFunction(() => document.querySelectorAll('.plate[data-state="ready"]').length === 3, null, { timeout: 20000 })
  await page.getByRole('button', { name: /Unpin all 3/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.plate[data-state="clean"], .plate[data-state="error"], .plate[data-state="unverified"]').length === 3, null, { timeout: 30000 }).catch(() => {})
  const states = await page.$$eval('.plate', (els) => els.map((e) => `${e.querySelector('.plate-title').textContent}=${e.dataset.state}${e.dataset.state !== 'clean' ? ' (' + e.querySelector('.plate-verify')?.textContent + ')' : ''}`))
  check(states.every((x) => x.endsWith('=clean')), `HEIC, rotated JPEG and WebP all verified clean: ${states.join(', ')}`)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download 3 as ZIP/ }).click()])
  check(download.suggestedFilename() === 'unpinned.zip', 'batch downloads as unpinned.zip')
  const foreign = requests.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:'))
  check(foreign.length === 0, 'no requests to other origins')
  check(requests.some((u) => /libheif/.test(u)), 'HEIC decoder was lazy-loaded from this site')
  console.log('    errors:', errors.slice(0, 3).map((e) => e.slice(0, 300)))
  check(errors.length === 0, `no console errors (CSP ok)${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()
}

try {
  await batch()
  await run({ width: 1440, height: 900 }, 'desktop')
  await run({ width: 390, height: 844 }, 'phone')
} finally {
  await browser.close()
  server.kill()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
