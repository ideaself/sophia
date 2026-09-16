// @vitest-environment jsdom
/**
 * HistoryView — classroom browser smoke tests.
 *
 * Covers the structure that the upcoming virtualization work will touch:
 * grouped tree with per-lesson counts, default selection, and the detail
 * panel (messages + artifacts) for the selected lesson.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
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
  diary: {
    listMonths: vi.fn(),
    getMonth: vi.fn()
  }
}

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
  api.diary.listMonths.mockResolvedValue([])
  api.diary.getMonth.mockResolvedValue('')

  useTextbookStore.setState({ textbooks: [], selectedTextbook: null })
  useAppStore.setState({ view: 'history', loadConversationId: null })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: api,
      companions: {
        get: vi.fn(async (id: string) => ({
          id,
          name: id === 'comp_a' ? '爱丽丝' : '福尔摩斯',
          identity: '导师',
          personalityKeywords: []
        }))
      },
      dialog: { confirm: vi.fn().mockResolvedValue(true) }
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
    expect((await screen.findAllByText(/爱丽丝/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/福尔摩斯/).length).toBeGreaterThan(0)
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

    // Click the second lesson ("07-05 福尔摩斯" row).
    fireEvent.click(screen.getByText(/福尔摩斯/).closest('button')!)

    expect(await screen.findByText('另一个课堂的问题')).toBeTruthy()
    expect(screen.queryByText('第一问：什么是熵？')).toBeNull()
  })
})
