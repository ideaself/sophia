// @vitest-environment jsdom
/**
 * PdfReaderView — document loading (incl. failure paths), page navigation,
 * zoom, text-layer setup, cross-page search and reading-note flows.
 *
 * pdfjs-dist is replaced by a fake document/text-layer so nothing touches
 * canvas or the real worker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const pdfState = vi.hoisted(() => ({
  getDocument: vi.fn(),
  textLayers: [] as Array<{ render: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }>
}))

vi.mock('pdfjs-dist', () => {
  class OutputScale {
    sx = 2
    sy = 2
    get scaled(): boolean {
      return true
    }
  }
  class TextLayer {
    opts: { container: HTMLElement }
    render = vi.fn(async () => {
      // Chinese text: a single English word would open the dictionary popup.
      this.opts.container.textContent = '熵是状态函数'
    })
    cancel = vi.fn()
    update = vi.fn()
    constructor(opts: { container: HTMLElement }) {
      this.opts = opts
      pdfState.textLayers.push(this as unknown as (typeof pdfState.textLayers)[number])
    }
  }
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    OutputScale,
    TextLayer,
    Util: {
      transform: (m: number[], p: number[]) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
    },
    getDocument: (opts: unknown) => pdfState.getDocument(opts)
  }
})

vi.mock('../../../src/renderer/src/components/DictionaryPopup', () => ({
  DictionaryPopup: () => <div data-testid="dict-popup" />
}))

import { PdfReaderView } from '../../../src/renderer/src/reader/PdfReaderView'

const data = {
  readTextbookOriginal: vi.fn(),
  getTextbook: vi.fn(),
  updateTextbookProgress: vi.fn(),
  listReadingNotes: vi.fn(),
  createReadingNote: vi.fn(),
  updateReadingNote: vi.fn(),
  deleteReadingNote: vi.fn()
}

const PAGE_TEXTS = ['第一章 温度 内容', '第二章 熵 内容 熵 内容', '第三章 热机 内容']

function makeDoc(pageTexts = PAGE_TEXTS): {
  numPages: number
  getPage: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
} {
  const pages = pageTexts.map((text) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      transform: [scale, 0, 0, -scale, 0, 800 * scale]
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    streamTextContent: vi.fn(() => ({})),
    getTextContent: vi.fn(async () => ({
      items: [{ str: text, transform: [1, 0, 0, 10, 100, 740], width: text.length * 10, height: 10 }],
      styles: {}
    }))
  }))
  return {
    numPages: pageTexts.length,
    getPage: vi.fn(async (n: number) => pages[n - 1]),
    destroy: vi.fn(async () => {})
  }
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(data)) fn.mockClear()
  pdfState.getDocument.mockReset()
  pdfState.textLayers.length = 0

  data.readTextbookOriginal.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), fileName: 'thermo.pdf' })
  data.getTextbook.mockResolvedValue({
    id: 'tb_1',
    title: '热力学讲义',
    progress: { currentPage: 1, totalPages: 3, readingPercentage: 0.33, lastPosition: '' }
  })
  data.updateTextbookProgress.mockResolvedValue(null)
  data.listReadingNotes.mockResolvedValue([])
  data.createReadingNote.mockResolvedValue(true)
  data.updateReadingNote.mockResolvedValue(true)
  data.deleteReadingNote.mockResolvedValue(true)

  pdfState.getDocument.mockImplementation(() => ({
    promise: Promise.resolve(makeDoc()),
    destroy: vi.fn(async () => {})
  }))

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data }
  })

  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Range.prototype.getBoundingClientRect = (() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({})
  })) as never
})

afterEach(cleanup)

function canvasEl(): HTMLCanvasElement {
  const el = document.querySelector('canvas')
  if (!el) throw new Error('canvas not rendered')
  return el
}

describe('PdfReaderView — loading', () => {
  it('loads the document, sizes the canvas and builds the text layer', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)

    await waitFor(() => expect(pdfState.getDocument).toHaveBeenCalled())
    expect(data.readTextbookOriginal).toHaveBeenCalledWith('tb_1')

    const canvas = await waitFor(() => canvasEl())
    // viewport 600×800 at scale 1.5 × OutputScale 2.
    expect(canvas.style.width).toBe('900px')
    expect(canvas.style.height).toBe('1200px')
    expect(canvas.width).toBe(1800)

    await waitFor(() => expect(pdfState.textLayers).toHaveLength(1))
    const textLayerDiv = document.querySelector('.textLayer') as HTMLElement
    expect(textLayerDiv.textContent).toBe('熵是状态函数')
    expect(textLayerDiv.style.getPropertyValue('--total-scale-factor')).toBe('1.5')

    // Page indicator in the footer input.
    const pageInput = screen.getByTitle('输入页码后回车跳转') as HTMLInputElement
    expect(pageInput.value).toBe('1')
  })

  it('reports a missing original file', async () => {
    data.readTextbookOriginal.mockResolvedValue(null)
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)

    expect(await screen.findByText('该教材没有原件')).toBeTruthy()
  })

  it('reports document load failures', async () => {
    pdfState.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('损坏的 PDF')),
      destroy: vi.fn(async () => {})
    }))
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)

    expect(await screen.findByText('损坏的 PDF')).toBeTruthy()
  })
})

describe('PdfReaderView — navigation and zoom', () => {
  it('pages with the footer buttons, page input and arrow keys', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTitle('下一页 (→)'))
    await waitFor(() => expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('2'))

    fireEvent.click(screen.getByTitle('上一页 (←)'))
    await waitFor(() => expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('1'))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('2'))

    // Out-of-range page numbers are clamped.
    const pageInput = screen.getByTitle('输入页码后回车跳转')
    fireEvent.change(pageInput, { target: { value: '99' } })
    fireEvent.keyDown(pageInput, { key: 'Enter' })
    await waitFor(() => expect((pageInput as HTMLInputElement).value).toBe('3'))
  })

  it('zooms with the −/+ buttons and fits the width', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(canvasEl().style.width).toBe('900px'))

    fireEvent.click(screen.getByText('+'))
    await waitFor(() => expect(canvasEl().style.width).toBe('1050px'))

    fireEvent.click(screen.getByText('−'))
    await waitFor(() => expect(canvasEl().style.width).toBe('900px'))

    fireEvent.click(screen.getByText('适应宽度'))
    await waitFor(() => expect(canvasEl().style.width).toBe('768px'))
  })

  it('closes through the toolbar button', async () => {
    const onClose = vi.fn()
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={onClose} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PdfReaderView — search', () => {
  it('finds hits across pages, jumps to the first one and reports misses', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const input = await screen.findByPlaceholderText('输入关键词，回车搜索...')
    fireEvent.change(input, { target: { value: '熵' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('第 2 页 · 2 处')).toBeTruthy()
    await waitFor(() => expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('2'))

    // Clicking the hit keeps the page (already the first hit).
    fireEvent.click(screen.getByText('第 2 页 · 2 处'))
    await waitFor(() => expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('2'))

    // A term that does not exist reports "no match".
    fireEvent.change(input, { target: { value: '不存在的词' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('未找到匹配')).toBeTruthy()
  })

  it('closes the search popover with Escape', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTitle('在 PDF 中搜索 (Ctrl+F)'))
    expect(await screen.findByPlaceholderText('输入关键词，回车搜索...')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('输入关键词，回车搜索...')).toBeNull())
  })
})

describe('PdfReaderView — notes and selection', () => {
  it('creates a highlight from the selection toolbar', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    // The text layer is the selectable area; select its text and release.
    const textLayerDiv = document.querySelector('.textLayer') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(textLayerDiv)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.mouseUp(textLayerDiv)

    fireEvent.click(await screen.findByTitle('高亮这段文字'))

    await waitFor(() =>
      expect(data.createReadingNote).toHaveBeenCalledWith({
        textbookId: 'tb_1',
        content: '熵是状态函数',
        position: '1',
        chapter: '第 1 页',
        type: 'highlight',
        readerNote: ''
      })
    )
  })

  it('writes a note with the draft text', async () => {
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    const textLayerDiv = document.querySelector('.textLayer') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(textLayerDiv)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    fireEvent.mouseUp(textLayerDiv)

    fireEvent.click(await screen.findByTitle('为这段文字写一条笔记'))
    const draft = await screen.findByPlaceholderText(/笔记（第 1 页）/)
    fireEvent.change(draft, { target: { value: '要背' } })
    fireEvent.click(screen.getByText('保存笔记'))

    await waitFor(() =>
      expect(data.createReadingNote).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'note', readerNote: '要背', position: '1' })
      )
    )
  })

  it('lists, edits and deletes notes from the notes panel', async () => {
    data.listReadingNotes.mockResolvedValue([
      {
        id: 'n1',
        textbookId: 'tb_1',
        content: '熵',
        position: '2',
        chapter: '第 2 页',
        type: 'note',
        color: '',
        readerNote: '重点',
        createdAt: '2026-09-16T10:00:00Z',
        updatedAt: '2026-09-16T10:00:00Z'
      }
    ])
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)
    await waitFor(() => expect(pdfState.textLayers.length).toBeGreaterThan(0))

    fireEvent.click(screen.getByTitle('阅读批注（选中文本后可用高亮 / 笔记）'))
    expect(await screen.findByText(/📝 笔记 · 第 2 页/)).toBeTruthy()

    fireEvent.click(screen.getByText('编辑'))
    const editArea = await screen.findByPlaceholderText('写点想法...')
    fireEvent.change(editArea, { target: { value: '期末必考' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(data.updateReadingNote).toHaveBeenCalledWith('n1', 'tb_1', { readerNote: '期末必考' })
    )

    fireEvent.click(screen.getByText('删除'))
    await waitFor(() => expect(data.deleteReadingNote).toHaveBeenCalledWith('n1', 'tb_1'))
  })
})

describe('PdfReaderView — progress', () => {
  it('restores the synced page and persists progress', async () => {
    data.getTextbook.mockResolvedValue({
      id: 'tb_1',
      title: '热力学讲义',
      progress: { currentPage: 2, totalPages: 3, readingPercentage: 0.66, lastPosition: '' }
    })
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)

    await waitFor(() =>
      expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('2')
    )
    await waitFor(() => expect(data.updateTextbookProgress).toHaveBeenCalled())
    const [, patch] = data.updateTextbookProgress.mock.calls.at(-1) as [
      string,
      { currentPage: number; totalPages: number }
    ]
    expect(patch.currentPage).toBe(2)
    expect(patch.totalPages).toBe(3)
    expect(localStorage.getItem('pdf-progress-tb_1')).toBe('2')
  })

  it('falls back to localStorage when the store is unavailable', async () => {
    data.getTextbook.mockRejectedValue(new Error('db closed'))
    localStorage.setItem('pdf-progress-tb_1', '3')
    render(<PdfReaderView textbookId="tb_1" title="热力学讲义" onClose={vi.fn()} />)

    await waitFor(() =>
      expect((screen.getByTitle('输入页码后回车跳转') as HTMLInputElement).value).toBe('3')
    )
  })
})
