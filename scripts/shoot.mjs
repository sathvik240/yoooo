/**
 * Screenshot helper for design review: node scripts/shoot.mjs <scheme> <width> <height> <out> [fixture...]
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
const [scheme = 'light', w = '390', hgt = '844', out = 'docs/screenshots/shot.png', ...files] = process.argv.slice(2)
const server = spawn('node_modules/.bin/vite', ['preview', '--port', '4181', '--strictPort'])
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('4181') && r()))
const b = await chromium.launch({ executablePath: ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync) })
const p = await b.newPage({ viewport: { width: +w, height: +hgt }, colorScheme: scheme, deviceScaleFactor: 2, reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' })
await p.goto('http://localhost:4181/' + (process.env.PAGE ?? ''))
if (files.length) {
  await p.setInputFiles('#file-input', files)
  await p.waitForTimeout(+(process.env.WAIT ?? 3500))
  if (process.env.UNPIN) { await p.getByRole('button', { name: /^Unpin this/ }).first().click(); await p.waitForTimeout(3000) }
  if (process.env.SEL) await p.locator(process.env.SEL).first().screenshot({ path: out })
  else await p.screenshot({ path: out, fullPage: !!process.env.FULL })
} else {
  await p.waitForTimeout(1500)
  await p.screenshot({ path: out, fullPage: !!process.env.FULL })
}
await b.close()
server.kill()
