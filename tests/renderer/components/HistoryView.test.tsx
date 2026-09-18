// @vitest-environment jsdom
/**
 * HistoryView — classroom browser smoke tests.
 *
 * Covers the structure that the upcoming virtualization work will touch:
 * grouped tree with per-lesson counts, default selection, and the detail
 * panel (messages + artifacts) for the selected lesson.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

vi.mock('../../../src/renderer/src/lib/markdownToHtml', () => ({
  markdownToHtml: async (md: string) => `<p>${md}</p>`
}))

import { HistoryView } from '../../../src/renderer/src/components/HistoryView'
import { useTextbookStore } from '../../../src/renderer/src/stores/useTextbookStore'
import { useAppStore } from '../../../src/renderer/src/stores/useAppStore'

// jsdom lacks layout: the message list is virtualized, so provide the same
// ResizeObserver / offset stubs used by the ClassroomView tests.
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.cb(
      [{ target, contentRect: { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', FakeResizeObserver)
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get: () => 0 })

const CONVERSATIONS = [
  {
    id: 'c1',
    title: '第一课',
    companionId: 'comp_a',
    textbookId: 'tb_1',
    createdAt: '2026-07-06T09:00:00',
    updatedAt: '2026-07-06T10:00:00',
    endedAt: '2026-07-06T10:00:00'
  },
  {
    id: 'c2',
    title: '自由对话',
    companionId: 'comp_b',
    textbookId: null,
    createdAt: '2026-07-05T09:00:00',
    updatedAt: '2026-07-05T10:00:00',
    endedAt: null
  }
]

const MESSAGES = {
  c1: [
    { id: 'm1', conversationId: 'c1', role: 'user', content: '第一问：什么是熵？', createdAt: '2026-07-06T09:01:00' },
    { id: 'm2', conversationId: 'c1', role: 'assistant', content: '熵是无序度的度量。', createdAt: '2026-07-06T09:01:05' },
    { id: 'm3', conversationId: 'c1', role: 'user', content: '第二问：那焓呢？', createdAt: '2026-07-06T09:02:00' }
  ],
  c2: [
    { id: 'n1', conversationId: 'c2', role: 'user', content: '另一个课堂的问题', createdAt: '2026-07-05T09:01:00' }
  ]
}

const ARTIFACTS = {
  c1: [
    { id: 'a1', conversationId: 'c1', type: 'lesson_summary', content: '## 总结\n本节讲了熵。', createdAt: '2026-07-06T10:00:00' }
  ],
  c2: []
}

const api = {
  listConversations: vi.fn(),
  listTextbooks: vi.fn(),
  statsOverview: vi.fn(),
  listMessages: vi.fn(),
  listArtifacts: vi.fn(),
  searchMessages: vi.fn(),
  getConversation: vi.fn(),
  getTextbook: vi.fn(),
  deleteConversation: vi.fn(),
  updateArtifact: vi.fn(),
  redoArtifacts: vi.fn(),
  writeTextFile: vi.fn(),
  exportPdf: vi.fn(),
  saveFile: vi.fn(),
  diary: {
    listMonths: vi.fn(),
    getMonth: vi.fn()
  }
}

interface CompanionOption {
  id: string
  name: string
  identity: string
  personalityKeywords: string[]
}

let companionsGet: Mock<(id: string) => Promise<CompanionOption | null>>

beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === 'function') fn.mockClear()
  api.listConversations.mockResolvedValue(CONVERSATIONS)
  api.listTextbooks.mockResolvedValue([
    { id: 'tb_1', title: '热力学入门', format: 'pdf', originalFile: 'thermo.pdf' }
  ])
  api.statsOverview.mockResolvedValue({
    messageCounts: { c1: 3, c2: 1 },
    artifactCounts: {},
    totalMessages: 4,
    totalArtifacts: 1,
    dailyMinutes: {},
    week: { startKey: '2026-06-30', ms: 0, messages: 0, artifacts: 0, companion: {}, textbook: {} }
  })
  api.listMessages.mockImplementation(async (convId: string) => MESSAGES[convId as 'c1' | 'c2'] ?? [])
  api.listArtifacts.mockImplementation(async (convId: string) => ARTIFACTS[convId as 'c1' | 'c2'] ?? [])
  api.searchMessages.mockResolvedValue({ results: [], total: 0 })
  api.getConversation.mockResolvedValue(CONVERSATIONS[0])
  api.getTextbook.mockResolvedValue({ id: 'tb_1', title: '热力学入门', format: 'pdf', originalFile: 'thermo.pdf' })
  api.deleteConversation.mockResolvedValue(true)
  api.updateArtifact.mockResolvedValue(null)
  api.redoArtifacts.mockResolvedValue({ success: true, artifacts: 0, failures: [] })
  api.writeTextFile.mockResolvedValue(undefined)
  api.exportPdf.mockResolvedValue(undefined)
  api.saveFile.mockResolvedValue({ canceled: false, filePath: 'C:\\导出' })
  api.diary.listMonths.mockResolvedValue([])
  api.diary.getMonth.mockResolvedValue('')

  useTextbookStore.setState({ textbooks: [], selectedTextbook: null })
  useAppStore.setState({ view: 'history', loadConversationId: null })

  companionsGet = vi.fn(async (id: string): Promise<CompanionOption | null> => ({
    id,
    name: id === 'comp_a' ? '朗道' : '祖冲之',
    identity: '导师',
    personalityKeywords: []
  }))

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: api,
      companions: { get: companionsGet },
      dialog: { confirm: vi.fn().mockResolvedValue(true), saveFile: api.saveFile }
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('HistoryView', () => {
  it('shows the textbook grouping with per-lesson message counts', async () => {
    render(<HistoryView />)

    // The book title appears in the group header (and possibly the detail header).
    expect((await screen.findAllByText(/热力学入门/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/未绑定教材/)).toBeTruthy()

    // Lesson display names (MM-DD name) + counts from the aggregated overview.
    // Each may appear twice (tree row + detail header).
    expect((await screen.findAllByText(/朗道/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/祖冲之/).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/3 条/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 条/).length).toBeGreaterThan(0)
  })

  it('auto-selects the newest lesson and renders its messages and artifacts', async () => {
    render(<HistoryView />)

    expect(await screen.findByText('第一问：什么是熵？')).toBeTruthy()
    expect(await screen.findByText('熵是无序度的度量。')).toBeTruthy()
    // Artifact label for the lesson summary.
    expect(await screen.findByText('📋 课堂总结')).toBeTruthy()
  })

  it('switches the detail panel when another lesson is clicked', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    // Click the second lesson ("07-05 祖冲之" row).
    fireEvent.click(screen.getByText(/祖冲之/).closest('button')!)

    expect(await screen.findByText('另一个课堂的问题')).toBeTruthy()
    expect(screen.queryByText('第一问：什么是熵？')).toBeNull()
  })
})

// --------------- search, artifacts, diary ---------------

describe('HistoryView — search', () => {
  it('searches messages, jumps to a result and clears the query', async () => {
    api.searchMessages.mockResolvedValue({
      results: [
        {
          conversationId: 'c2',
          message: { id: 'n1', role: 'user', content: '另一个课堂的问题', createdAt: '2026-07-05T09:01:00' }
        }
      ],
      total: 1
    })
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '另一个' } })

    await screen.findByText('结果 1/1', undefined, { timeout: 2000 })
    fireEvent.click(screen.getByTitle('另一个课堂的问题'))

    // The jump selects the conversation and shows its message in the detail.
    await screen.findByText('另一个课堂的问题')
  })

  it('shows the empty state for fruitless searches and can clear them', async () => {
    api.searchMessages.mockResolvedValue({ results: [], total: 0 })
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: 'zzz' } })

    await screen.findByText('结果 0/0', undefined, { timeout: 2000 })
    expect(screen.getByText('无匹配结果')).toBeTruthy()

    fireEvent.click(screen.getByText('清除'))
    await waitFor(() => expect(screen.queryByText('结果 0/0')).toBeNull())
    expect(screen.getAllByText(/朗道/).length).toBeGreaterThan(0)
  })

  it('loads more results when the total exceeds the page', async () => {
    api.searchMessages
      .mockResolvedValueOnce({
        results: [
          { conversationId: 'c1', message: { id: 'm1', role: 'user', content: 'A 结果', createdAt: '2026-07-06T09:00:00' } }
        ],
        total: 3
      })
      .mockResolvedValueOnce({
        results: [
          { conversationId: 'c1', message: { id: 'm2', role: 'assistant', content: 'B 结果', createdAt: '2026-07-06T09:01:00' } }
        ],
        total: 3
      })
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '结果' } })
    await screen.findByText('结果 1/3', undefined, { timeout: 2000 })

    fireEvent.click(screen.getByText('加载更多'))
    await screen.findByText('结果 2/3', undefined, { timeout: 2000 })
    expect(api.searchMessages).toHaveBeenLastCalledWith('结果', 50, 1)
  })
})

describe('HistoryView — delete and artifacts', () => {
  it('deletes the selected conversation after confirmation', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('🗑 删除'))

    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith('c1'))
    await screen.findByText(/课程已删除/)
    // The deleted conversation disappears and the selection moves on.
    await waitFor(() => expect(screen.queryByText('第一问：什么是熵？')).toBeNull())
    expect(screen.getAllByText(/祖冲之/).length).toBeGreaterThan(0)
  })

  it('edits an artifact and persists the new content', async () => {
    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getByTitle('编辑产物内容'))
    await screen.findByText('保存')
    const editor = document.querySelector('textarea') as HTMLTextAreaElement
    expect(editor.value).toContain('本节讲了熵')

    fireEvent.change(editor, { target: { value: '## 总结\n本节讲了热力学第二定律。' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(api.updateArtifact).toHaveBeenCalledWith('a1', 'c1', '## 总结\n本节讲了热力学第二定律。')
    )
    await screen.findByText(/本节讲了热力学第二定律/)
  })

  it('re-runs only the missing artifact types', async () => {
    api.redoArtifacts.mockResolvedValue({ success: true, artifacts: 3, failures: [] })
    render(<HistoryView />)
    await screen.findByText('有学习摘要缺失，可只补齐缺失项')

    fireEvent.click(screen.getByText('补齐缺失产物'))

    await waitFor(() => expect(api.redoArtifacts).toHaveBeenCalledTimes(1))
    const [convId, types] = api.redoArtifacts.mock.calls[0] as [string, string[]]
    expect(convId).toBe('c1')
    expect(types.length).toBeGreaterThan(0)
    expect(types).not.toContain('lesson_summary')
    expect(api.listArtifacts).toHaveBeenCalledTimes(2)
  })
})

describe('HistoryView — diary', () => {
  it('lists diary months and expands a month on click', async () => {
    api.diary.listMonths.mockResolvedValue(['2026-07', '2026-08'])
    api.diary.getMonth.mockResolvedValue('# 七月日记\n今天学了熵。')
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('📝 学习日记'))
    fireEvent.click(await screen.findByText('2026-07'))

    await screen.findByText(/七月日记/)
    expect(api.diary.getMonth).toHaveBeenCalledWith('2026-07')

    // Clicking the same month collapses it again.
    fireEvent.click(screen.getByText('2026-07'))
    await waitFor(() => expect(screen.queryByText(/七月日记/)).toBeNull())
  })

  it('shows the empty diary hint when no months exist', async () => {
    api.diary.listMonths.mockResolvedValue([])
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('📝 学习日记'))
    expect(await screen.findByText(/还没有日记/)).toBeTruthy()
  })
})

// --------------- exports ---------------

describe('HistoryView — exports', () => {
  it('exports the conversation as Markdown', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 Markdown'))

    await waitFor(() => expect(api.writeTextFile).toHaveBeenCalledTimes(1))
    const [path, content] = api.writeTextFile.mock.calls[0] as [string, string]
    expect(path).toBe('C:\\导出')
    expect(content).toContain('# 第一课')
    expect(content).toContain('**AI 角色**: 朗道')
    expect(content).toContain('第一问：什么是熵？')
    expect(content).toContain('熵是无序度的度量。')
  })

  it('skips the Markdown write when the dialog is cancelled', async () => {
    api.saveFile.mockResolvedValueOnce({ canceled: true })
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 Markdown'))

    await waitFor(() => expect(api.saveFile).toHaveBeenCalled())
    expect(api.writeTextFile).not.toHaveBeenCalled()
  })

  it('exports the conversation as PDF through the markdown pipeline', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 PDF（含公式渲染）'))

    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledTimes(1))
    const [html, path] = api.exportPdf.mock.calls[0] as [string, string]
    expect(path).toBe('C:\\导出')
    expect(html).toContain('<h1>第一课</h1>')
    expect(html).toContain('<p>第一问：什么是熵？</p>')
  })

  it('exports a single artifact as PDF with the notes suffix', async () => {
    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getByTitle('导出为 PDF'))

    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledTimes(1))
    const [html] = api.exportPdf.mock.calls[0] as [string, string]
    expect(html).toContain('第一课 · 课后笔记')
    expect(html).toContain('<p>## 总结')
  })
})

// --------------- remaining branches ---------------

describe('HistoryView — action branches', () => {
  it('collapses and expands textbook groups', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    // Collapse the group: the caret flips and stays collapsed.
    fireEvent.click(screen.getByText('📖 热力学入门'))
    await waitFor(() => expect(screen.getAllByText('▸').length).toBeGreaterThan(0))

    // Expand again.
    fireEvent.click(screen.getByText('📖 热力学入门'))
    await waitFor(() => expect(screen.queryByText('▸')).toBeNull())
  })

  it('opens the new-classroom flow from the tree header', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('+ 新建课堂'))
    expect(useAppStore.getState().newClassroomOpen).toBe(true)
  })

  it('continues an ended lesson and resumes an active one', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    // 07-06 朗道 is ended → 继续学习 (same companion + textbook flow).
    fireEvent.click(screen.getByText('继续学习'))
    await waitFor(() => expect(useAppStore.getState().newClassroomOpen).toBe(true))
    expect(useAppStore.getState().view).toBe('classroom')

    // 07-05 祖冲之 is still open → 继续上课 loads it back into the classroom.
    fireEvent.click(screen.getByText(/祖冲之/).closest('button')!)
    await screen.findByText('另一个课堂的问题')
    fireEvent.click(screen.getByText('继续上课'))
    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c2'))
    expect(useAppStore.getState().view).toBe('classroom')
  })

  it('opens the review page for the selected lesson', async () => {
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('课程复盘：总结 / 自测 / 闪卡 / 日记一页回顾'))

    await waitFor(() => expect(useAppStore.getState().view).toBe('review'))
    expect(useAppStore.getState().reviewScope).toMatchObject({ conversationId: 'c1' })
  })

  it('falls back to empty messages/artifacts when the detail loads fail', async () => {
    // First lesson loads fine; switching to the second fails.
    api.listMessages
      .mockImplementationOnce(api.listMessages.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('db closed'))
    api.listArtifacts
      .mockImplementationOnce(api.listArtifacts.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('db closed'))
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText(/祖冲之/).closest('button')!)

    await waitFor(() => expect(screen.queryByText('第一问：什么是熵？')).toBeNull())
    expect(screen.queryByText('📋 课堂总结')).toBeNull()
  })

  it('clears a failed search without leaving stale results', async () => {
    api.searchMessages.mockRejectedValueOnce(new Error('search down'))
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '熵是' } })

    await screen.findByText('结果 0/0', undefined, { timeout: 2000 })
    expect(screen.getByText('无匹配结果')).toBeTruthy()
  })

  it('collapses an open diary month', async () => {
    api.diary.listMonths.mockResolvedValue(['2026-07'])
    api.diary.getMonth.mockResolvedValue('七月日记内容')
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('📝 学习日记'))
    fireEvent.click(await screen.findByText('2026-07'))
    await screen.findByText(/七月日记内容/)

    fireEvent.click(screen.getByText('2026-07'))
    await waitFor(() => expect(screen.queryByText(/七月日记内容/)).toBeNull())
  })

  it('opens the self-test modal from the lesson summary artifact', async () => {
    api.listArtifacts.mockResolvedValue([
      {
        id: 'a1',
        conversationId: 'c1',
        type: 'lesson_summary',
        content: '**自测 1：什么是熵？**\n- 提示 1：与无序度有关\n- 答案：状态度量',
        createdAt: '2026-07-06T10:00:00Z'
      }
    ])
    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getByText('🎯 自测'))
    // The modal is identified by its close control.
    await screen.findByTitle('关闭 (Esc)')

    fireEvent.click(screen.getByTitle('关闭 (Esc)'))
    await waitFor(() => expect(screen.queryByTitle('关闭 (Esc)')).toBeNull())
  })

  it('cancels artifact editing without persisting', async () => {
    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getByTitle('编辑产物内容'))
    await screen.findByText('保存')
    fireEvent.click(screen.getByText('取消'))

    await waitFor(() => expect(screen.queryByText('保存')).toBeNull())
    expect(api.updateArtifact).not.toHaveBeenCalled()
  })
})

describe('HistoryView — failure tolerances', () => {
  it('renders the tree even when the counts aggregation fails', async () => {
    api.statsOverview.mockRejectedValueOnce(new Error('stats down'))
    render(<HistoryView />)

    expect(await screen.findByText('📖 热力学入门')).toBeTruthy()
    expect(screen.getAllByText(/朗道/).length).toBeGreaterThan(0)
  })

  it('clears the textbook selection when continuing a lesson without one', async () => {
    api.listConversations.mockResolvedValue([
      { ...CONVERSATIONS[1], endedAt: '2026-07-05T10:00:00' }
    ])
    useTextbookStore.setState({ selectedTextbook: { id: 'tb_stale' } as never })
    render(<HistoryView />)
    await screen.findAllByText(/祖冲之/)

    fireEvent.click(screen.getAllByText(/祖冲之/)[0].closest('button')!)
    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useTextbookStore.getState().selectedTextbook).toBeNull())
  })

  it('tolerates a failing diary month load without crashing', async () => {
    api.diary.listMonths.mockResolvedValue(['2026-07'])
    api.diary.getMonth.mockRejectedValueOnce(new Error('io error'))
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('📝 学习日记'))
    fireEvent.click(await screen.findByText('2026-07'))

    // The month button stays; no content block appears and nothing throws.
    await waitFor(() => expect(api.diary.getMonth).toHaveBeenCalledWith('2026-07'))
    expect(screen.getByText('2026-07')).toBeTruthy()
  })
})

describe('HistoryView — remaining branches', () => {
  it('sorts several lessons in the same textbook group by recency', async () => {
    api.listConversations.mockResolvedValue([
      ...CONVERSATIONS,
      {
        id: 'c3',
        title: '更早的一课',
        companionId: 'comp_a',
        textbookId: 'tb_1',
        createdAt: '2026-07-04T09:00:00',
        updatedAt: '2026-07-04T10:00:00',
        endedAt: '2026-07-04T10:00:00'
      }
    ])
    api.getConversation.mockResolvedValue(CONVERSATIONS[0])

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    // Both lessons appear; the newest is first in the group.
    const titles = screen.getAllByText(/第一课|更早的一课/).map((el) => el.textContent)
    expect(titles[0]).toContain('第一课')
  })

  it('ignores a resume request for a conversation that vanished', async () => {
    api.getConversation.mockResolvedValue(null)
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText(/祖冲之/).closest('button')!)
    await screen.findByText('另一个课堂的问题')
    fireEvent.click(screen.getByText('继续上课'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useAppStore.getState().loadConversationId).toBeNull()
  })

  it('clears the selected textbook when resuming a class without one', async () => {
    useTextbookStore.setState({ selectedTextbook: { id: 'tb_1', title: '旧教材' } as never })
    api.getConversation.mockResolvedValue(CONVERSATIONS[1])
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText(/祖冲之/).closest('button')!)
    await screen.findByText('另一个课堂的问题')
    fireEvent.click(screen.getByText('继续上课'))

    await waitFor(() => expect(useTextbookStore.getState().selectedTextbook).toBeNull())
  })

  it('keeps the lesson when the delete confirmation is declined', async () => {
    ;(window.sophia.dialog.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('🗑 删除'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.deleteConversation).not.toHaveBeenCalled()
    expect(screen.getByText('第一问：什么是熵？')).toBeTruthy()
  })

  it('skips exports for lessons without messages', async () => {
    api.listMessages.mockResolvedValueOnce(MESSAGES.c1).mockResolvedValue([])
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 Markdown'))
    fireEvent.click(screen.getByTitle('导出为 PDF（含公式渲染）'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.writeTextFile).not.toHaveBeenCalled()
    expect(api.exportPdf).not.toHaveBeenCalled()
  })

  it('skips the PDF write when the save dialog is cancelled', async () => {
    api.saveFile.mockResolvedValue({ canceled: true, filePath: '' })
    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 PDF（含公式渲染）'))
    await waitFor(() => expect(api.saveFile).toHaveBeenCalled())
    expect(api.exportPdf).not.toHaveBeenCalled()
  })

  it('hides the delete notice after a few seconds', async () => {
    vi.useFakeTimers()
    try {
      render(<HistoryView />)
      await vi.waitFor(() => expect(screen.getByText('第一问：什么是熵？')).toBeTruthy())

      fireEvent.click(screen.getByText('🗑 删除'))
      await vi.waitFor(() => expect(screen.getByText(/课程已删除/)).toBeTruthy())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(screen.queryByText(/课程已删除/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HistoryView — artifact save guard', () => {
  it('ignores saving an artifact with blank content', async () => {
    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getByTitle('编辑产物内容'))
    const editor = document.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('保存'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(api.updateArtifact).not.toHaveBeenCalled()
  })
})

describe('HistoryView — empty and partial data', () => {
  it('shows the empty classroom state without conversations', async () => {
    api.listConversations.mockResolvedValue([])

    render(<HistoryView />)

    expect(await screen.findByText(/还没有课堂/)).toBeTruthy()
    expect(api.listMessages).not.toHaveBeenCalled()
  })

  it('falls back to 未知 when the companion lookup returns null', async () => {
    companionsGet.mockResolvedValue(null)

    render(<HistoryView />)

    await screen.findByText('第一问：什么是熵？')
    expect((await screen.findAllByText(/07-06 未知/)).length).toBeGreaterThan(0)
  })

  it('renders placeholder counts when the stats overview is empty', async () => {
    api.statsOverview.mockResolvedValue(undefined)

    render(<HistoryView />)

    await screen.findByText('第一问：什么是熵？')
    expect((await screen.findAllByText(/… 条/)).length).toBeGreaterThan(0)
  })

  it('ignores a stats overview that resolves after unmount', async () => {
    let resolveOverview: (v: unknown) => void = () => {}
    api.statsOverview.mockImplementation(() => new Promise((resolve) => { resolveOverview = resolve }))

    const { unmount } = render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    unmount()

    await act(async () => { resolveOverview(undefined) })
  })

  it('ignores a stats overview that fails after unmount', async () => {
    let rejectOverview: (e: unknown) => void = () => {}
    api.statsOverview.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectOverview = reject })
    )

    const { unmount } = render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    unmount()

    await act(async () => { rejectOverview(new Error('late stats failure')) })
  })

  it('labels missing textbook metadata as 未知教材 in tree and header', async () => {
    api.listTextbooks.mockResolvedValue([])

    render(<HistoryView />)

    await screen.findByText('第一问：什么是熵？')
    expect((await screen.findAllByText(/📖 未知教材/)).length).toBeGreaterThanOrEqual(2)
  })

  it('sorts textbook groups by title with 未绑定教材 last', async () => {
    api.listConversations.mockResolvedValue([
      CONVERSATIONS[0],
      CONVERSATIONS[1],
      {
        id: 'c3',
        title: '第三课',
        companionId: 'comp_a',
        textbookId: 'tb_2',
        createdAt: '2026-07-04T09:00:00',
        updatedAt: '2026-07-04T10:00:00',
        endedAt: '2026-07-04T10:00:00'
      }
    ])
    api.listTextbooks.mockResolvedValue([
      { id: 'tb_1', title: '热力学入门', format: 'pdf', originalFile: 'thermo.pdf' },
      { id: 'tb_2', title: '数学分析', format: 'pdf', originalFile: 'math.pdf' }
    ])

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    const headers = Array.from(document.querySelectorAll('aside button > span.truncate'))
      .map((el) => el.textContent)
      .filter((text) => text?.startsWith('📖 '))
    expect(headers).toEqual(['📖 热力学入门', '📖 数学分析', '📖 未绑定教材'])
  })
})

describe('HistoryView — resume and continue with missing relations', () => {
  it('resumes an active lesson without selecting a companion', async () => {
    companionsGet.mockResolvedValue(null)

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    fireEvent.click((await screen.findAllByText(/07-05 未知/))[0].closest('button')!)
    await screen.findByText('另一个课堂的问题')

    fireEvent.click(screen.getByText('继续上课'))

    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c2'))
  })

  it('resumes an ended lesson when its textbook vanished', async () => {
    api.listConversations.mockResolvedValue([{ ...CONVERSATIONS[0], endedAt: null }])
    api.getTextbook.mockResolvedValue(null)

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('继续上课'))

    await waitFor(() => expect(useAppStore.getState().loadConversationId).toBe('c1'))
  })

  it('continues learning when companion and textbook lookups are empty', async () => {
    companionsGet.mockResolvedValue(null)
    api.getTextbook.mockResolvedValue(null)

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useAppStore.getState().view).toBe('classroom'))
    expect(useAppStore.getState().newClassroomOpen).toBe(true)
  })

  it('deletes the last lesson and returns to the diary view', async () => {
    api.listConversations.mockResolvedValue([CONVERSATIONS[0]])

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByText('🗑 删除'))

    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith('c1'))
    expect(await screen.findByText(/还没有日记/)).toBeTruthy()
  })
})

describe('HistoryView — exports with system messages and missing names', () => {
  it('exports with the raw companion id while names are still loading', async () => {
    companionsGet.mockImplementation(() => new Promise<CompanionOption | null>(() => {}))

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')

    fireEvent.click(screen.getByTitle('导出为 Markdown'))
    await waitFor(() => expect(api.writeTextFile).toHaveBeenCalledTimes(1))
    const [, md] = api.writeTextFile.mock.calls[0] as [string, string]
    expect(md).toContain('**AI 角色**: comp_a')

    fireEvent.click(screen.getByTitle('导出为 PDF（含公式渲染）'))
    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledTimes(1))
    const [html] = api.exportPdf.mock.calls[0] as [string, string]
    expect(html).toContain('AI 角色：comp_a')
  })

  it('exports system messages with the 系统 label', async () => {
    api.listMessages.mockImplementation(async (convId: string) =>
      convId === 'c1'
        ? [
            ...MESSAGES.c1,
            {
              id: 'm4',
              conversationId: 'c1',
              role: 'system',
              content: '系统提示：本课已结束',
              createdAt: '2026-07-06T09:03:00'
            }
          ]
        : MESSAGES[convId as 'c2'] ?? []
    )

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    expect(await screen.findByText(/^系统 · /)).toBeTruthy()

    fireEvent.click(screen.getByTitle('导出为 Markdown'))
    await waitFor(() => expect(api.writeTextFile).toHaveBeenCalledTimes(1))
    const [, md] = api.writeTextFile.mock.calls[0] as [string, string]
    expect(md).toContain('### 系统 — ')

    fireEvent.click(screen.getByTitle('导出为 PDF（含公式渲染）'))
    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledTimes(1))
    const [html] = api.exportPdf.mock.calls[0] as [string, string]
    expect(html).toContain('<h3>系统 — ')
  })
})

describe('HistoryView — search pagination and artifact edge cases', () => {
  it('applies a late search page after the results were cleared', async () => {
    let resolvePage: (v: unknown) => void = () => {}
    api.searchMessages
      .mockResolvedValueOnce({
        results: [
          { conversationId: 'c1', message: { id: 'm1', role: 'user', content: 'A 结果', createdAt: '2026-07-06T09:00:00' } }
        ],
        total: 3
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '结果' } })
    await screen.findByText('结果 1/3', undefined, { timeout: 2000 })

    fireEvent.click(screen.getByText('加载更多'))
    fireEvent.click(screen.getByText('清除'))

    await act(async () => {
      resolvePage({
        results: [
          { conversationId: 'c1', message: { id: 'm2', role: 'assistant', content: 'B 结果', createdAt: '2026-07-06T09:01:00' } }
        ],
        total: 3
      })
    })

    // The late page replaced the cleared (null) result state.
    expect(await screen.findByText('结果 1/3')).toBeTruthy()
  })

  it('keeps the previous page when a load-more search fails', async () => {
    api.searchMessages
      .mockResolvedValueOnce({
        results: [
          { conversationId: 'c1', message: { id: 'm1', role: 'user', content: 'A 结果', createdAt: '2026-07-06T09:00:00' } }
        ],
        total: 3
      })
      .mockRejectedValueOnce(new Error('search down'))

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '结果' } })
    await screen.findByText('结果 1/3', undefined, { timeout: 2000 })

    fireEvent.click(screen.getByText('加载更多'))

    await waitFor(() => expect(api.searchMessages).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('结果 1/3')).toBeTruthy()
  })

  it('updates only the edited artifact and leaves the others untouched', async () => {
    api.listArtifacts.mockResolvedValue([
      { id: 'a1', conversationId: 'c1', type: 'lesson_summary', content: '## 总结\n本节讲了熵。', createdAt: '2026-07-06T10:00:00' },
      { id: 'a2', conversationId: 'c1', type: 'diary', content: '日记原文', createdAt: '2026-07-06T10:01:00' }
    ])

    render(<HistoryView />)
    await screen.findByText('📋 课堂总结')

    fireEvent.click(screen.getAllByTitle('编辑产物内容')[0])
    const editor = document.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '## 总结\n更新后的总结。' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(api.updateArtifact).toHaveBeenCalledWith('a1', 'c1', '## 总结\n更新后的总结。')
    )
    expect(await screen.findByText(/更新后的总结/)).toBeTruthy()
    expect(screen.getAllByText('日记原文').length).toBeGreaterThan(0)
  })

  it('keeps artifacts when the redo reports failure', async () => {
    api.redoArtifacts.mockResolvedValue({ success: false, artifacts: 0, failures: [] })

    render(<HistoryView />)
    await screen.findByText('有学习摘要缺失，可只补齐缺失项')

    fireEvent.click(screen.getByText('补齐缺失产物'))

    await waitFor(() => expect(api.redoArtifacts).toHaveBeenCalledTimes(1))
    expect(api.listArtifacts).toHaveBeenCalledTimes(1)
    expect(screen.getByText('有学习摘要缺失，可只补齐缺失项')).toBeTruthy()
  })

  it('falls back to the raw artifact type for unknown labels', async () => {
    api.listArtifacts.mockResolvedValue([
      { id: 'a9', conversationId: 'c1', type: 'mystery_type', content: '神秘产物', createdAt: '2026-07-06T10:00:00' }
    ])

    render(<HistoryView />)

    expect(await screen.findByText('mystery_type')).toBeTruthy()
  })

  it('renders the empty detail when a search result points to a missing lesson', async () => {
    api.searchMessages.mockResolvedValue({
      results: [
        { conversationId: 'ghost', message: { id: 'g1', role: 'user', content: '幽灵消息', createdAt: '2026-07-06T09:00:00' } }
      ],
      total: 1
    })

    render(<HistoryView />)
    await screen.findByText('第一问：什么是熵？')
    fireEvent.change(screen.getByPlaceholderText('搜索对话内容...'), { target: { value: '幽灵' } })
    await screen.findByText('结果 1/1', undefined, { timeout: 2000 })

    fireEvent.click(screen.getByTitle('幽灵消息'))

    await waitFor(() => expect(screen.queryByText('对话记录')).toBeNull())
  })
})
