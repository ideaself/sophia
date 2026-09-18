// @vitest-environment jsdom
/**
 * ReviewView — lesson review page: tab gating by available artifacts, content
 * switching, concept mastery list, rule-based next steps and continue-learning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { ReviewView } from '../../../src/renderer/src/components/ReviewView'
import { useAppStore } from '../../../src/renderer/src/stores/useAppStore'
import { useTextbookStore } from '../../../src/renderer/src/stores/useTextbookStore'

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
  onConceptsUpdated: vi.fn((_cb?: (event: { conversationId: string }) => void) => () => {}),
  listConversations: vi.fn(async () => [] as unknown[]),
  getFlashcardSrsState: vi.fn(async () => ({})),
  getFlashcardFavorites: vi.fn(async () => []),
  saveFlashcardSrsState: vi.fn(async () => undefined),
  saveFlashcardFavorites: vi.fn(async () => undefined),
  getArtifact: vi.fn(async () => null),
  updateArtifact: vi.fn(async () => null),
  deleteFlashcardCards: vi.fn(async () => ({ success: true, deleted: 0 })),
  writeTextFile: vi.fn(async () => ({ success: true }))
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
    id: 'comp_a', name: '朗道', identity: '化学导师', personalityKeywords: []
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
    expect(screen.getByText(/朗道 · 化学课本/)).toBeTruthy()
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

    await screen.findByText(/朗道 · 化学课本/)
    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useAppStore.getState().view).toBe('classroom'))
    expect(useAppStore.getState().reviewScope).toBeNull()
  })
})

describe('ReviewView — fallbacks and media panels', () => {
  it('survives failing message, artifact, concept, companion and textbook lookups', async () => {
    dataMocks.listMessages.mockRejectedValue(new Error('x'))
    dataMocks.listArtifacts.mockRejectedValue(new Error('x'))
    dataMocks.listConcepts.mockRejectedValue(new Error('x'))
    companionsGet.mockRejectedValue(new Error('x'))
    dataMocks.getTextbook.mockRejectedValue(new Error('x'))

    render(<ReviewView />)

    // No artifacts → no tabs, but the header falls back to the raw companion id.
    expect(await screen.findByText(/comp_a/)).toBeTruthy()
    expect(screen.queryByText('课堂总结')).toBeNull()
    expect(screen.queryByText('🎧 音频回顾')).toBeNull()
  })

  it('renders a bare header when the class has no companion or textbook', async () => {
    dataMocks.getConversation.mockResolvedValue({ id: 'c1', title: '第一课' })

    render(<ReviewView />)

    await screen.findByText('课堂总结')
    expect(screen.queryByText(/朗道/)).toBeNull()
    expect(screen.queryByText(/化学课本/)).toBeNull()
    expect(companionsGet).not.toHaveBeenCalled()
  })

  it('refreshes concepts when the classroom reports an update', async () => {
    let cb: ((event: { conversationId: string }) => void) | null = null
    dataMocks.onConceptsUpdated.mockImplementation(
      (fn?: (event: { conversationId: string }) => void) => {
        if (fn) cb = fn
        return () => {}
      }
    )

    render(<ReviewView />)
    await screen.findByText('📊 概念掌握')

    dataMocks.listConcepts.mockClear()
    act(() => cb?.({ conversationId: 'c1' }))
    await waitFor(() => expect(dataMocks.listConcepts).toHaveBeenCalledWith('c1'))

    dataMocks.listConcepts.mockClear()
    act(() => cb?.({ conversationId: 'other' }))
    expect(dataMocks.listConcepts).not.toHaveBeenCalled()
  })

  it('labels the 理解 and 未接触 mastery tiers', async () => {
    dataMocks.listConcepts.mockResolvedValue([
      { ...CONCEPTS[0], id: 'k3', name: '温度', mastery: 0.6, misconception: null },
      { ...CONCEPTS[0], id: 'k4', name: '功', mastery: 0.1, misconception: null }
    ])

    render(<ReviewView />)
    await screen.findByText('📊 概念掌握')
    fireEvent.click(screen.getByText('📊 概念掌握'))

    expect(screen.getByText('理解 · 60%')).toBeTruthy()
    expect(screen.getByText('未接触 · 10%')).toBeTruthy()
  })

  it('returns to the history view', async () => {
    render(<ReviewView />)
    await screen.findByText('返回历史')

    fireEvent.click(screen.getByText('返回历史'))

    expect(useAppStore.getState().view).toBe('history')
    expect(useAppStore.getState().reviewScope).toBeNull()
  })

  it('renders the timeline from the lesson artifact', async () => {
    dataMocks.listArtifacts.mockResolvedValue([
      ...ARTIFACTS,
      {
        id: 'a4',
        type: 'lesson_timeline',
        content: '- 00:00 引入：熵的定义\n- 00:05 练习：计算熵变',
        createdAt: '2026-07-06T10:03:00Z'
      }
    ])

    render(<ReviewView />)
    await screen.findByText('🕐 课堂时间线')
    fireEvent.click(screen.getByText('🕐 课堂时间线'))

    expect(screen.getByText('00:00')).toBeTruthy()
    expect(screen.getByText('引入')).toBeTruthy()
    expect(screen.getByText('熵的定义')).toBeTruthy()
    expect(screen.getByText('00:05')).toBeTruthy()
  })

  it('shows the raw timeline text when nothing parses', async () => {
    dataMocks.listArtifacts.mockResolvedValue([
      ...ARTIFACTS,
      { id: 'a4', type: 'lesson_timeline', content: '没有可解析的时间线', createdAt: '2026-07-06T10:03:00Z' }
    ])

    render(<ReviewView />)
    await screen.findByText('🕐 课堂时间线')
    fireEvent.click(screen.getByText('🕐 课堂时间线'))

    expect(screen.getByText('没有可解析的时间线')).toBeTruthy()
  })

  it('expands and collapses FAQ entries', async () => {
    dataMocks.listArtifacts.mockResolvedValue([
      ...ARTIFACTS,
      { id: 'a5', type: 'lesson_faq', content: '- 问：熵是什么？\n- 答：状态函数', createdAt: '2026-07-06T10:04:00Z' }
    ])

    render(<ReviewView />)
    await screen.findByText('❓ 课堂 FAQ')
    fireEvent.click(screen.getByText('❓ 课堂 FAQ'))

    // The first entry starts expanded.
    expect(screen.getByText('状态函数')).toBeTruthy()
    fireEvent.click(screen.getByText(/Q1\. 熵是什么/))
    await waitFor(() => expect(screen.queryByText('状态函数')).toBeNull())
    fireEvent.click(screen.getByText(/Q1\. 熵是什么/))
    expect(screen.getByText('状态函数')).toBeTruthy()
  })

  it('clears the flashcards scope back to the summary tab', async () => {
    dataMocks.listArtifacts.mockResolvedValue([
      ...ARTIFACTS.filter((a) => a.id !== 'a3'),
      { id: 'a3', type: 'flashcards', content: '- 问题：a\n- 答案：b', createdAt: '2026-07-06T10:02:00Z' }
    ])
    dataMocks.listConversations.mockResolvedValue([
      { id: 'c1', title: '第一课', companionId: 'comp_a', endedAt: '2026-07-06T10:00:00Z' }
    ])

    render(<ReviewView />)
    await screen.findByText('记忆卡片')
    fireEvent.click(screen.getByText('记忆卡片'))

    fireEvent.click(await screen.findByText('返回全部卡片'))

    expect(await screen.findByText(/什么是熵/)).toBeTruthy()
  })
})

describe('ReviewView — continue-learning failures and empty FAQ', () => {
  it('keeps going when the companion and textbook lookups fail', async () => {
    dataMocks.getConversation.mockResolvedValue({
      id: 'c1',
      title: '第一课',
      companionId: 'comp_a',
      textbookId: 'tb_1'
    })
    companionsGet.mockRejectedValue(new Error('boom'))
    dataMocks.getTextbook.mockRejectedValue(new Error('boom'))

    render(<ReviewView />)
    await screen.findByText('返回历史')

    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useAppStore.getState().view).toBe('classroom'))
    expect(useAppStore.getState().reviewScope).toBeNull()
  })

  it('clears the selected textbook when the class has none', async () => {
    dataMocks.getConversation.mockResolvedValue({ id: 'c1', title: '第一课', companionId: null })
    useTextbookStore.setState({ selectedTextbook: { id: 'tb_old' } as never })

    render(<ReviewView />)
    await screen.findByText('返回历史')

    fireEvent.click(screen.getByText('继续学习'))

    await waitFor(() => expect(useTextbookStore.getState().selectedTextbook).toBeNull())
  })

  it('shows the raw FAQ text when nothing parses', async () => {
    dataMocks.listArtifacts.mockResolvedValue([
      ...ARTIFACTS,
      { id: 'a5', type: 'lesson_faq', content: '没有解析出问答', createdAt: '2026-07-06T10:05:00Z' }
    ])

    render(<ReviewView />)
    await screen.findByText('❓ 课堂 FAQ')
    fireEvent.click(screen.getByText('❓ 课堂 FAQ'))

    expect(screen.getByText('没有解析出问答')).toBeTruthy()
  })
})
