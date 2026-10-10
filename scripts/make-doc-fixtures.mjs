/**
 * Build PDF and Office fixtures that carry identifying metadata.
 *   node scripts/make-doc-fixtures.mjs
 */
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures')
const FIXED = new Date(Date.UTC(2024, 5, 1, 8, 14, 22))

// ------------------------------------------------------------------ PDF
{
  const doc = await PDFDocument.create({ updateMetadata: false })
  const page = doc.addPage([400, 300])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Quarterly notes', { x: 40, y: 240, size: 18, font })
  doc.setTitle('Notes - Jamie Doe - DRAFT')
  doc.setAuthor('Jamie Doe')
  doc.setSubject('Springfield office')
  doc.setKeywords(['private', 'springfield'])
  doc.setCreator('Writer 7.1 (jamie-laptop)')
  doc.setProducer('PDF Printer 2.0')
  doc.setCreationDate(FIXED)
  doc.setModificationDate(FIXED)
  // XMP stream on the catalog
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"><dc:creator><rdf:Seq><rdf:li>Jamie Doe</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Writer 7.1</xmp:CreatorTool><xmpMM:DocumentID>uuid:1b4e28ba-2fa1-11d2-883f-0016d3cca427</xmpMM:DocumentID></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream))
  // A sticky-note comment with an author
  const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [40, 200, 60, 220], Contents: PDFString.of('check numbers'), T: PDFString.of('Jamie Doe'), M: PDFString.of('D:20240601081422Z') })
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]))
  writeFileSync(resolve(OUT, 'sample.pdf'), await doc.save({ useObjectStreams: true }))
}

// --------------------------------------------------------------- Office
const CT = (overrides) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`
const ROOT_RELS = (main) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`
const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Budget - Jamie</dc:title><dc:creator>Jamie Doe</dc:creator><cp:lastModifiedBy>Alex Smith</cp:lastModifiedBy><cp:revision>14</cp:revision><cp:keywords>springfield</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">2024-06-01T08:14:22Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2024-06-03T17:02:00Z</dcterms:modified><cp:lastPrinted>2024-06-02T09:00:00Z</cp:lastPrinted></cp:coreProperties>`
const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>C:\\Users\\JamieDoe\\Templates\\Letter.dotm</Template><TotalTime>342</TotalTime><Application>Microsoft Office Word</Application><Company>Springfield Nuclear</Company><Manager>Monty Burns</Manager><AppVersion>16.0000</AppVersion></Properties>`
const CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ClientName"><vt:lpwstr>Jamie Doe</vt:lpwstr></property></Properties>`
const photo = readFileSync(resolve(OUT, 'gps.jpg'))

async function write(name, files) {
  const zip = new JSZip()
  for (const [path, data] of Object.entries(files)) zip.file(path, data, { date: FIXED })
  writeFileSync(resolve(OUT, name), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

// DOCX: comments, tracked changes, rsids, attached template, embedded GPS photo
await write('sample.docx', {
  '[Content_Types].xml': CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'),
  '_rels/.rels': ROOT_RELS('word/document.xml'),
  'docProps/core.xml': CORE,
  'docProps/app.xml': APP,
  'docProps/custom.xml': CUSTOM,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/></Relationships>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6"><w:commentRangeStart w:id="0"/><w:r w:rsidR="00A1B2C3"><w:t>Hello from the budget.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r><w:ins w:id="1" w:author="Alex Smith" w:date="2024-06-03T17:00:00Z"><w:r><w:t> Added line.</w:t></w:r></w:ins><w:del w:id="2" w:author="Jamie Doe" w:date="2024-06-02T10:00:00Z"><w:r><w:delText> Secret old line.</w:delText></w:r></w:del></w:p><w:sectPr/></w:body></w:document>`,
  'word/comments.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Alex Smith" w:date="2024-06-03T16:00:00Z" w:initials="AS"><w:p><w:r><w:t>Is this the real number?</w:t></w:r></w:p></w:comment></w:comments>`,
  'word/people.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Alex Smith"><w15:presenceInfo w15:providerId="AD" w15:userId="alex.smith@springfield.example"/></w15:person></w15:people>`,
  'word/settings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="rId1"/><w:trackRevisions/><w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids></w:settings>`,
  'word/_rels/settings.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:\\Users\\JamieDoe\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm" TargetMode="External"/></Relationships>`,
  'word/media/image1.jpeg': photo,
})

// XLSX: file path with real name, comment authors
await write('sample.xlsx', {
  '[Content_Types].xml': CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>'),
  '_rels/.rels': ROOT_RELS('xl/workbook.xml'),
  'docProps/core.xml': CORE,
  'docProps/app.xml': APP,
  'docProps/custom.xml': CUSTOM,
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15ac" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"><mc:AlternateContent><mc:Choice Requires="x15ac"><x15ac:absPath url="C:\\Users\\JamieDoe\\Documents\\Taxes\\" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>42</t></is></c></row></sheetData></worksheet>`,
  'xl/worksheets/_rels/sheet1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>`,
  'xl/comments1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Jamie Doe</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>Jamie Doe:
double check</t></r></text></comment></commentList></comments>`,
})

// PPTX: comment authors
await write('sample.pptx', {
  '[Content_Types].xml': CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/>'),
  '_rels/.rels': ROOT_RELS('ppt/presentation.xml'),
  'docProps/core.xml': CORE,
  'docProps/app.xml': APP,
  'docProps/custom.xml': CUSTOM,
  'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/></Relationships>`,
  'ppt/commentAuthors.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cmAuthor id="0" name="Jamie Doe" initials="JD" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`,
})

// A broken PDF for error handling
writeFileSync(resolve(OUT, 'corrupt.pdf'), '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R')
console.log('doc fixtures written')
