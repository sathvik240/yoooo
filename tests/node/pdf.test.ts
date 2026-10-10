import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { readPdf, cleanPdf } from '../../src/lib/pdf'
import { FriendlyError } from '../../src/lib/handlers'

const fx = (n: string) => new Blob([readFileSync(resolve(import.meta.dirname, '../fixtures', n))])

describe('PDF cleaning', () => {
  it('finds Info, XMP, comment authors', async () => {
    const f = await readPdf(fx('sample.pdf'))
    const byLabel = Object.fromEntries(f.fields.map((x) => [x.label, x.value]))
    expect(byLabel['Author']).toBe('Jamie Doe')
    expect(byLabel['Title']).toBe('Notes - Jamie Doe - DRAFT')
    expect(byLabel['Made with']).toBe('Writer 7.1 (jamie-laptop)')
    expect(byLabel['Converted with']).toBe('PDF Printer 2.0')
    expect(byLabel['Created']).toBe('2024-06-01 08:14:22')
    expect(byLabel['Creator (XMP)']).toBe('Jamie Doe')
    expect(byLabel['Comment authors']).toBe('Jamie Doe')
  })

  it('removes all of it and verifies with pdf-lib and a raw byte scan', async () => {
    const res = await cleanPdf(fx('sample.pdf'), 3)
    expect(res.name).toBe('unpinned-3.pdf')
    expect(res.verify.notes).toEqual([])
    expect(res.verify.remaining).toEqual([])
    expect(res.verify.clean).toBe(true)

    const bytes = new Uint8Array(await res.blob.arrayBuffer())
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).not.toContain('Jamie Doe')
    expect(raw).not.toContain('xmpmeta')
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.getAuthor()).toBeUndefined()
    expect(doc.getTitle()).toBeUndefined()
    expect(doc.getProducer()).toBeUndefined()
    expect(doc.getCreationDate()).toBeUndefined()
    expect(doc.getPageCount()).toBe(1) // content survives
    expect(raw).toContain('check numbers') // comment text itself is content, kept
  })

  it('a damaged PDF gives a plain-language error with a fix', async () => {
    const err = await readPdf(fx('corrupt.pdf')).catch((e) => e)
    expect(err).toBeInstanceOf(FriendlyError)
    expect(err.hint).toMatch(/Save as PDF/)
  })
})
