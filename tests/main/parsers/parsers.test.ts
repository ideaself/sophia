import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { extractText } from '../../../src/main/parsers'
import { getEpubChapters, epubChaptersToText } from '../../../src/main/parsers/epub-parser'

// ---------------------------------------------------------------
// Fixture builders (dependency-free, deterministic)
// ---------------------------------------------------------------

/** Build a minimal single-page PDF containing the given text, with a valid xref table. */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  let xref = `xref\n0 ${objects.length + 1}\n`
  xref += '0000000000 65535 f \n'
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += xref
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

// --- Minimal ZIP writer (STORED / uncompressed entries) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8')
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    local.writeUInt16LE(0, 8) // STORED
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, entry.data)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // version made by
    cen.writeUInt16LE(20, 6) // version needed
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(0, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(entry.data.length, 20)
    cen.writeUInt32LE(entry.data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cen, nameBuf]))

    offset += local.length + nameBuf.length + entry.data.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, centralBuf, end])
}

/** Build a minimal valid EPUB with one chapter. */
function buildMinimalEpub(opts: { title: string; creator: string; chapterHtml: string }): Buffer {
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${opts.title}</dc:title>
    <dc:creator>${opts.creator}</dc:creator>
    <dc:identifier id="id">urn:uuid:test-fixture</dc:identifier>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`

  return buildZip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf-8') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml, 'utf-8') },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf, 'utf-8') },
    { name: 'OEBPS/ch1.xhtml', data: Buffer.from(opts.chapterHtml, 'utf-8') }
  ])
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

let fixtureDir: string

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'sophia-parsers-'))
})

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

describe('extractText — format dispatch', () => {
  it('throws for unsupported file formats', async () => {
    await expect(extractText(join(fixtureDir, 'book.txt'))).rejects.toThrow(
      'Unsupported file format'
    )
  })
})

describe('extractText — PDF', () => {
  it('extracts text content and page count from a PDF', async () => {
    const pdfPath = join(fixtureDir, 'hello.pdf')
    await writeFile(pdfPath, buildMinimalPdf('Hello Sophia'))

    const result = await extractText(pdfPath)

    expect(result.content).toContain('Hello Sophia')
    expect(result.totalPages).toBe(1)
  })
})

describe('extractText — EPUB', () => {
  it('extracts title, author, and chapter text from an EPUB', async () => {
    const epubPath = join(fixtureDir, 'book.epub')
    const chapterHtml = `<html><body>
      <h1>第一章 起点</h1>
      <p>苏格拉底走在雅典的街头。</p>
      <p>他问：什么是知识？</p>
    </body></html>`
    await writeFile(
      epubPath,
      buildMinimalEpub({ title: '测试之书', creator: '柏拉图', chapterHtml })
    )

    const result = await extractText(epubPath)

    expect(result.content).toContain('# 测试之书')
    expect(result.content).toContain('Author: 柏拉图')
    expect(result.content).toContain('苏格拉底走在雅典的街头。')
    expect(result.content).toContain('他问：什么是知识？')
    expect(result.content).not.toContain('<p>')
    expect(result.totalPages).toBe(1)
  })
})

// ---------------------------------------------------------------
// Richer EPUB fixtures + chapter APIs
// ---------------------------------------------------------------

/** Two spine chapters (one non-xhtml media type) plus one PNG image. */
function buildMultiChapterEpub(opts?: { emptySpine?: boolean }): Buffer {
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>多章之书</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:identifier id="id">urn:uuid:multi-chapter</dc:identifier>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.html" media-type="text/html"/>
    <item id="fig" href="Images/pic.png" media-type="image/png"/>
  </manifest>
  ${opts?.emptySpine ? '<spine></spine>' : '<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>'}
</package>`

  const ch1 = `<html><head><title>一</title></head><body>
    <h1>第一章 温度</h1>
    <p>温度是分子平均动能的度量。</p>
    <p>热量从高温流向低温 &amp; 从不例外。</p>
    <img src="Images/pic.png" alt="图"/>
  </body></html>`

  const ch2 = `<html><body><h1>第二章 熵</h1><p>熵是状态函数。</p></body></html>`

  // Minimal 1x1 PNG payload.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )

  return buildZip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf-8') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml, 'utf-8') },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf, 'utf-8') },
    { name: 'OEBPS/ch1.xhtml', data: Buffer.from(ch1, 'utf-8') },
    { name: 'OEBPS/ch2.html', data: Buffer.from(ch2, 'utf-8') },
    { name: 'OEBPS/Images/pic.png', data: png }
  ])
}

describe('getEpubChapters', () => {
  it('returns spine chapters as body-only html, inlining images as data URIs', async () => {
    const epubPath = join(fixtureDir, 'multi.epub')
    await writeFile(epubPath, buildMultiChapterEpub())

    const result = await getEpubChapters(epubPath)

    expect(result.title).toBe('多章之书')
    expect(result.author).toBe('测试作者')
    expect(result.chapters).toHaveLength(2)

    const first = result.chapters[0]
    expect(first.html).toContain('温度是分子平均动能的度量')
    // Body wrapper must be stripped so the reader can inject it into a div.
    expect(first.html.toLowerCase()).not.toContain('<body')
    expect(first.html).not.toContain('<img src="Images/pic.png"')
    expect(first.html).toMatch(/data:image\/png;base64,/)

    expect(result.chapters[1].html).toContain('熵是状态函数')
  })

  it('falls back to a manifest scan when the spine is empty', async () => {
    const epubPath = join(fixtureDir, 'no-spine.epub')
    await writeFile(epubPath, buildMultiChapterEpub({ emptySpine: true }))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await getEpubChapters(epubPath)

    expect(result.chapters.length).toBeGreaterThanOrEqual(1)
    expect(result.chapters[0].title).toMatch(/第 1 节/)
    expect(result.chapters[0].html).toContain('温度是分子平均动能的度量')
    warn.mockRestore()
  })
})

describe('extractEpubText with mixed media types', () => {
  it('extracts both chapters including the text/html one', async () => {
    const epubPath = join(fixtureDir, 'mixed.epub')
    await writeFile(epubPath, buildMultiChapterEpub())

    const result = await extractText(epubPath)

    expect(result.content).toContain('# 多章之书')
    expect(result.content).toContain('Author: 测试作者')
    expect(result.content).toContain('温度是分子平均动能的度量')
    expect(result.content).toContain('热量从高温流向低温 & 从不例外')
    expect(result.content).toContain('熵是状态函数')
    expect(result.totalPages).toBe(2)
  })
})

describe('epubChaptersToText', () => {
  it('flattens title, author and chapter text with entity decoding', () => {
    const text = epubChaptersToText({
      title: '书',
      author: '作者',
      chapters: [
        { id: 'a', title: '第一章', html: '<p>第一段</p><p>第二段 &gt; 结束</p>' },
        { id: 'b', title: '空章', html: '<p>   </p>' },
        { id: 'c', title: '第三章', html: '<p>结尾 &#65;&#x42;</p>' }
      ]
    })

    expect(text).toContain('# 书')
    expect(text).toContain('Author: 作者')
    expect(text).toContain('第一段')
    expect(text).toContain('第二段 > 结束')
    expect(text).toContain('结尾 AB')
    // Empty chapters contribute nothing but a separator.
    expect(text).not.toContain('空章')
  })

  it('handles missing metadata', () => {
    const text = epubChaptersToText({
      title: '',
      author: '',
      chapters: [{ id: 'a', title: 't', html: '<body><p>只有正文</p></body>' }]
    })
    expect(text.trim()).toBe('只有正文')
  })
})
