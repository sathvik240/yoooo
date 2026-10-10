import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'

/**
 * Production Content-Security-Policy. Everything is same-origin, so even a
 * misbehaving dependency cannot send data to another server: the browser
 * blocks it. Only applied to the build because the dev server needs a
 * websocket for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'unpin-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path.
  base: './',
  plugins: [csp()],
  build: {
    target: 'es2022',
    // Keep every asset a real file so the CSP can stay strict (no data: fonts).
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        beyond: resolve(import.meta.dirname, 'beyond.html'),
      },
    },
  },
  worker: { format: 'es' },
})
