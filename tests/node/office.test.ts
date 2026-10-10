import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { readOffice, cleanOffice } from '../../src/lib/office'
import { FriendlyError } from '../../src/lib/handlers'

const fx = (n: string) => new Blob([readFileSync(resolve(import.meta.dirname, '../fixtures', n))])
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const labels = (fields: { label: string; value: string }[]) => Object.fromEntries(fields.map((f) => [f.label, f.value]))

/** Stand-in for the browser's canvas re-encoder: returns a metadata-free JPEG. */
const fakeClean = async () => new Uint8Array(readFileSync(resolve(import.meta.dirname, '../fixtures/clean.jpg')))

describe('DOCX cleaning', () => {
  it('finds authors, company, template path, comments, tracked changes, rsids and a GPS photo', async () => {
    const f = await readOffice(fx('sample.docx'))
    const l = labels(f.fields)
    expect(l['Author']).toBe('Jamie Doe')
    expect(l['Last edited by']).toBe('Alex Smith')
    expect(l['Company']).toBe('Springfield Nuclear')
    expect(l['Manager']).toBe('Monty Burns')
    expect(l['Template path']).toMatch(/JamieDoe/)
    expect(l['Comment authors']).toBe('Alex Smith')
    expect(l['Tracked-change authors']).toBe('Alex Smith, Jamie Doe')
    expect(l['Account ID']).toBe('alex.smith@springfield.example')
    expect(l['Revision IDs']).toMatch(/found/)
    expect(l['Custom: ClientName']).toBe('Jamie Doe')
    expect(l['Embedded image image1.jpeg']).toMatch(/GPS/)
    expect(f.notes.join(' ')).toMatch(/deleted text is still inside/)
  })

  it('cleans everything and verifies by re-reading every XML part', async () => {
    const res = await cleanOffice(new Blob([await fx('sample.docx').arrayBuffer()], { type: DOCX }), 2, 'docx', { cleanImage: fakeClean })
    expect(res.name).toBe('unpinned-2.docx')
    expect(res.verify.notes).toEqual([])
    expect(res.verify.remaining).toEqual([])
    expect(res.verify.clean).toBe(true)
    expect(res.notes?.join(' ')).toMatch(/Tracked changes are still in the document/)

    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const all = (await Promise.all(Object.keys(zip.files).filter((p) => /\.(xml|rels)$/.test(p)).map((p) => zip.file(p)!.async('string')))).join('\n')
    for (const leak of ['Jamie Doe', 'Alex Smith', 'Springfield Nuclear', 'Monty Burns', 'JamieDoe', 'alex.smith@', 'w:rsid', '2024-06']) expect(all).not.toContain(leak)
    expect(zip.file('word/comments.xml')).toBeNull()
    expect(zip.file('docProps/custom.xml')).toBeNull()
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('Hello from the budget.') // content intact
    expect(doc).not.toContain('commentReference')
    for (const f of Object.values(zip.files)) expect(f.date.getUTCFullYear()).toBeLessThanOrEqual(1980)
  })

  it('without an image re-encoder, an embedded GPS photo keeps the file from being called clean', async () => {
    const res = await cleanOffice(fx('sample.docx'), 1, 'docx')
    expect(res.verify.clean).toBe(false)
    expect(res.verify.remaining.map((f) => f.label)).toEqual(['Embedded image image1.jpeg'])
  })
})

describe('XLSX cleaning', () => {
  it('removes the saved folder path and anonymises comment authors', async () => {
    const before = labels((await readOffice(fx('sample.xlsx'))).fields)
    expect(before['Saved folder']).toMatch(/JamieDoe/)
    expect(before['Comment authors']).toBe('Jamie Doe')
    const res = await cleanOffice(fx('sample.xlsx'), 1, 'xlsx')
    expect(res.verify.clean).toBe(true)
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    const wb = await zip.file('xl/workbook.xml')!.async('string')
    expect(wb).not.toContain('absPath')
    expect(wb).toContain('<sheets>')
    const comments = await zip.file('xl/comments1.xml')!.async('string')
    expect(comments).not.toContain('Jamie Doe')
    expect(comments).toContain('double check')
  })
})

describe('PPTX cleaning', () => {
  it('anonymises comment authors and clears properties', async () => {
    const res = await cleanOffice(fx('sample.pptx'), 1, 'pptx')
    expect(res.removed.map((f) => f.label)).toEqual(expect.arrayContaining(['Author', 'Comment authors', 'Company']))
    expect(res.verify.clean).toBe(true)
    const zip = await JSZip.loadAsync(await res.blob.arrayBuffer())
    expect(await zip.file('ppt/commentAuthors.xml')!.async('string')).not.toContain('Jamie')
  })
})

describe('errors', () => {
  it('a non-Office ZIP or old .doc gives a plain-language error', async () => {
    const err = await readOffice(fx('gps.jpg')).catch((e) => e)
    expect(err).toBeInstanceOf(FriendlyError)
    expect(err.hint).toMatch(/\.docx/)
  })
})
