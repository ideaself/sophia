// @vitest-environment jsdom
/**
 * FlashcardReviewView — core review flow:
 * flip, rate (mouse + keyboard), SRS persistence, deck progression.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../../../src/renderer/src/lib/MarkdownRenderer', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  )
}))

import { FlashcardReviewView } from '../../../src/renderer/src/components/FlashcardReviewView'

const CARD_CONTENT = [
  '- 问题：什么是卷积？',
  '- 答案：一种积分运算',
  '- 问题：傅里叶变换的作用？',
  '- 答案：时频转换'
].join('\n')

const saveSrsSpy = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  Object.defineProperty(window, 'sophia', {
    configurable: true,
    value: {
      data: {
        listConversations: vi.fn().mockResolvedValue([
          { id: 'c1', title: '07-06 爱丽丝', companionId: 'comp_a', endedAt: '2026-07-06T10:00:00Z' }
        ]),
        listArtifacts: vi.fn().mockResolvedValue([
          {
            id: 'art_1',
            conversationId: 'c1',
            type: 'flashcards',
            content: CARD_CONTENT,
            createdAt: '2026-07-06T10:00:00Z'
          }
        ]),
        getFlashcardSrsState: vi.fn().mockResolvedValue({}),
        getFlashcardFavorites: vi.fn().mockResolvedValue([]),
        saveFlashcardSrsState: saveSrsSpy,
        saveFlashcardFavorites: vi.fn().mockResolvedValue(undefined)
      }
    }
  })
  saveSrsSpy.mockClear()
})

afterEach(() => {
  cleanup()
})

async function renderView(): Promise<void> {
  render(<FlashcardReviewView />)
  await screen.findByText('什么是卷积？')
}

describe('FlashcardReviewView — review flow', () => {
  it('loads the deck and shows the first question with rating controls hidden', async () => {
    await renderView()

    expect(screen.getByText('什么是卷积？')).toBeTruthy()
    expect(screen.getByText('翻转卡片后评分')).toBeTruthy()
    expect(screen.queryByText('良好')).toBeNull()
    // Second card is not shown yet.
    expect(screen.queryByText('傅里叶变换的作用？')).toBeNull()
  })

  it('flips on click and rates with the mouse, persisting SRS state', async () => {
    await renderView()

    fireEvent.click(screen.getByText('什么是卷积？'))

    expect(screen.getByText('一种积分运算')).toBeTruthy()
    fireEvent.click(screen.getByText('良好'))

    // SRS state written for the first card (key = artifactId_index).
    expect(saveSrsSpy).toHaveBeenCalledTimes(1)
    const payload = saveSrsSpy.mock.calls[0][0] as Record<string, { reps: number }>
    expect(payload['art_1_0']).toBeDefined()
    expect(payload['art_1_0'].reps).toBe(1)

    // Advanced to the next (flip reset) card.
    expect(screen.getByText('傅里叶变换的作用？')).toBeTruthy()
    expect(screen.getByText('翻转卡片后评分')).toBeTruthy()
  })

  it('supports keyboard flow: Space flips, digits rate', async () => {
    await renderView()

    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('一种积分运算')).toBeTruthy()

    fireEvent.keyDown(window, { key: '3' })
    expect(saveSrsSpy).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.getByText('傅里叶变换的作用？')).toBeTruthy()
    })
  })

  it('ignores rating keys while the card is not flipped', async () => {
    await renderView()

    fireEvent.keyDown(window, { key: '3' })
    expect(saveSrsSpy).not.toHaveBeenCalled()
    // Still on the first card.
    expect(screen.getByText('什么是卷积？')).toBeTruthy()
  })

  it('does not rate when typing in an input', async () => {
    await renderView()
    fireEvent.click(screen.getByText('什么是卷积？'))
    expect(screen.getByText('良好')).toBeTruthy()

    // The edit form has a textarea; keys typed there must not rate the card.
    fireEvent.click(screen.getByText('修正'))
    const textareas = screen.getAllByRole('textbox')
    fireEvent.keyDown(textareas[0], { key: '3' })

    expect(saveSrsSpy).not.toHaveBeenCalled()
  })
})
