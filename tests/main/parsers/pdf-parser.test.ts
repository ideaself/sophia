/**
 * pdf-parser — extracts page text via unpdf with mergePages:false, skips
 * front matter and adds the browser-global polyfills pdf.js needs in Node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(async () => ({ numPages: 9 }))
}))

vi.mock('unpdf', () => ({
  getDocumentProxy: mocks.getDocumentProxy,
  extractText: mocks.extractText
}))

import { extractPdfText } from '../../../src/main/parsers/pdf-parser'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sophia-pdf-'))
  mocks.extractText.mockReset()
  mocks.getDocumentProxy.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function makePdf(): Promise<string> {
  const path = join(dir, 'book.pdf')
  await writeFile(path, Buffer.from('%PDF-1.4 fake'))
  return path
}

describe('extractPdfText', () => {
  it('joins body pages, skipping front matter', async () => {
    const path = await makePdf()
    mocks.extractText.mockResolvedValue({
      totalPages: 4,
      text: [
        '书名：学习之道\n作者：某人',
        '目 录\n第一章 ……………… 1\n第二章 ……………… 2',
        '第1章 开始\n' + '这是一段足够长的正文内容，用来让散文比例达标；'.repeat(3),
        '继续的正文段落。'
      ]
    })

    const result = await extractPdfText(path)

    expect(mocks.getDocumentProxy).toHaveBeenCalledTimes(1)
    expect(mocks.extractText).toHaveBeenCalledWith({ numPages: 9 }, { mergePages: false })
    expect(result.totalPages).toBe(4)
    expect(result.bodyStartPage).toBe(2)
    expect(result.content.startsWith('第1章 开始')).toBe(true)
    expect(result.content).toContain('继续的正文段落。')
    expect(result.content).not.toContain('目 录')
  })

  it('wraps a non-array text result into a single page', async () => {
    const path = await makePdf()
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: '单页文本' })

    const result = await extractPdfText(path)

    expect(result.content).toBe('单页文本')
    expect(result.totalPages).toBe(1)
    expect(result.bodyStartPage).toBe(0)
  })
})

interface MatrixLike {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  translateSelf(tx: number, ty?: number): MatrixLike
  scaleSelf(sx: number, sy?: number): MatrixLike
  multiplySelf(): MatrixLike
  inverse(): MatrixLike
  toString(): string
}

interface ImageDataLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

const globals = globalThis as unknown as {
  DOMMatrix: new (init?: number[] | null) => MatrixLike
  Path2D: new () => Record<string, () => void>
  ImageData: new (data: Uint8ClampedArray | number, w?: number, h?: number) => ImageDataLike
}

describe('globals polyfills for pdf.js', () => {
  it('provides DOMMatrix with the operations pdf.js performs', () => {
    const m = new globals.DOMMatrix([2, 0, 0, 3, 5, 7])
    expect(m.toString()).toBe('matrix(2, 0, 0, 3, 5, 7)')

    const translated = m.translateSelf(10, 20)
    expect(translated.e).toBe(2 * 10 + 0 * 20 + 5)
    expect(translated.f).toBe(0 * 10 + 3 * 20 + 7)

    const scaled = m.scaleSelf(2)
    expect(scaled.a).toBe(4)
    expect(scaled.b).toBe(0)
    expect(scaled.c).toBe(0)
    expect(scaled.d).toBe(6)

    expect(new globals.DOMMatrix().multiplySelf()).toBeInstanceOf(globals.DOMMatrix)
    expect(new globals.DOMMatrix().inverse()).toBeInstanceOf(globals.DOMMatrix)
    expect(new globals.DOMMatrix(null).toString()).toBe('matrix(1, 0, 0, 1, 0, 0)')
  })

  it('provides Path2D no-ops', () => {
    const p = new globals.Path2D()
    expect(() => {
      p.addPath()
      p.closePath()
      p.moveTo()
      p.lineTo()
      p.quadraticCurveTo()
      p.bezierCurveTo()
      p.rect()
      p.arc()
      p.arcTo()
      p.ellipse()
    }).not.toThrow()
  })

  it('provides ImageData for both constructor shapes', () => {
    const sized = new globals.ImageData(3, 2)
    expect(sized.width).toBe(3)
    expect(sized.height).toBe(2)
    expect(sized.data.length).toBe(3 * 2 * 4)

    const fromData = new globals.ImageData(new Uint8ClampedArray(8), 2, 1)
    expect(fromData.data.length).toBe(8)
    expect(fromData.width).toBe(2)
    expect(fromData.height).toBe(1)

    const defaults = new globals.ImageData(new Uint8ClampedArray(4))
    expect(defaults.width).toBe(0)
    expect(defaults.height).toBe(0)

    expect(new globals.ImageData(1, 1, 1).height).toBe(1)
  })

  it('defaults ImageData height to zero when no height argument is given', () => {
    const sized = new globals.ImageData(3)
    expect(sized.width).toBe(3)
    expect(sized.height).toBe(0)
    expect(sized.data.length).toBe(3 * 0 * 4)
  })

  it('keeps pre-existing pdf.js globals when they are already defined', async () => {
    const g = globalThis as unknown as Record<string, unknown>
    const original = { DOMMatrix: g.DOMMatrix, Path2D: g.Path2D, ImageData: g.ImageData }
    class StubMatrix {}
    class StubPath {}
    class StubImage {}
    g.DOMMatrix = StubMatrix
    g.Path2D = StubPath
    g.ImageData = StubImage
    try {
      vi.resetModules()
      await import('../../../src/main/parsers/pdf-parser')
      expect(g.DOMMatrix).toBe(StubMatrix)
      expect(g.Path2D).toBe(StubPath)
      expect(g.ImageData).toBe(StubImage)
    } finally {
      g.DOMMatrix = original.DOMMatrix
      g.Path2D = original.Path2D
      g.ImageData = original.ImageData
    }
  })
})
