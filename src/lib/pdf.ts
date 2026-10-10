/**
 * PDF metadata: the document Info dictionary, XMP streams, annotation
 * authors, and the document ID. Cleaned with pdf-lib, then verified by
 * re-loading AND by scanning the raw bytes (the output is written without
 * object streams, so every dictionary is plain text and can be checked).
 */
import { PDFDocument, PDFDict, PDFName, PDFRef, PDFStream, PDFArray, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream, type PDFObject } from 'pdf-lib'
import { FriendlyError, type CleanResult, type Findings, type Verification } from './handlers'
import { sortFields, type Field, type Group, type Risk } from './fields'

const INFO_KEYS: Record<string, [Group, string, Risk, string?]> = {
  Author: ['people', 'Author', 'high', 'Your name, written into the document.'],
  Creator: ['software', 'Made with', 'low', 'The app that created it. Can include your username or company.'],
  Producer: ['software', 'Converted with', 'low'],
  Title: ['other', 'Title', 'medium', 'Often a working title or the original file name.'],
  Subject: ['other', 'Subject', 'medium'],
  Keywords: ['other', 'Keywords', 'medium'],
  CreationDate: ['time', 'Created', 'medium', 'When the document was first made.'],
  ModDate: ['time', 'Modified', 'medium'],
  Company: ['people', 'Company', 'high'],
  SourceModified: ['time', 'Source modified', 'low'],
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new FriendlyError('This PDF is password-protected or encrypted, so it can’t be cleaned here.', 'Open it, use “Print → Save as PDF” to make an unprotected copy, then try that copy.')
    }
    throw new FriendlyError('This PDF couldn’t be read. It may be damaged.', 'Try opening it and using “Print → Save as PDF” to make a fresh copy, then drop that copy here.')
  }
}

function text(o: PDFObject | undefined): string {
  if (!o) return ''
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText()
  if (o instanceof PDFName) return o.decodeText()
  return o.toString()
}

/** "D:20240601081422+02'00'" -> "2024-06-01 08:14:22" */
function pdfDate(s: string): string {
  const m = s.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/)
  if (!m) return s
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00'] = m
  return `${y}-${mo}-${d} ${h}:${mi}:${se}`
}

function infoDict(doc: PDFDocument): PDFDict | undefined {
  const ref = doc.context.trailerInfo.Info
  const o = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
  return o instanceof PDFDict ? o : undefined
}

/** Every dictionary in the file, including stream dictionaries. */
function allDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) out.push(obj)
    else if (obj instanceof PDFStream) out.push(obj.dict)
  }
  return out
}

const isAnnot = (d: PDFDict) => d.get(PDFName.of('Type'))?.toString() === '/Annot' || (d.has(PDFName.of('Subtype')) && d.has(PDFName.of('Rect')) && d.has(PDFName.of('T')))

function xmpStreams(doc: PDFDocument): { ref: PDFRef; text: string }[] {
  const out: { ref: PDFRef; text: string }[] = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const t = obj.dict.get(PDFName.of('Subtype'))?.toString()
    if (t !== '/XML') continue
    let s = ''
    try {
      s = new TextDecoder().decode(decodePDFRawStream(obj).decode())
    } catch {
      s = ''
    }
    out.push({ ref, text: s })
  }
  return out
}

function xmpFields(xml: string): Field[] {
  const fields: Field[] = []
  const grab = (tag: string) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? xml.match(new RegExp(`${tag}="([^"]*)"`))
    if (!m) return ''
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const add = (key: string, group: Group, label: string, risk: Risk, value: string, why?: string) => value && fields.push({ key: `xmp.${key}`, group, label, value, risk, why })
  add('creator', 'people', 'Creator (XMP)', 'high', grab('dc:creator'), 'Your name, in the document’s hidden XML metadata.')
  add('CreatorTool', 'software', 'Creator tool (XMP)', 'low', grab('xmp:CreatorTool'))
  add('DocumentID', 'device', 'Document ID (XMP)', 'medium', grab('xmpMM:DocumentID'), 'Can link this file to other versions of it.')
  add('History', 'software', 'Edit history (XMP)', 'medium', grab('xmpMM:History') ? 'present' : '', 'A log of saves and edits, sometimes with app names and times.')
  return fields
}

export async function readPdf(file: Blob): Promise<Findings> {
  const doc = await load(new Uint8Array(await file.arrayBuffer()))
  const fields: Field[] = []
  const info = infoDict(doc)
  if (info) {
    for (const [k, v] of info.entries()) {
      const key = k.decodeText()
      let value = text(v)
      if (!value.trim()) continue
      const rule = INFO_KEYS[key] ?? ['other', key, 'medium']
      if (key.endsWith('Date')) value = pdfDate(value)
      fields.push({ key: `info.${key}`, group: rule[0], label: rule[1], value, risk: rule[2], why: rule[3] })
    }
  }
  for (const x of xmpStreams(doc)) fields.push(...xmpFields(x.text))
  if (xmpStreams(doc).length) fields.push({ key: 'xmp.stream', group: 'other', label: 'XMP metadata', value: `${xmpStreams(doc).length} block${xmpStreams(doc).length === 1 ? '' : 's'}`, risk: 'medium', why: 'Hidden XML metadata that often repeats your name and editing history.' })
  const authors = new Set<string>()
  for (const d of allDicts(doc)) if (isAnnot(d)) { const t = text(d.get(PDFName.of('T'))); if (t) authors.add(t) }
  if (authors.size) fields.push({ key: 'annot.T', group: 'people', label: 'Comment authors', value: [...authors].join(', '), risk: 'high', why: 'Names attached to comments and highlights.' })
  const id = doc.context.trailerInfo.ID
  if (id) fields.push({ key: 'trailer.ID', group: 'device', label: 'Document ID', value: id.toString().slice(0, 40), risk: 'low', why: 'Can link this file to other copies or versions.' })
  const notes: string[] = []
  const names = doc.catalog.get(PDFName.of('Names'))
  if (names && doc.context.lookup(names) instanceof PDFDict && (doc.context.lookup(names) as PDFDict).has(PDFName.of('EmbeddedFiles'))) {
    notes.push('This PDF has files attached inside it. Those attachments are not cleaned; remove them in your PDF app if you don’t need them.')
  }
  notes.push('Text, names and images on the pages themselves stay as they are. Read it once more before sharing.')
  return { fields: sortFields(fields), notes }
}

/** Remove everything not reachable from the document catalog (old revisions, orphaned metadata). */
function dropUnreachable(doc: PDFDocument) {
  const ctx = doc.context
  const seen = new Set<string>()
  const stack: (PDFObject | undefined)[] = [ctx.trailerInfo.Root]
  while (stack.length) {
    const o = stack.pop()
    if (!o) continue
    if (o instanceof PDFRef) {
      if (seen.has(o.toString())) continue
      seen.add(o.toString())
      const t = ctx.lookup(o)
      if (t) stack.push(t)
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFStream) {
      for (const [, v] of o.dict.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) ctx.delete(ref)
}

const STRIP_KEYS = ['Metadata', 'PieceInfo', 'LastModified']

export async function cleanPdf(file: Blob, index: number): Promise<CleanResult> {
  const t0 = performance.now()
  const before = await readPdf(file)
  const doc = await load(new Uint8Array(await file.arrayBuffer()))
  const ctx = doc.context
  ctx.trailerInfo.Info = undefined
  ctx.trailerInfo.ID = undefined
  for (const d of allDicts(doc)) {
    for (const k of STRIP_KEYS) d.delete(PDFName.of(k))
    if (isAnnot(d)) {
      d.delete(PDFName.of('T'))
      d.delete(PDFName.of('M'))
      d.delete(PDFName.of('CreationDate'))
    }
  }
  dropUnreachable(doc)
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  const blob = new Blob([out as BlobPart], { type: 'application/pdf' })
  return { blob, name: `unpinned-${index}.pdf`, verify: await verifyPdf(out), ms: performance.now() - t0, removed: before.fields }
}

export async function verifyPdf(bytes: Uint8Array): Promise<Verification> {
  const remaining: Field[] = []
  const notes: string[] = []
  // 1. Structural re-read with pdf-lib.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const again = await readPdf(new Blob([bytes as BlobPart]))
  remaining.push(...again.fields.filter((f) => f.key !== 'trailer.ID' || doc.context.trailerInfo.ID))
  for (const d of allDicts(doc)) {
    if (d.has(PDFName.of('Metadata'))) {
      remaining.push({ key: 'raw.Metadata', group: 'other', label: 'Metadata reference', value: 'still present', risk: 'medium' })
      break
    }
  }
  // 2. Independent raw-byte scan of the saved file (no object streams, so
  //    every dictionary key is visible as plain text).
  const raw = new TextDecoder('latin1').decode(bytes)
  for (const needle of ['/Author', '/Producer', '/Creator ', '/CreationDate', '/ModDate', '/PieceInfo', 'xmpmeta', '/Metadata']) {
    if (raw.includes(needle)) notes.push(`Raw scan still finds ${needle}`)
  }
  if (/\/Info\s+\d+\s+\d+\s+R/.test(raw)) notes.push('Raw scan still finds an /Info dictionary')
  const pages = doc.getPageCount()
  return {
    clean: remaining.length === 0 && notes.length === 0,
    remaining,
    structural: [{ key: 'pdf.pages', group: 'image', label: 'Pages', value: String(pages), risk: 'low' }],
    notes,
  }
}
