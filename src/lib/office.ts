/**
 * DOCX / XLSX / PPTX cleaning. These are ZIP files full of XML; identifying
 * details live in docProps (author, last editor, company, manager, template
 * path, edit time), comments, tracked-change authors and dates, revision IDs,
 * attached-template paths and Excel's saved folder path.
 */
import type JSZipType from 'jszip'
import { FriendlyError, type CleanResult, type Findings, type Verification } from './handlers'
import { sortFields, type Field, type Group, type Risk } from './fields'
import { ZIP_DATE } from './zip'
import { readImageMetadata } from './imageMeta'

type Zip = JSZipType
export type ImageCleaner = (bytes: Uint8Array, name: string) => Promise<Uint8Array | null>

const ANON = 'Author'

async function open(bytes: Uint8Array): Promise<Zip> {
  const { default: JSZip } = await import('jszip')
  try {
    const zip = await JSZip.loadAsync(bytes)
    if (!zip.file('[Content_Types].xml')) throw new Error('not OOXML')
    return zip
  } catch {
    throw new FriendlyError(
      'This doesn’t look like a Word, Excel or PowerPoint file Unpin can read.',
      'Older .doc/.xls/.ppt files aren’t supported. Open the file and save it as .docx, .xlsx or .pptx, then try again.',
    )
  }
}

const read = (zip: Zip, path: string) => zip.file(path)?.async('string') ?? Promise.resolve(undefined)

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1].replace(/<[^>]+>/g, '')).trim() : ''
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

const CORE_TAGS: [string, Group, string, Risk, string?][] = [
  ['dc:creator', 'people', 'Author', 'high', 'Your name, saved in the file’s properties.'],
  ['cp:lastModifiedBy', 'people', 'Last edited by', 'high', 'The name of whoever saved it last.'],
  ['dc:title', 'other', 'Title', 'medium'],
  ['dc:subject', 'other', 'Subject', 'medium'],
  ['dc:description', 'other', 'Comments', 'medium'],
  ['cp:keywords', 'other', 'Keywords', 'medium'],
  ['cp:category', 'other', 'Category', 'low'],
  ['cp:contentStatus', 'other', 'Status', 'low'],
  ['dcterms:created', 'time', 'Created', 'medium'],
  ['dcterms:modified', 'time', 'Modified', 'medium'],
  ['cp:lastPrinted', 'time', 'Last printed', 'medium'],
  ['cp:revision', 'software', 'Revision number', 'low', 'How many times it was saved.'],
]
const APP_TAGS: [string, Group, string, Risk, string?][] = [
  ['Company', 'people', 'Company', 'high', 'Your employer or school, from your Office installation.'],
  ['Manager', 'people', 'Manager', 'high'],
  ['Template', 'software', 'Template', 'medium', 'Can include a folder path with your username.'],
  ['TotalTime', 'time', 'Editing time', 'low'],
  ['Application', 'software', 'Application', 'low'],
  ['AppVersion', 'software', 'App version', 'low'],
  ['HyperlinkBase', 'other', 'Link base', 'medium'],
]

const isoDate = (s: string) => s.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '')

const WORD_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|settings)\.xml$/
const COMMENT_PARTS = /^(word\/(comments|commentsExtended|commentsIds|commentsExtensible|people)\.xml)$/
const MEDIA = /^(word|xl|ppt)\/media\/[^/]+\.(jpe?g|png|webp)$/i

interface Scan {
  fields: Field[]
  notes: string[]
  trackedChanges: number
  mediaWithMeta: string[]
}

async function readEmbedded(b: Uint8Array): Promise<{ fields: Field[]; gps: boolean }> {
  try {
    const r = await readImageMetadata(b)
    return { fields: r.fields.filter((f) => f.group !== 'image'), gps: Boolean(r.gps) }
  } catch {
    return { fields: [], gps: false }
  }
}

async function scan(zip: Zip): Promise<Scan> {
  const readImage = readEmbedded
  const fields: Field[] = []
  const notes: string[] = []
  const add = (key: string, group: Group, label: string, value: string, risk: Risk, why?: string) => value && fields.push({ key, group, label, value, risk, why })

  const core = await read(zip, 'docProps/core.xml')
  if (core) for (const [t, g, l, r, w] of CORE_TAGS) add(`core.${t}`, g, l, t.startsWith('dcterms') || t === 'cp:lastPrinted' ? isoDate(tag(core, t)) : tag(core, t), r, w)
  const app = await read(zip, 'docProps/app.xml')
  if (app) for (const [t, g, l, r, w] of APP_TAGS) add(`app.${t}`, g, l, t === 'TotalTime' && tag(app, t) ? `${tag(app, t)} minutes` : tag(app, t), r, w)
  const custom = await read(zip, 'docProps/custom.xml')
  if (custom) {
    for (const m of custom.matchAll(/<property[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) add(`custom.${m[1]}`, 'other', `Custom: ${decodeXml(m[1])}`, decodeXml(m[2].replace(/<[^>]+>/g, '')).trim(), 'medium', 'Custom properties added by an app or your organisation.')
  }

  const commentAuthors = new Set<string>()
  const changeAuthors = new Set<string>()
  let trackedChanges = 0
  let rsids = 0
  for (const path of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(path)) continue
    const xml = (await read(zip, path)) ?? ''
    if (WORD_PARTS.test(path)) {
      if (path === 'word/comments.xml') for (const m of xml.matchAll(/w:author="([^"]*)"/g)) commentAuthors.add(decodeXml(m[1]))
      else {
        for (const m of xml.matchAll(/<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange)\b[^>]*w:author="([^"]*)"/g)) {
          trackedChanges++
          changeAuthors.add(decodeXml(m[2]))
        }
      }
      rsids += (xml.match(/w:rsid\w*="/g) ?? []).length
      if (path === 'word/settings.xml' && /<w:attachedTemplate\b/.test(xml)) {
        const rels = (await read(zip, 'word/_rels/settings.xml.rels')) ?? ''
        const target = rels.match(/attachedTemplate"[^>]*Target="([^"]*)"/)?.[1] ?? rels.match(/Target="([^"]*)"[^>]*attachedTemplate/)?.[1]
        add('word.attachedTemplate', 'people', 'Template path', target ? decodeXml(target) : 'present', 'high', 'A folder path on your computer, which often contains your username.')
      }
    }
    if (path === 'word/people.xml') for (const m of xml.matchAll(/w15:userId="([^"]*)"/g)) add('word.people.userId', 'people', 'Account ID', decodeXml(m[1]), 'high', 'The account (often an email) of a commenter.')
    if (/^xl\/comments\d*\.xml$/.test(path)) for (const m of xml.matchAll(/<author>([^<]*)<\/author>/g)) commentAuthors.add(decodeXml(m[1]))
    if (/^xl\/persons\/person\d*\.xml$/.test(path)) for (const m of xml.matchAll(/displayName="([^"]*)"/g)) commentAuthors.add(decodeXml(m[1]))
    if (path === 'ppt/commentAuthors.xml' || /^ppt\/authors\.xml$/.test(path)) for (const m of xml.matchAll(/\bname="([^"]*)"/g)) commentAuthors.add(decodeXml(m[1]))
    if (path === 'xl/workbook.xml') {
      const abs = xml.match(/<x15ac:absPath[^>]*url="([^"]*)"/)?.[1]
      if (abs) add('xl.absPath', 'people', 'Saved folder', decodeXml(abs), 'high', 'The folder this was last saved in, which often contains your real name.')
    }
  }
  commentAuthors.delete(ANON)
  changeAuthors.delete(ANON)
  if (commentAuthors.size) add('comments.authors', 'people', 'Comment authors', [...commentAuthors].join(', '), 'high', 'Names attached to comments.')
  if (changeAuthors.size) add('changes.authors', 'people', 'Tracked-change authors', [...changeAuthors].join(', '), 'high', 'Names (and times) attached to every tracked edit.')
  if (trackedChanges) notes.push(`This document has ${trackedChanges} tracked change${trackedChanges === 1 ? '' : 's'}. Unpin removes the names and times, but deleted text is still inside the file. In Word, accept or reject all changes before sharing.`)
  if (rsids) add('word.rsid', 'device', 'Revision IDs', `${rsids} found`, 'medium', 'Random IDs from each editing session that can link documents edited on the same computer.')

  const mediaWithMeta: string[] = []
  const media = Object.keys(zip.files).filter((p) => MEDIA.test(p))
  for (const p of media) {
    const r = await readImage(await zip.file(p)!.async('uint8array'))
    if (r.fields.length) {
      mediaWithMeta.push(p)
      add(`media.${p}`, r.gps ? 'location' : 'other', `Embedded image ${p.split('/').pop()}`, r.gps ? 'has GPS location and camera data' : `${r.fields.length} metadata fields`, r.gps ? 'high' : 'medium', 'Photos inside documents keep their own EXIF, including location.')
    }
  }
  return { fields: sortFields(fields), notes, trackedChanges, mediaWithMeta }
}

export interface OfficeOptions {
  /** Re-encodes an embedded image without metadata (browser only). */
  cleanImage?: ImageCleaner
}

export async function readOffice(file: Blob, opts: OfficeOptions = {}): Promise<Findings> {
  const zip = await open(new Uint8Array(await file.arrayBuffer()))
  const s = await scan(zip)
  if (Object.keys(zip.files).some((p) => MEDIA.test(p)) && !opts.cleanImage) s.notes.push('Embedded images can\u2019t be re-encoded here; any EXIF they carry will be reported after cleaning.')
  return { fields: s.fields, notes: s.notes }
}

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>`
const EMPTY_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>`

/** Remove a part and every relationship / content-type entry pointing at it. */
async function removePart(zip: Zip, path: string) {
  zip.remove(path)
  const name = path.split('/').pop()!
  for (const relPath of Object.keys(zip.files).filter((p) => p.endsWith('.rels'))) {
    const xml = (await read(zip, relPath))!
    const next = xml.replace(new RegExp(`<Relationship\\b[^>]*Target="(?:[^"]*/)?${escapeRe(name)}"[^>]*/>`, 'g'), '')
    if (next !== xml) zip.file(relPath, next)
  }
  const ct = await read(zip, '[Content_Types].xml')
  if (ct) zip.file('[Content_Types].xml', ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRe(path)}"[^>]*/>`, 'g'), ''))
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function cleanOffice(file: Blob, index: number, ext: string, opts: OfficeOptions = {}): Promise<CleanResult> {
  const t0 = performance.now()
  const zip = await open(new Uint8Array(await file.arrayBuffer()))
  const before = await scan(zip)

  // 1. Document properties
  if (zip.file('docProps/core.xml')) zip.file('docProps/core.xml', EMPTY_CORE)
  if (zip.file('docProps/app.xml')) zip.file('docProps/app.xml', EMPTY_APP)
  if (zip.file('docProps/custom.xml')) await removePart(zip, 'docProps/custom.xml')

  // 2. Word: delete comments entirely; anonymise tracked changes; drop rsids
  //    and the attached-template path.
  const hadWordComments = Boolean(zip.file('word/comments.xml'))
  for (const p of Object.keys(zip.files).filter((x) => COMMENT_PARTS.test(x))) await removePart(zip, p)
  for (const p of Object.keys(zip.files).filter((x) => WORD_PARTS.test(x))) {
    let xml = (await read(zip, p))!
    if (hadWordComments) {
      xml = xml
        .replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/g, '')
        .replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, '')
        .replace(/<w:commentReference\b[^>]*\/>/g, '')
    }
    xml = xml
      .replace(/(<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|numberingChange)\b[^>]*?)\sw:author="[^"]*"/g, `$1 w:author="${ANON}"`)
      .replace(/(<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|numberingChange)\b[^>]*?)\sw:date="[^"]*"/g, '$1')
      .replace(/\sw:rsid\w*="[0-9A-Fa-f]*"/g, '')
      .replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, '')
      .replace(/<w:attachedTemplate\b[^>]*\/>/g, '')
    zip.file(p, xml)
  }
  const settingsRels = await read(zip, 'word/_rels/settings.xml.rels')
  if (settingsRels) zip.file('word/_rels/settings.xml.rels', settingsRels.replace(/<Relationship\b[^>]*attachedTemplate[^>]*\/>/g, ''))

  // 3. Excel: saved folder path; anonymise comment authors.
  const wb = await read(zip, 'xl/workbook.xml')
  if (wb) {
    zip.file('xl/workbook.xml', wb
      .replace(/<mc:AlternateContent\b[^>]*>(?:(?!<\/mc:AlternateContent>)[\s\S])*?x15ac:absPath[\s\S]*?<\/mc:AlternateContent>/g, '')
      .replace(/<x15ac:absPath\b[^>]*\/>/g, ''))
  }
  for (const p of Object.keys(zip.files)) {
    if (/^xl\/comments\d*\.xml$/.test(p)) {
      const xml = (await read(zip, p))!
      const names = [...xml.matchAll(/<author>([^<]*)<\/author>/g)].map((m) => m[1])
      let next = xml.replace(/<author>[^<]*<\/author>/g, `<author>${ANON}</author>`)
      // Excel also prefixes comment text with "Name:"
      for (const n of names) next = next.split(`${n}:`).join(`${ANON}:`)
      zip.file(p, next)
    }
    if (/^xl\/persons\/person\d*\.xml$/.test(p)) {
      zip.file(p, (await read(zip, p))!.replace(/displayName="[^"]*"/g, `displayName="${ANON}"`).replace(/\suserId="[^"]*"/g, '').replace(/\sproviderId="[^"]*"/g, ''))
    }
    // 4. PowerPoint comment authors (classic and modern).
    if (p === 'ppt/commentAuthors.xml' || p === 'ppt/authors.xml') {
      zip.file(p, (await read(zip, p))!.replace(/\bname="[^"]*"/g, `name="${ANON}"`).replace(/\binitials="[^"]*"/g, 'initials="A"').replace(/\suserId="[^"]*"/g, '').replace(/\sproviderId="[^"]*"/g, ''))
    }
  }

  // 5. Embedded photos: re-encode without EXIF when we can.
  const notes: string[] = []
  if (opts.cleanImage) {
    for (const p of before.mediaWithMeta) {
      const cleaned = await opts.cleanImage(await zip.file(p)!.async('uint8array'), p)
      if (cleaned) zip.file(p, cleaned)
    }
  }

  // 6. Neutral timestamps on every ZIP entry.
  for (const f of Object.values(zip.files)) f.date = ZIP_DATE
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: file.type || undefined })
  const verify = await verifyOffice(out)
  if (before.trackedChanges) notes.push(`Tracked changes are still in the document (now anonymous). Deleted text can still be read; accept or reject all changes before sharing.`)
  if (zip.file('xl/comments1.xml') || zip.file('ppt/commentAuthors.xml')) notes.push('Comments were kept but their author names were replaced with “Author”.')
  return {
    blob: new Blob([out as BlobPart], { type: file.type || 'application/octet-stream' }),
    name: `unpinned-${index}.${ext}`,
    verify,
    ms: performance.now() - t0,
    removed: before.fields,
    notes,
  }
}

export async function verifyOffice(bytes: Uint8Array): Promise<Verification> {
  const zip = await open(bytes)
  const s = await scan(zip)
  const notes: string[] = []
  // Independent raw check over every XML part.
  for (const path of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(path)) continue
    const xml = (await read(zip, path)) ?? ''
    if (/<dc:creator>[^<]|<cp:lastModifiedBy>[^<]|<Company>[^<]|<Manager>[^<]|<Template>[^<]/.test(xml)) notes.push(`${path} still has author/company properties`)
    if (/w:date="/.test(xml) && WORD_PARTS.test(path)) notes.push(`${path} still has tracked-change dates`)
    if (/absPath/.test(xml)) notes.push(`${path} still has a saved folder path`)
    if (/attachedTemplate/.test(xml)) notes.push(`${path} still references the template path`)
    if (/w:rsid/.test(xml)) notes.push(`${path} still has revision IDs`)
  }
  if (zip.file('docProps/custom.xml')) notes.push('custom properties still present')
  if (zip.file('word/comments.xml')) notes.push('Word comments still present')
  const remaining = s.fields
  return { clean: remaining.length === 0 && notes.length === 0, remaining, structural: [], notes }
}
