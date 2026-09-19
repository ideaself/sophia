// @vitest-environment jsdom
/**
 * ConceptCardGenerator — weak-concept card generation entry on the review
 * page: hidden without weak concepts, busy state, success/error surfacing,
 * artifact refresh callback and the jump into scoped flashcard review.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ConceptCardGenerator } from '../../../src/renderer/src/components/ConceptCardGenerator'
import { useAppStore } from '../../../src/renderer/src/stores/useAppStore'

const data = { generateConceptCards: vi.fn() }

const WEAK = [
  { name: '熵', mastery: 0.2, misconception: '熵是能量' },
  { name: '焓', mastery: 0.4, misconception: '把焓当内能' }
]

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  data.generateConceptCards.mockReset()
  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
  useAppStore.setState({ view: 'classroom', flashcardScope: null })
})

afterEach(cleanup)

function renderGenerator(concepts = WEAK, onGenerated = vi.fn()): { onGenerated: ReturnType<typeof vi.fn> } {
  render(
    <ConceptCardGenerator
      conversationId="conv_1"
      conversationTitle="物理第一课"
      concepts={concepts}
      onGenerated={onGenerated}
    />
  )
  return { onGenerated }
}

describe('ConceptCardGenerator', () => {
  it('renders nothing when no concept is weak', () => {
    const { container } = render(
      <ConceptCardGenerator
        conversationId="conv_1"
        conversationTitle="物理第一课"
        concepts={[{ name: '导数', mastery: 0.9, misconception: null }]}
        onGenerated={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
    expect(data.generateConceptCards).not.toHaveBeenCalled()
  })

  it('generates cards, refreshes the parent and jumps into review', async () => {
    data.generateConceptCards.mockResolvedValue({
      success: true,
      added: 2,
      concepts: ['熵', '焓']
    })
    const { onGenerated } = renderGenerator()

    expect(screen.getByText(/有 2 个薄弱概念/)).toBeTruthy()
    expect(screen.getByText(/熵、焓/)).toBeTruthy()

    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('已生成 2 张卡片：熵、焓')).toBeTruthy()
    expect(data.generateConceptCards).toHaveBeenCalledWith('conv_1')
    expect(onGenerated).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('去复习'))
    expect(useAppStore.getState().view).toBe('flashcards')
    expect(useAppStore.getState().flashcardScope).toEqual({
      conversationId: 'conv_1',
      title: '物理第一课'
    })
  })

  it('disables the button while the generation is pending', async () => {
    const pending = deferred<{ success: boolean; added: number; concepts?: string[] }>()
    data.generateConceptCards.mockReturnValue(pending.promise)
    renderGenerator()

    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    const busy = screen.getByText('生成中...')
    expect(busy.closest('button')?.disabled).toBe(true)

    pending.resolve({ success: true, added: 1, concepts: ['熵'] })
    await screen.findByText('已生成 1 张卡片：熵')
  })

  it('handles a success without cards and a response without concept names', async () => {
    data.generateConceptCards.mockResolvedValueOnce({ success: true, added: 0, concepts: [] })
    renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('暂无需要生成卡片的薄弱概念')).toBeTruthy()

    cleanup()
    data.generateConceptCards.mockResolvedValueOnce({ success: true, added: 3 })
    renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('已生成 3 张卡片：')).toBeTruthy()
  })

  it('surfaces handler errors with and without a message', async () => {
    data.generateConceptCards.mockResolvedValueOnce({ success: false, added: 0, error: '未配置模型服务' })
    const first = renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('未配置模型服务')).toBeTruthy()
    expect(first.onGenerated).not.toHaveBeenCalled()

    cleanup()
    data.generateConceptCards.mockResolvedValueOnce({ success: false, added: 0 })
    renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('生成失败，请重试')).toBeTruthy()
  })

  it('surfaces thrown failures of both kinds', async () => {
    data.generateConceptCards.mockRejectedValueOnce(new Error('网络中断'))
    renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    expect(await screen.findByText('网络中断')).toBeTruthy()

    cleanup()
    data.generateConceptCards.mockRejectedValueOnce('boom')
    renderGenerator()
    fireEvent.click(screen.getByText('🃏 生成薄弱概念卡片'))
    await waitFor(() => expect(screen.getByText('生成失败，请重试')).toBeTruthy())
    expect(screen.queryByText('去复习')).toBeNull()
  })
})
