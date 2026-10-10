export async function fixture(name: string): Promise<File> {
  const res = await fetch(new URL(`../fixtures/${name}`, import.meta.url))
  if (!res.ok) throw new Error(`fixture ${name}: ${res.status}`)
  const blob = await res.blob()
  const type = name.endsWith('.heic') ? 'image/heic' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : name.endsWith('.jpg') ? 'image/jpeg' : blob.type
  return new File([blob], name, { type })
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** Read one pixel of a decoded image. */
export async function pixelAt(blob: Blob, x: number, y: number): Promise<[number, number, number]> {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2]]
}
