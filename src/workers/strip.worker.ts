/// <reference lib="webworker" />
import { decode, encodeBitmap, type OutputType } from '../lib/encode'

export interface StripRequest {
  id: number
  /** Either the original file (decoded here) or already-redacted pixels. */
  source: Blob | ImageBitmap
  type: OutputType
  quality?: number
}

export type StripResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string; decode: boolean }

self.onmessage = async (e: MessageEvent<StripRequest>) => {
  const { id, source, type, quality } = e.data
  try {
    const bitmap = source instanceof Blob ? await decode(source) : source
    const { width, height } = bitmap
    const blob = await encodeBitmap(bitmap, { type, quality })
    bitmap.close()
    ;(self as unknown as Worker).postMessage({ id, ok: true, blob, width, height } satisfies StripResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: message, decode: err instanceof Error && err.name === 'DecodeError' } satisfies StripResponse)
  }
}
