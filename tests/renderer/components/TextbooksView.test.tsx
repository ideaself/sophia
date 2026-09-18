// @vitest-environment jsdom
/**
 * TextbooksView — import (paste/file), list actions, content viewer, editor,
 * deletion and the EPUB missing-content repair flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/reader/PdfReaderView', () => ({
  PdfReaderView: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div data-testid="pdf-reader">
      {title}
      <button onClick={onClose}>关闭阅读器</button>
    </div>
  )
}))
vi.mock('../../../src/renderer/src/reader/EpubReaderView', () => ({
  EpubReaderView: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div data-testid="epub-reader">
      {title}
      <button onClick={onClose}>关闭阅读器</button>
    </div>
  )
}))
vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { TextbooksView } from '../../../src/renderer/src/components/TextbooksView'
import { useTextbookStore } from '../../../src/renderer/src/stores/useTextbookStore'
import type { Textbook } from '../../../src/renderer/src/types/models'

const data = {
  createTextbook: vi.fn(),
  getTextbook: vi.fn(),
  updateTextbook: vi.fn(),
  deleteTextbook: vi.fn(),
  reparseEpubContent: vi.fn()
}
const dialog = { openFile: vi.fn() }
const fetchTextbooks = vi.fn(async () => {})
const selectTextbook = vi.fn()

function textbook(overrides: Partial<Textbook> = {}): Textbook {
  return {
    id: 'tb_1',
    title: '热力学讲义',
    format: 'markdown',
    content: '正文'.repeat(200),
    ...overrides
  } as Textbook
}

beforeEach(() => {
  for (const fn of Object.values(data)) fn.mockClear()
  dialog.openFile.mockReset()
  fetchTextbooks.mockClear()
  selectTextbook.mockClear()

  data.createTextbook.mockResolvedValue({ id: 'tb_new' })
  data.getTextbook.mockResolvedValue({ id: 'tb_1', title: '热力学讲义', content: '# 第一章\n\n内容' })
  data.updateTextbook.mockResolvedValue({ id: 'tb_1' })
  data.deleteTextbook.mockResolvedValue(true)
  data.reparseEpubContent.mockResolvedValue({ success: true, content: '重新提取的正文'.repeat(30) })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data, dialog }
  })

  useTextbookStore.setState({
    textbooks: [textbook()],
    fetch: fetchTextbooks,
    select: selectTextbook
  })
})

afterEach(cleanup)

describe('TextbooksView — import', () => {
  it('imports pasted markdown and refreshes the list', async () => {
    render(<TextbooksView />)

    const titleInput = screen.getByPlaceholderText('教材标题（从文件导入时可留空）')
    const contentInput = screen.getByPlaceholderText('粘贴 Markdown 或文本内容...')
    const pasteButton = screen.getByText('粘贴导入') as HTMLButtonElement
    expect(pasteButton.disabled).toBe(true)

    fireEvent.change(titleInput, { target: { value: '  新教材  ' } })
    fireEvent.change(contentInput, { target: { value: '# 内容' } })
    expect(pasteButton.disabled).toBe(false)

    fireEvent.click(pasteButton)

    await waitFor(() =>
      expect(data.createTextbook).toHaveBeenCalledWith({
        title: '新教材',
        format: 'markdown',
        content: '# 内容'
      })
    )
    expect(fetchTextbooks).toHaveBeenCalled()
  })

  it('surfaces paste-import failures', async () => {
    data.createTextbook.mockRejectedValueOnce(new Error('磁盘已满'))
    render(<TextbooksView />)

    fireEvent.change(screen.getByPlaceholderText('教材标题（从文件导入时可留空）'), {
      target: { value: 'x' }
    })
    fireEvent.change(screen.getByPlaceholderText('粘贴 Markdown 或文本内容...'), {
      target: { value: 'y' }
    })
    fireEvent.click(screen.getByText('粘贴导入'))

    await screen.findByText('磁盘已满')
  })

  it('imports a file with an inferred format and title', async () => {
    dialog.openFile.mockResolvedValue({ canceled: false, filePaths: ['C:\\books\\线代.epub'] })
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('从文件导入 (PDF/EPUB)'))

    await waitFor(() =>
      expect(data.createTextbook).toHaveBeenCalledWith({
        title: '线代',
        format: 'epub',
        sourceFile: 'C:\\books\\线代.epub'
      })
    )
  })

  it('does nothing when the file dialog is cancelled', async () => {
    dialog.openFile.mockResolvedValue({ canceled: true, filePaths: [] })
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('从文件导入 (PDF/EPUB)'))

    await waitFor(() => expect(dialog.openFile).toHaveBeenCalled())
    expect(data.createTextbook).not.toHaveBeenCalled()
  })
})

describe('TextbooksView — list actions', () => {
  it('renders textbooks and selects one', () => {
    render(<TextbooksView />)

    expect(screen.getByText('热力学讲义')).toBeTruthy()
    expect(screen.getByText('markdown')).toBeTruthy()

    fireEvent.click(screen.getByText('选择'))
    expect(selectTextbook).toHaveBeenCalledWith(expect.objectContaining({ id: 'tb_1' }))
  })

  it('shows the empty state without textbooks', () => {
    useTextbookStore.setState({ textbooks: [] })
    render(<TextbooksView />)
    expect(screen.getByText('暂无教材。请在上方导入。')).toBeTruthy()
  })

  it('views content and closes the modal', async () => {
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('查看'))
    await waitFor(() => expect(data.getTextbook).toHaveBeenCalledWith('tb_1'))
    await screen.findByText(/第一章/)

    fireEvent.click(screen.getAllByText('✕')[0])
    await waitFor(() => expect(screen.queryByText('第一章')).toBeNull())
  })

  it('edits a textbook and saves title + content', async () => {
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('编辑'))
    await screen.findByText('编辑教材')

    const titleInput = screen.getByPlaceholderText('教材标题') as HTMLInputElement
    expect(titleInput.value).toBe('热力学讲义')
    fireEvent.change(titleInput, { target: { value: '热力学讲义（修订）' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(data.updateTextbook).toHaveBeenCalledWith('tb_1', {
        title: '热力学讲义（修订）',
        content: '# 第一章\n\n内容'
      })
    )
    expect(fetchTextbooks).toHaveBeenCalled()
  })

  it('deletes only after confirmation', async () => {
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('取消'))
    expect(data.deleteTextbook).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('确认删除'))

    await waitFor(() => expect(data.deleteTextbook).toHaveBeenCalledWith('tb_1'))
    expect(fetchTextbooks).toHaveBeenCalled()
  })

  it('opens the correct reader for the textbook format', () => {
    useTextbookStore.setState({
      textbooks: [textbook({ id: 'tb_pdf', format: 'pdf', originalFile: 'x.pdf' })]
    })
    const { unmount } = render(<TextbooksView />)
    fireEvent.click(screen.getByText('阅读原件'))
    expect(screen.getByTestId('pdf-reader').textContent).toContain('热力学讲义')
    unmount()

    useTextbookStore.setState({
      textbooks: [textbook({ id: 'tb_epub', format: 'epub', originalFile: 'x.epub' })]
    })
    render(<TextbooksView />)
    fireEvent.click(screen.getByText('阅读原件'))
    expect(screen.getByTestId('epub-reader').textContent).toContain('热力学讲义')
  })
})

describe('TextbooksView — EPUB repair', () => {
  const broken = () =>
    textbook({ id: 'tb_broken', format: 'epub', originalFile: 'b.epub', content: '书名 作者' })

  it('flags missing EPUB bodies and repairs one on demand', async () => {
    useTextbookStore.setState({ textbooks: [broken()] })
    render(<TextbooksView />)

    expect(screen.getByText(/1 本 EPUB 正文缺失/)).toBeTruthy()
    const repairButton = screen.getByText('⚠️ 正文缺失 · 重新提取')
    fireEvent.click(repairButton)

    await waitFor(() => expect(data.reparseEpubContent).toHaveBeenCalledWith('tb_broken'))
    await screen.findByText(/已重新提取正文（\d+ 字）/)
    expect(fetchTextbooks).toHaveBeenCalled()
  })

  it('repairs all missing EPUBs and reports failures', async () => {
    useTextbookStore.setState({
      textbooks: [
        broken(),
        textbook({ id: 'tb_broken2', format: 'epub', originalFile: 'c.epub', content: '只有标题' })
      ]
    })
    data.reparseEpubContent.mockRejectedValueOnce(new Error('原件丢失'))
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('全部重新提取'))

    // The first repair fails but must not abort the batch: the second one
    // succeeds and its message wins.
    await screen.findByText(/已重新提取正文/)
    expect(data.reparseEpubContent).toHaveBeenCalledTimes(2)
  })

  it('re-extracts on view when a stored EPUB body looks empty', async () => {
    useTextbookStore.setState({ textbooks: [broken()] })
    data.getTextbook.mockResolvedValueOnce({ id: 'tb_broken', title: 'x', content: '书名 作者' })
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('查看'))

    await waitFor(() => expect(data.reparseEpubContent).toHaveBeenCalledWith('tb_broken'))
    await screen.findByText(/重新提取的正文/)
  })
})

describe('TextbooksView — import format inference', () => {
  it.each([
    ['book.pdf', 'pdf'],
    ['notes.txt', 'text'],
    ['book.md', 'markdown']
  ])('infers the format for %s', async (fileName, expectedFormat) => {
    dialog.openFile.mockResolvedValue({ canceled: false, filePaths: [`C:\\books\\${fileName}`] })
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('从文件导入 (PDF/EPUB)'))

    await waitFor(() =>
      expect(data.createTextbook).toHaveBeenCalledWith(
        expect.objectContaining({ format: expectedFormat, sourceFile: `C:\\books\\${fileName}` })
      )
    )
  })

  it('surfaces a non-Error file-import failure with the fallback message', async () => {
    dialog.openFile.mockResolvedValue({ canceled: false, filePaths: ['C:\\books\\broken.pdf'] })
    data.createTextbook.mockRejectedValueOnce('plain string failure')
    render(<TextbooksView />)

    fireEvent.click(screen.getByText('从文件导入 (PDF/EPUB)'))

    expect(await screen.findByText('导入失败')).toBeTruthy()
  })
})

describe('TextbooksView — content and edit failures', () => {
  it('shows a load failure when the content cannot be fetched', async () => {
    data.getTextbook.mockRejectedValueOnce(new Error('db closed'))
    render(<TextbooksView />)

    fireEvent.click(screen.getAllByText('查看')[0])

    expect(await screen.findByText('加载失败')).toBeTruthy()
  })

  it('falls back to an empty editor when the content load fails', async () => {
    data.getTextbook.mockRejectedValueOnce(new Error('db closed'))
    render(<TextbooksView />)

    fireEvent.click(screen.getAllByText('编辑')[0])

    await waitFor(() => {
      const areas = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
      expect(areas.some((el) => el.value === '')).toBe(true)
    })
  })

  it('reports a save failure and keeps the editor open', async () => {
    data.updateTextbook.mockRejectedValueOnce('plain string failure')
    render(<TextbooksView />)

    fireEvent.click(screen.getAllByText('编辑')[0])
    await screen.findByDisplayValue('热力学讲义')
    fireEvent.click(screen.getByText('保存'))

    expect(await screen.findByText('保存失败')).toBeTruthy()
  })
})

describe('TextbooksView — modal closers', () => {
  it('closes the content and edit modals through their buttons', async () => {
    render(<TextbooksView />)

    fireEvent.click(screen.getAllByText('查看')[0])
    const contentModal = await screen.findByText('# 第一章', { exact: false })
    expect(contentModal).toBeTruthy()
    fireEvent.click(screen.getAllByText('✕')[0])
    await waitFor(() => expect(screen.queryByText('# 第一章', { exact: false })).toBeNull())

    fireEvent.click(screen.getAllByText('编辑')[0])
    await screen.findByDisplayValue('热力学讲义')
    fireEvent.click(screen.getAllByText('取消')[0])
    await waitFor(() => expect(screen.queryByDisplayValue('热力学讲义')).toBeNull())
  })
})

describe('TextbooksView — readers', () => {
  it('closes the PDF and EPUB readers from inside them', async () => {
    useTextbookStore.setState({
      textbooks: [textbook({ format: 'pdf', originalFile: 'book.pdf' })],
      fetch: fetchTextbooks,
      select: selectTextbook
    })
    const view = render(<TextbooksView />)
    fireEvent.click(screen.getByText('阅读原件'))
    expect(await screen.findByTestId('pdf-reader')).toBeTruthy()
    // Closing from inside the reader clears the reading state.
    fireEvent.click(screen.getByText('关闭阅读器'))
    await waitFor(() => expect(screen.queryByTestId('pdf-reader')).toBeNull())
    view.unmount()

    useTextbookStore.setState({
      textbooks: [textbook({ format: 'epub', originalFile: 'book.epub' })],
      fetch: fetchTextbooks,
      select: selectTextbook
    })
    const second = render(<TextbooksView />)
    fireEvent.click(screen.getByText('阅读原件'))
    expect(await screen.findByTestId('epub-reader')).toBeTruthy()
    fireEvent.click(screen.getByText('关闭阅读器'))
    await waitFor(() => expect(screen.queryByTestId('epub-reader')).toBeNull())
    second.unmount()
  })
})

describe('TextbooksView — edit modal details', () => {
  it('closes the edit modal with its ✕ and edits the content textarea', async () => {
    render(<TextbooksView />)

    fireEvent.click(screen.getAllByText('编辑')[0])
    const textarea = (await screen.findByPlaceholderText(
      '教材内容 (Markdown)...'
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '## 新正文' } })
    expect(textarea.value).toBe('## 新正文')

    // The header ✕ closes without saving.
    const closers = screen.getAllByText('✕')
    fireEvent.click(closers[closers.length - 1])
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('教材内容 (Markdown)...')).toBeNull()
    )
    expect(data.updateTextbook).not.toHaveBeenCalled()
  })
})
