/**
 * HEIC/HEIF decoding. Safari decodes HEIC natively; everywhere else we
 * lazy-load libheif (WebAssembly, ~1.4 MB) the first time someone actually
 * picks a HEIC photo. It runs locally like everything else and needs no
 * eval, so the strict Content-Security-Policy stays intact.
 */
interface HeifImage {
  get_width(): number
  get_height(): number
  display(data: ImageData, cb: (out: ImageData | null) => void): void
  free?(): void
}
interface LibHeif {
  HeifDecoder: new () => { decode(buf: Uint8Array): HeifImage[] }
  ready?: Promise<unknown>
}

let lib: Promise<LibHeif> | null = null

async function loadLibheif(): Promise<LibHeif> {
  lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async (m) => {
    const mod = (m.default as (o?: object) => LibHeif | Promise<LibHeif>)()
    const ready = await mod
    if (ready.ready) await ready.ready
    return ready
  })
  return lib
}

const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))])

/** Decode the primary image of a HEIC file to an ImageBitmap. */
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    /* no native HEIC support: use libheif */
  }
  const libheif = await withTimeout(loadLibheif(), 30_000, 'HEIC decoder took too long to load')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const images = new libheif.HeifDecoder().decode(bytes)
  if (!images.length) throw new Error('No image found in HEIC file')
  const img = images[0]
  const w = img.get_width(), h = img.get_height()
  const target = new ImageData(w, h)
  const out = await withTimeout(new Promise<ImageData | null>((resolve) => img.display(target, resolve)), 60_000, 'HEIC decoding took too long')
  for (const i of images) i.free?.()
  if (!out) throw new Error('HEIC decode failed')
  return createImageBitmap(out)
}
