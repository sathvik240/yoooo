/**
 * Bundle cleaned files into one ZIP. JSZip is loaded only when needed.
 * Every entry gets the same fixed timestamp (the earliest ZIP date) so the
 * archive itself doesn't record when you cleaned your files.
 */
export const ZIP_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0))

export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const f of files) zip.file(f.name, f.blob, { date: ZIP_DATE, binary: true })
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' })
}
