/**
 * epub-parser edge paths — chapter-load fallbacks, manifest scan, image
 * inlining (both src shapes, cache, basename fallback) and mime guessing,
 * driven through a scripted `epub` module double.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */
const mocks = vi.hoisted(() => ({ config: {} as any }))

vi.mock('epub', () => ({
  EPub: class {
    constructor() {
      Object.assign(this, mocks.config)
    }
    parse = async (): Promise<void> => {}
  }
}))

import {
  extractEpubText,
  getEpubChapters,
  epubChaptersToText
} from '../../../src/main/parsers/epub-parser'

const b64 = (s: string): string => Buffer.from(s).toString('base64')

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.config = {}
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('extractEpubText — chapter loading fallbacks', () => {
  it('falls back to raw reads, warns on missing href and reports total pages', async () => {
    mocks.config = {
      metadata: { title: '书名', creator: '作者' },
      flow: [
        { id: 'c1', href: 'text/c1.xhtml' },
        { id: 'c2' },
        { id: 'c3', href: 'text/c3.xhtml' },
        { id: 'c4', href: 'text/c4.xhtml' }
      ],
      getChapter: vi.fn(async (id: string) => {
        if (id === 'c1') throw new Error('bad media-type')
        if (id === 'c3') throw 'plain rejection'
        throw new Error('nope')
      }),
      readFile: vi.fn(async (name: string) => {
        if (name === 'text/c1.xhtml') {
          return Buffer.from('<html><head><style>p{}</style></head><body><p>章节一</p></body></html>')
        }
        if (name === 'text/c3.xhtml') throw new Error('gone')
        throw 'string-fail'
      })
    }

    const result = await extractEpubText('book.epub')

    expect(result.content).toContain('# 书名')
    expect(result.content).toContain('Author: 作者')
    expect(result.content).toContain('章节一')
    expect(result.content).not.toContain('p{}')
    expect(result.totalPages).toBe(4)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no href to fall back to'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('raw-read fallback also failed: gone'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('raw-read fallback also failed: string-fail'))
  })

  it('handles missing metadata and chapters whose text is empty', async () => {
    mocks.config = {
      metadata: {},
      flow: [
        { id: 'c1', href: 'text/empty.xhtml' },
        { id: 'c2', href: 'text/body.xhtml' }
      ],
      getChapter: vi.fn(async (id: string) =>
        id === 'c1' ? '<body><p>   </p></body>' : '<body><p>正文</p></body>'
      )
    }

    const result = await extractEpubText('no-metadata.epub')

    expect(result.content).toBe('正文\n')
    expect(result.totalPages).toBe(2)
  })
})

describe('getEpubChapters — spine and manifest fallback', () => {
  it('uses spine order, chapter titles and index-based fallbacks', async () => {
    mocks.config = {
      metadata: { title: 'T', creator: 'A' },
      flow: [
        { id: 'c1', href: 'text/a.xhtml', title: '第一节', index: 1 },
        { id: 'c2', href: 'text/b.xhtml' }
      ],
      getChapter: vi.fn(async (id: string) =>
        id === 'c1' ? '<body><p>甲</p></body>' : '<p>乙</p>'
      ),
      readFile: vi.fn(),
      manifest: {},
      imageroot: '/images/'
    }

    const result = await getEpubChapters('book.epub')

    expect(result.title).toBe('T')
    expect(result.author).toBe('A')
    expect(result.chapters.map((c) => c.title)).toEqual(['第一节', 'Chapter undefined'])
    expect(result.chapters[0].html).toBe('<p>甲</p>')
    expect(result.chapters[1].html).toBe('<p>乙</p>')
  })

  it('scans the manifest when the spine yields nothing', async () => {
    mocks.config = {
      metadata: {},
      flow: [],
      manifest: {
        m1: { id: 'm1', href: 'a.xhtml', 'media-type': 'application/xhtml+xml' },
        m2: { id: 'm2', 'media-type': 'application/xhtml+xml' },
        m3: { id: 'm3', href: 'a.xhtml', 'media-type': 'text/html' },
        m4: { id: 'm4', href: 'b.htm' },
        m5: { id: 'm5', href: 'c.html' },
        m6: { id: 'm6', href: 'd.xhtml', 'media-type': 'application/x-dtbook+xml' },
        m7: { id: 'm7', href: 'style.css', 'media-type': 'text/css' }
      },
      getChapter: vi.fn(async () => {
        throw new Error('unused')
      }),
      readFile: vi.fn(async (name: string) => {
        if (name === 'a.xhtml') return '<body><p>A</p></body>'
        if (name === 'd.xhtml') return Buffer.from('<p>D</p>')
        if (name === 'b.htm') throw new Error('boom')
        throw 'string-boom'
      })
    }

    const result = await getEpubChapters('book.epub')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to manifest scan'))
    expect(result.chapters.map((c) => [c.id, c.title, c.html])).toEqual([
      ['m1', '第 1 节', '<p>A</p>'],
      ['m3', '第 2 节', '<p>A</p>'],
      ['m6', '第 3 节', '<p>D</p>']
    ])
    expect(result.title).toBe('')
    expect(result.author).toBe('')
    expect(warn).toHaveBeenCalledWith('[epub-parser] Manifest scan: failed to read b.htm:', 'boom')
    expect(warn).toHaveBeenCalledWith('[epub-parser] Manifest scan: failed to read c.html:', 'string-boom')
  })

  it('warns when nothing is readable at all', async () => {
    mocks.config = {
      metadata: {},
      flow: [],
      manifest: {},
      getChapter: vi.fn(),
      readFile: vi.fn()
    }

    const result = await getEpubChapters('empty.epub')

    expect(result.chapters).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no readable chapters'))
  })

  it('skips chapters that fail to load and chapters without an href', async () => {
    mocks.config = {
      metadata: {},
      flow: [{ id: 'bad' }, { id: 'nohref' }, { id: 'good', href: 'text/good.xhtml' }],
      getChapter: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('media-type rejected')
        if (id === 'nohref') return '<body><p>无链接章节</p></body>'
        return '<body><p>有链接章节</p></body>'
      }),
      readFile: vi.fn(async () => {
        throw new Error('raw read unavailable')
      }),
      imageroot: '/images/'
      // manifest intentionally omitted — inlining must degrade to {}
    }

    const result = await getEpubChapters('partial.epub')

    expect(result.chapters.map((c) => [c.id, c.html])).toEqual([
      ['nohref', '<p>无链接章节</p>'],
      ['good', '<p>有链接章节</p>']
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no href to fall back to'))
  })

  it('warns without crashing when the manifest is missing entirely', async () => {
    mocks.config = {
      metadata: {},
      flow: [],
      getChapter: vi.fn(),
      readFile: vi.fn()
      // manifest intentionally omitted so the fallback scan uses {}
    }

    const result = await getEpubChapters('no-manifest.epub')

    expect(result.chapters).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no readable chapters'))
  })
})

describe('getEpubChapters — image inlining', () => {
  it('inlines both src shapes, caches repeats and leaves unresolvable images', async () => {
    const images: Record<string, Buffer> = {
      'OEBPS/Images/cover.jpg': Buffer.from('JPG'),
      'OEBPS/Images/logo.png': Buffer.from('PNG'),
      'OEBPS/assets/Images/missed.png': Buffer.from('MISS'),
      'OEBPS/Images/a.gif': Buffer.from('GIF'),
      'OEBPS/Images/b.webp': Buffer.from('WEBP'),
      'OEBPS/Images/c.svg': Buffer.from('SVG'),
      'OEBPS/Images/d.bmp': Buffer.from('BMP'),
      'OEBPS/Images/e.ico': Buffer.from('ICO'),
      'OEBPS/Images/f.xyz': Buffer.from('XYZ'),
      'Images/inline.png': Buffer.from('INLINE')
    }

    const chapterHtml = [
      '<body>',
      '<img src="../Images/cover.jpg" alt="c1">',
      '<img src="../Images/cover.jpg" alt="c2">',
      '<img src=".././Images/cover.jpg" alt="c3">',
      '<img src="Images//inline.png" alt="c4">',
      '<img src="/images/img1/../Images/logo.png">',
      '<img src="/images/noslash.png">',
      '<img src="/images/nohref/x.png">',
      '<img src="data:image/png;base64,AAAA">',
      '<img src="https://cdn.example.com/x.png">',
      '<img src="#frag-only">',
      '<img src="../Images/sub/missed.png">',
      '<img src="../Images/nowhere.gif">',
      '<img src="../Images/a.gif">',
      '<img src="../Images/b.webp">',
      '<img src="../Images/c.svg">',
      '<img src="../Images/d.bmp">',
      '<img src="../Images/e.ico">',
      '<img src="../Images/f.xyz">',
      '<image xlink:href="../Images/cover.jpg"/>',
      '</body>'
    ].join('')

    mocks.config = {
      metadata: {},
      flow: [
        { id: 'c1', href: 'OEBPS/text/ch1.xhtml' },
        { id: 'c2', href: 'cover.xhtml' }
      ],
      manifest: {
        img1: { id: 'img1', href: 'OEBPS/Images/logo.png', 'media-type': 'image/png' },
        nohref: { id: 'nohref', 'media-type': 'image/png' },
        css: { id: 'css', href: 'OEBPS/style.css', 'media-type': 'text/css' },
        missed: { id: 'missed', href: 'OEBPS/assets/Images/missed.png', 'media-type': 'image/png' }
      },
      imageroot: '/images/',
      getChapter: vi.fn(async (id: string) =>
        id === 'c1' ? chapterHtml : '<body><img src="Images/inline.png"></body>'
      ),
      readFile: vi.fn(async (name: string) => {
        const buf = images[name]
        if (!buf) throw new Error(`ENOENT: ${name}`)
        return buf
      })
    }

    const result = await getEpubChapters('book.epub')
    const ch1 = result.chapters[0].html
    const ch2 = result.chapters[1].html

    // Both relative and getChapter-rewritten shapes become data URIs.
    expect(ch1).toContain('data:image/jpeg;base64,' + b64('JPG'))
    expect(ch1).toContain('data:image/png;base64,' + b64('PNG')) // logo via manifest id
    expect(ch1).toContain('data:image/png;base64,' + b64('MISS')) // basename fallback
    expect(ch1).toContain('data:image/gif;base64,' + b64('GIF'))
    expect(ch1).toContain('data:image/webp;base64,' + b64('WEBP'))
    expect(ch1).toContain('data:image/svg+xml;base64,' + b64('SVG'))
    expect(ch1).toContain('data:image/bmp;base64,' + b64('BMP'))
    expect(ch1).toContain('data:image/x-icon;base64,' + b64('ICO'))
    expect(ch1).toContain('data:application/octet-stream;base64,' + b64('XYZ'))

    // Untouched sources.
    expect(ch1).toContain('src="data:image/png;base64,AAAA"')
    expect(ch1).toContain('src="https://cdn.example.com/x.png"')
    expect(ch1).toContain('src="#frag-only"')
    expect(ch1).toContain('src="../Images/nowhere.gif"')
    expect(ch1).toContain('<image xlink:href="data:image/jpeg;base64,' + b64('JPG') + '"')

    // Repeated src only read once.
    const coverReads = (mocks.config.readFile as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args) => args[0] === 'OEBPS/Images/cover.jpg'
    )
    expect(coverReads).toHaveLength(1)

    // Chapter without a directory component still resolves.
    expect(ch2).toContain('data:image/png;base64,' + b64('INLINE'))

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inline image OEBPS/Images/nowhere.gif'),
      'ENOENT: OEBPS/Images/nowhere.gif'
    )
  })

  it('returns the body unchanged when nothing is inlinable', async () => {
    mocks.config = {
      metadata: {},
      flow: [{ id: 'c1', href: 'text/a.xhtml' }],
      manifest: {},
      imageroot: '/images/',
      getChapter: vi.fn(async () => '<body><img src="https://x/y.png"></body>'),
      readFile: vi.fn()
    }

    const result = await getEpubChapters('book.epub')

    expect(result.chapters[0].html).toBe('<img src="https://x/y.png">')
    expect(mocks.config.readFile).not.toHaveBeenCalled()
  })

  it('falls back to basename matching and survives unresolvable images', async () => {
    const chapterHtml = [
      '<body>',
      '<img src=".">',
      '<img src="../Images/plain.png">',
      '<img src="../Images/broken.png">',
      '<img src="../Images/strerr.png">',
      '</body>'
    ].join('')

    mocks.config = {
      metadata: {},
      flow: [{ id: 'c1', href: 'ch1.xhtml' }],
      manifest: {
        // No media-type -> mime must be inferred from the extension.
        plain: { id: 'plain', href: 'assets/Images/plain.png' },
        // Direct path and manifest href both fail -> unresolved.
        broken: { id: 'broken', href: 'assets/Images/broken.png', 'media-type': 'image/png' },
        // readFile throws a non-Error value.
        strerr: { id: 'strerr', href: 'assets/Images/strerr.png', 'media-type': 'image/png' }
      },
      imageroot: '/images/',
      getChapter: vi.fn(async () => chapterHtml),
      readFile: vi.fn(async (name: string) => {
        if (name === 'assets/Images/plain.png') return Buffer.from('PLAIN')
        if (name === 'assets/Images/strerr.png') throw 'raw-string-fail'
        throw new Error(`ENOENT: ${name}`)
      })
    }

    const result = await getEpubChapters('image-edge.epub')
    const html = result.chapters[0].html

    expect(html).toContain('data:image/png;base64,' + b64('PLAIN'))
    expect(html).toContain('src="."')
    expect(html).toContain('src="../Images/broken.png"')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inline image assets/Images/strerr.png'),
      'raw-string-fail'
    )
  })
})

describe('epubChaptersToText', () => {
  it('renders header and skips chapters with no text', () => {
    const text = epubChaptersToText({
      title: '书名',
      author: '作者',
      chapters: [
        { id: 'a', title: 'a', html: '<p>正文一</p>' },
        { id: 'b', title: 'b', html: '<p></p>' }
      ]
    })

    expect(text).toBe('# 书名\nAuthor: 作者\n\n正文一\n')
  })

  it('handles a book with no metadata', () => {
    const text = epubChaptersToText({
      title: '',
      author: '',
      chapters: [{ id: 'a', title: 'a', html: '<p>只有正文</p>' }]
    })
    expect(text).toBe('只有正文\n')
  })
})
