// @vitest-environment jsdom
/**
 * EpubReaderView — chapter loading, TOC/pager navigation, search with
 * per-chapter counts, selection toolbar (highlight/underline/note), reading
 * notes panel and progress persistence (localStorage + store).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/components/DictionaryPopup', () => ({
  DictionaryPopup: () => <div data-testid="dict-popup" />
}))

import { EpubReaderView } from '../../../src/renderer/src/reader/EpubReaderView'

const data = {
  readEpubChapters: vi.fn(),
  getTextbook: vi.fn(),
  updateTextbookProgress: vi.fn(),
  listReadingNotes: vi.fn(),
  createReadingNote: vi.fn(),
  updateReadingNote: vi.fn(),
  deleteReadingNote: vi.fn()
}

const CHAPTERS = [
  { id: 'c1', title: '第一章 温度', html: '<p>温度是分子平均动能的度量。</p>' },
  { id: 'c2', title: '第二章 熵', html: '<p>熵是状态函数。熵永不减少。</p>' },
  { id: 'c3', title: '第三章 热机', html: '<p>卡诺循环是理想热机。</p>' }
]

const NOTE = {
  id: 'n1',
  textbookId: 'tb_1',
  content: '熵不减',
  position: '1',
  chapter: '第二章 熵',
  type: 'highlight',
  color: '',
  readerNote: '重点',
  createdAt: '2026-09-16T10:00:00Z',
  updatedAt: '2026-09-16T10:00:00Z'
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(data)) fn.mockClear()
  data.readEpubChapters.mockResolvedValue({ chapters: CHAPTERS, title: '热力学讲义', author: '朗道' })
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

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data }
  })

  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getBoundingClientRect = (() => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })) as never
})

afterEach(cleanup)

function renderReader(overrides: { onClose?: () => void } = {}): { onClose: () => void } {
  const onClose = overrides.onClose ?? vi.fn()
  render(<EpubReaderView textbookId="tb_1" title="热力学讲义" onClose={onClose} />)
  return { onClose }
}

function contentEl(): HTMLElement {
  const el = document.querySelector('.epub-content')
  if (!el) throw new Error('content not rendered')
  return el as HTMLElement
}

/** Select the whole text of a node inside the content and trigger mouseUp. */
function selectText(searchText: string): void {
  const container = contentEl()
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Text | null = null
  while (walker.nextNode()) {
    const candidate = walker.currentNode as Text
    if (candidate.nodeValue?.includes(searchText)) {
      node = candidate
      break
    }
  }
  if (!node) throw new Error(`text not found in content: ${searchText}`)
  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, node.nodeValue?.length ?? 0)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(container)
}

describe('EpubReaderView — chapters and navigation', () => {
  it('loads chapters and shows the first one', async () => {
    renderReader()

    expect(await screen.findByText('温度是分子平均动能的度量。')).toBeTruthy()
    expect(screen.getByText('第一章 温度 - 1/3')).toBeTruthy()
    expect(data.readEpubChapters).toHaveBeenCalledWith('tb_1')
  })

  it('reports empty books and load failures', async () => {
    data.readEpubChapters.mockResolvedValueOnce({ chapters: [], title: '', author: '' })
    renderReader()
    expect(await screen.findByText(/没有可读的章节/)).toBeTruthy()

    cleanup()
    data.readEpubChapters.mockRejectedValueOnce(new Error('原件损坏'))
    renderReader()
    expect(await screen.findByText('原件损坏')).toBeTruthy()
  })

  it('navigates via the TOC and closes it', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    fireEvent.click(screen.getByText('目录'))
    fireEvent.click(await screen.findByText(/3\. 第三章 热机/))

    expect(await screen.findByText('卡诺循环是理想热机。')).toBeTruthy()
    expect(screen.getByText('第三章 热机 - 3/3')).toBeTruthy()
    expect(screen.queryByText(/3\. 第三章 热机/)).toBeNull()
  })

  it('pages with the footer buttons and arrow keys', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    fireEvent.click(screen.getByTitle('下一章 (→)'))
    expect(await screen.findByText('熵是状态函数。熵永不减少。')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(await screen.findByText('卡诺循环是理想热机。')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(await screen.findByText('熵是状态函数。熵永不减少。')).toBeTruthy()

    fireEvent.click(screen.getByTitle('上一章 (←)'))
    expect(await screen.findByText('温度是分子平均动能的度量。')).toBeTruthy()

    // Already at the first chapter — stays put.
    fireEvent.click(screen.getByTitle('上一章 (←)'))
    expect(screen.getByText('第一章 温度 - 1/3')).toBeTruthy()
  })

  it('scales the font with A+/A- and closes via the toolbar button', async () => {
    const { onClose } = renderReader()
    await screen.findByText('温度是分子平均动能的度量。')
    expect(contentEl().style.fontSize).toBe('16px')

    fireEvent.click(screen.getAllByText(/^A/)[1])
    expect(contentEl().style.fontSize).toBe('18px')
    fireEvent.click(screen.getAllByText(/^A/)[0])
    expect(contentEl().style.fontSize).toBe('16px')

    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('EpubReaderView — search', () => {
  it('counts matches per chapter and across the book', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    const input = await screen.findByPlaceholderText('输入关键词，回车跳转...')
    fireEvent.change(input, { target: { value: '熵' } })

    // Debounced per-chapter scan.
    expect(await screen.findByText(/本页 1\/2 · 全书共 2 处/)).toBeTruthy()
    expect(await screen.findByText(/第二章 熵 · 2 处/)).toBeTruthy()

    // Escape closes the popover.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByPlaceholderText('输入关键词，回车跳转...')).toBeNull())
  })

  it('jumps to the first chapter that has a match', async () => {
    data.getTextbook.mockResolvedValue(null)
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    fireEvent.click(screen.getByText('🔍 搜索'))
    const input = await screen.findByPlaceholderText('输入关键词，回车跳转...')
    fireEvent.change(input, { target: { value: '热机' } })

    // Chapters 1 and 2 have no hits → jumps to chapter 3.
    await waitFor(() => expect(screen.getByText('第三章 热机 - 3/3')).toBeTruthy())
  })
})

describe('EpubReaderView — notes', () => {
  it('lists notes, edits the reader note and deletes', async () => {
    data.listReadingNotes.mockResolvedValue([NOTE])
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    fireEvent.click(screen.getByText(/📌 笔记 \(1\)/))
    expect(await screen.findByText(/🖍️ 高亮 · 第二章 熵/)).toBeTruthy()
    expect(screen.getByText('熵不减')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('编辑笔记'))
    const textarea = await screen.findByDisplayValue('重点')
    fireEvent.change(textarea, { target: { value: '期末重点' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(data.updateReadingNote).toHaveBeenCalledWith('n1', 'tb_1', { readerNote: '期末重点' })
    )

    fireEvent.click(screen.getByLabelText('删除笔记'))
    await waitFor(() => expect(data.deleteReadingNote).toHaveBeenCalledWith('n1', 'tb_1'))
  })

  it('creates a highlight from the selection toolbar', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    selectText('分子平均动能')
    fireEvent.click(await screen.findByLabelText('高亮选中文字'))

    await waitFor(() =>
      expect(data.createReadingNote).toHaveBeenCalledWith({
        textbookId: 'tb_1',
        content: '温度是分子平均动能的度量。',
        position: '0',
        chapter: '第一章 温度',
        type: 'highlight',
        readerNote: ''
      })
    )
    // Refreshed after creation.
    expect(data.listReadingNotes).toHaveBeenCalledTimes(2)
  })

  it('creates a note with the draft text', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    selectText('分子平均动能')
    fireEvent.click(await screen.findByLabelText('添加笔记'))
    const draft = screen.getByPlaceholderText('写下你的想法...')
    fireEvent.change(draft, { target: { value: '这里要背' } })
    fireEvent.click(screen.getByText('保存笔记'))

    await waitFor(() =>
      expect(data.createReadingNote).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'note', readerNote: '这里要背' })
      )
    )
  })

  it('keeps the selection when creation fails', async () => {
    // A failed write surfaces as a rejection from the notes API.
    data.createReadingNote.mockRejectedValueOnce(new Error('write failed'))
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    selectText('分子平均动能')
    fireEvent.click(await screen.findByLabelText('下划线'))

    await waitFor(() => expect(data.createReadingNote).toHaveBeenCalledTimes(1))
    // Menu stays open for a retry.
    expect(screen.getByLabelText('下划线')).toBeTruthy()
  })
})

describe('EpubReaderView — progress', () => {
  it('persists progress to localStorage and the textbook store', async () => {
    renderReader()
    await screen.findByText('温度是分子平均动能的度量。')

    await waitFor(() => expect(data.updateTextbookProgress).toHaveBeenCalled())
    const [textbookId, patch] = data.updateTextbookProgress.mock.calls.at(-1) as [
      string,
      { currentPage: number; totalPages: number; readingPercentage: number; lastPosition: string }
    ]
    expect(textbookId).toBe('tb_1')
    expect(patch.currentPage).toBe(1)
    expect(patch.totalPages).toBe(3)
    expect(patch.readingPercentage).toBeCloseTo(1 / 3)

    const stored = JSON.parse(localStorage.getItem('epub-progress-tb_1') ?? '{}')
    expect(stored).toMatchObject({ chapterIndex: 0, fontSize: 16 })

    // Navigating to the next chapter persists the new position too.
    fireEvent.click(screen.getByTitle('下一章 (→)'))
    await waitFor(() => {
      const last = data.updateTextbookProgress.mock.calls.at(-1)![1] as { currentPage: number }
      expect(last.currentPage).toBe(2)
    })
  })

  it('restores the synced chapter and font size', async () => {
    data.getTextbook.mockResolvedValue({
      id: 'tb_1',
      title: '热力学讲义',
      progress: {
        currentPage: 2,
        totalPages: 3,
        readingPercentage: 0.66,
        lastPosition: JSON.stringify({ chapterIndex: 2, fontSize: 20, scrollY: 0 })
      }
    })
    renderReader()

    expect(await screen.findByText('卡诺循环是理想热机。')).toBeTruthy()
    expect(screen.getByText('第三章 热机 - 3/3')).toBeTruthy()
    expect(contentEl().style.fontSize).toBe('20px')
  })

  it('falls back to localStorage when the store has no position', async () => {
    localStorage.setItem(
      'epub-progress-tb_1',
      JSON.stringify({ chapterIndex: 1, fontSize: 12, scrollY: 0 })
    )
    data.getTextbook.mockResolvedValue({
      id: 'tb_1',
      title: '热力学讲义',
      progress: { currentPage: 1, totalPages: 3, readingPercentage: 0.33, lastPosition: '' }
    })
    renderReader()

    expect(await screen.findByText('熵是状态函数。熵永不减少。')).toBeTruthy()
    expect(contentEl().style.fontSize).toBe('12px')
  })
})
