// @vitest-environment jsdom
/**
 * ReviewView — lesson review page: tab gating by available artifacts, content
 * switching, concept mastery list, rule-based next steps and continue-learning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { ReviewView } from '../../../src/renderer/src/components/ReviewView'
import { useAppStore } from '../../../src/renderer/src/stores/useAppStore'

const ARTIFACTS = [
  {
    id: 'a1',
    type: 'lesson_summary',
    content: '## 总结\n**自测 1：什么是熵？**\n- 提示 1：与无序度有关\n- 答案：无序度的度量',
    createdAt: '2026-07-06T10:00:00Z'
  },
  { id: 'a2', type: 'diary', content: '今天在课堂上理解了熵的意义。', createdAt: '2026-07-06T10:01:00Z' },
  { id: 'a3', type: 'flashcards', content: '[]', createdAt: '2026-07-06T10:02:00Z' }
]

const CONCEPTS = [
  {
    id: 'k1', name: '熵', textbookId: 'tb_1', mastery: 0.8, misconception: null,
    attemptCount: 3, correctCount: 2, lastSeenAt: '2026-07-06T09:00:00Z',
    updatedAt: '2026-07-06T09:00:00Z', evidenceConversationId: 'c1'
  },
  {
    id: 'k2', name: '焓', textbookId: 'tb_1', mastery: 0.3, misconception: '混淆内能与焓',
    attemptCount: 2, correctCount: 0, lastSeenAt: '2026-07-06T09:05:00Z',
    updatedAt: '2026-07-06T09:05:00Z', evidenceConversationId: 'c1'
  }
]

const dataMocks = {
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  listArtifacts: vi.fn(),
  listConcepts: vi.fn(),
  getTextbook: vi.fn(),
  onConceptsUpdated: vi.fn(() => () => {})
}
const companionsGet = vi.fn()

beforeEach(() => {
  for (const fn of Object.values(dataMocks)) {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear()
  }
  companionsGet.mockClear()

  dataMocks.getConversation.mockResolvedValue({
    id: 'c1', title: '第一课', companionId: 'comp_a', textbookId: 'tb_1'
  })
  dataMocks.listMessages.mockResolvedValue([
    { id: 'm1', role: 'user', content: '什么是熵？', createdAt: '2026-07-06T09:00:00Z' },
    { id: 'm2', role: 'assistant', content: '无序度的度量。', createdAt: '2026-07-06T09:05:00Z' }
  ])
  dataMocks.listArtifacts.mockResolvedValue(ARTIFACTS)
  dataMocks.listConcepts.mockResolvedValue(CONCEPTS)
  dataMocks.getTextbook.mockResolvedValue({ id: 'tb_1', title: '化学课本' })
  companionsGet.mockResolvedValue({
    id: 'comp_a', name: '爱丽丝', identity: '化学导师', personalityKeywords: []
  })

  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: { data: dataMocks, companions: { get: companionsGet } }
  })

  useAppStore.setState({ reviewScope: { conversationId: 'c1', title: '第一课' } })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ reviewScope: null, view: 'classroom', loadConversationId: null })
})

describe('ReviewView', () => {
  it('shows the empty state without a review scope', () => {
    useAppStore.setState({ reviewScope: null })
    render(<ReviewView />)

    expect(screen.getByText('没有选择要复盘的课堂')).toBeTruthy()
  })

  it('lists only the tabs backed by artifacts or concepts', async () => {
    render(<ReviewView />)

    await screen.findByText('课堂总结')
    expect(screen.getByText(/爱丽丝 · 化学课本/)).toBeTruthy()
    expect(screen.getByText('自测题 (1)')).toBeTruthy()
    expect(screen.getByText('学习日记')).toBeTruthy()
    expect(screen.getByText('记忆卡片')).toBeTruthy()
    expect(screen.getByText('📊 概念掌握')).toBeTruthy()
    expect(screen.getByText('🎯 下一步建议')).toBeTruthy()

    // No progress / audio / timeline artifacts → those tabs stay hidden.
    expect(screen.queryByText('学习进展')).toBeNull()
    expect(screen.queryByText('🎧 音频回顾')).toBeNull()
    expect(screen.queryByText('🕐 课堂时间线')).toBeNull()
  })

  it('opens on the summary and switches to the diary tab', async () => {
    render(<ReviewView />)

    await screen.findByText(/什么是熵/)
    fireEvent.click(screen.getByText('学习日记'))
    expect(screen.getByText('今天在课堂上理解了熵的意义。')).toBeTruthy()
  })

  it('renders concept mastery with levels and misconceptions', async () => {
    render(<ReviewView />)

    await screen.findByText('📊 概念掌握')
    fireEvent.click(screen.getByText('📊 概念掌握'))

    expect(screen.getByText('熵')).toBeTruthy()
    expect(screen.getByText('掌握 · 80%')).toBeTruthy()
    expect(screen.getByText('焓')).toBeTruthy()
    expect(screen.getByText('薄弱 · 30%')).toBeTruthy()
    expect(screen.getByText('尝试 2 次 · 答对 0 次')).toBeTruthy()
    expect(screen.getByText('⚠️ 误解点：混淆内能与焓')).toBeTruthy()
  })

  it('builds next steps from the concept tiers', async () => {
    render(<ReviewView />)

    await screen.findByText('🎯 下一步建议')
    fireEvent.click(screen.getByText('🎯 下一步建议'))

    expect(screen.getByText('先澄清误解')).toBeTruthy()
    expect(screen.getByText('薄弱概念需要复习')).toBeTruthy()
    expect(screen.getByText('可以向前推进')).toBeTruthy()
    // 0.3 → 薄弱, 0.8 → 掌握: nothing lands in the 理解 tier.
    expect(screen.queryByText('巩固提升')).toBeNull()
  })

  it('continues learning by leaving the review scope', async () => {
    render(<ReviewView />)

    await screen.findByText(/爱丽丝 · 化学课本/)
    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useAppStore.getState().view).toBe('classroom'))
    expect(useAppStore.getState().reviewScope).toBeNull()
  })
})
