// @vitest-environment jsdom
/**
 * useFlashcards — SRS persistence (local + synced), favorites, deck loading
 * and the due-count badge hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import {
  loadAllSrsLocal,
  saveAllSrsLocal,
  loadAllSrs,
  saveAllSrs,
  loadAllFavorites,
  saveAllFavorites,
  toggleFavorite,
  loadAllFlashcards,
  updateSrs,
  newSrsState,
  useDueFlashcardCount
} from '../../../src/renderer/src/hooks/useFlashcards'

const data = {
  getFlashcardSrsState: vi.fn(),
  saveFlashcardSrsState: vi.fn(),
  getFlashcardFavorites: vi.fn(),
  saveFlashcardFavorites: vi.fn(),
  listConversations: vi.fn(),
  listArtifacts: vi.fn(),
  dueFlashcardCount: vi.fn()
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(data)) fn.mockReset()
  data.getFlashcardSrsState.mockResolvedValue({})
  data.saveFlashcardSrsState.mockResolvedValue(undefined)
  data.getFlashcardFavorites.mockResolvedValue([])
  data.saveFlashcardFavorites.mockResolvedValue(undefined)
  data.listConversations.mockResolvedValue([])
  data.listArtifacts.mockResolvedValue([])
  data.dueFlashcardCount.mockResolvedValue({ due: 0, total: 0 })

  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(cleanup)

describe('SRS persistence', () => {
  it('round-trips local SRS state and tolerates corrupt JSON', () => {
    expect(loadAllSrsLocal()).toEqual({})

    saveAllSrsLocal({ a: { interval: 1, ease: 2.5, reps: 1, nextReview: 1, lastReview: 1 } })
    expect(loadAllSrsLocal().a?.reps).toBe(1)

    localStorage.setItem('flashcard-srs-state', '{broken')
    expect(loadAllSrsLocal()).toEqual({})
  })

  it('prefers the synced store and mirrors it locally', async () => {
    data.getFlashcardSrsState.mockResolvedValue({ a: { reps: 2 } })

    await expect(loadAllSrs()).resolves.toEqual({ a: { reps: 2 } })
    expect(loadAllSrsLocal().a?.reps).toBe(2)
  })

  it('falls back to local state when the synced store fails', async () => {
    localStorage.setItem('flashcard-srs-state', JSON.stringify({ b: { reps: 3 } }))
    data.getFlashcardSrsState.mockRejectedValue(new Error('ipc down'))

    await expect(loadAllSrs()).resolves.toEqual({ b: { reps: 3 } })
  })

  it('writes through saveAllSrs to both stores', () => {
    saveAllSrs({ c: { interval: 1, ease: 2.5, reps: 1, nextReview: 0, lastReview: 0 } })

    expect(loadAllSrsLocal().c).toBeDefined()
    expect(data.saveFlashcardSrsState).toHaveBeenCalledWith(
      expect.objectContaining({ c: expect.anything() })
    )
  })
})

describe('favorites', () => {
  it('loads, ignores malformed payloads and swallows write failures', async () => {
    data.getFlashcardFavorites.mockResolvedValue(['a', 'b'])
    await expect(loadAllFavorites()).resolves.toEqual(new Set(['a', 'b']))

    data.getFlashcardFavorites.mockResolvedValue('not-an-array')
    await expect(loadAllFavorites()).resolves.toEqual(new Set())

    data.getFlashcardFavorites.mockRejectedValue(new Error('ipc down'))
    await expect(loadAllFavorites()).resolves.toEqual(new Set())

    data.saveFlashcardFavorites.mockRejectedValue(new Error('disk full'))
    await expect(saveAllFavorites(['a'])).resolves.toBeUndefined()
  })

  it('toggles a favorite and persists the change', async () => {
    const added = toggleFavorite(new Set(), 'card_1')
    expect(added.has('card_1')).toBe(true)
    expect(data.saveFlashcardFavorites).toHaveBeenCalledWith(['card_1'])

    const removed = toggleFavorite(added, 'card_1')
    expect(removed.has('card_1')).toBe(false)
  })
})

describe('loadAllFlashcards', () => {
  it('collects cards from ended conversations only and skips other artifacts', async () => {
    data.listConversations.mockResolvedValue([
      { id: 'c1', title: '已下课', endedAt: '2026-07-06T10:00:00Z' },
      { id: 'c2', title: '进行中', endedAt: null }
    ])
    data.listArtifacts.mockResolvedValue([
      { id: 'art_1', type: 'flashcards', content: '- 问题：熵？\n- 答案：状态函数', createdAt: 't1' },
      { id: 'art_2', type: 'diary', content: '日记', createdAt: 't2' }
    ])

    const cards = await loadAllFlashcards()

    expect(data.listArtifacts).toHaveBeenCalledTimes(1)
    expect(data.listArtifacts).toHaveBeenCalledWith('c1')
    expect(cards).toEqual([
      {
        id: 'art_1_0',
        artifactId: 'art_1',
        cardIndex: 0,
        conversationId: 'c1',
        conversationTitle: '已下课',
        createdAt: 't1',
        question: '熵？',
        answer: '状态函数'
      }
    ])
  })

  it('drops a conversation whose artifacts cannot be listed', async () => {
    data.listConversations.mockResolvedValue([
      { id: 'c1', title: '坏', endedAt: '2026-07-06T10:00:00Z' }
    ])
    data.listArtifacts.mockRejectedValue(new Error('io'))

    await expect(loadAllFlashcards()).resolves.toEqual([])
  })
})

describe('updateSrs', () => {
  it('resets on a failed recall', () => {
    const next = updateSrs({ interval: 10, ease: 2.5, reps: 4, nextReview: 0, lastReview: 0 }, 'again')
    expect(next.reps).toBe(0)
    expect(next.interval).toBe(1)
  })

  it('grows the interval across successful reps', () => {
    const first = updateSrs(newSrsState(), 'good')
    expect(first.reps).toBe(1)
    expect(first.interval).toBe(1)

    const easyFirst = updateSrs(newSrsState(), 'easy')
    expect(easyFirst.interval).toBe(4)

    const second = updateSrs(first, 'hard')
    expect(second.reps).toBe(2)
    expect(second.interval).toBe(3)

    const easySecond = updateSrs(first, 'easy')
    expect(easySecond.interval).toBe(8)

    const third = updateSrs({ ...second, interval: 3, ease: 2 }, 'good')
    expect(third.reps).toBe(3)
    expect(third.interval).toBe(6)
  })
})

describe('useDueFlashcardCount', () => {
  it('refreshes on mount, focus (debounced), interval and skips hidden windows', async () => {
    vi.useFakeTimers()
    try {
      data.dueFlashcardCount.mockResolvedValue({ due: 4, total: 9 })

      const hook = renderHook(() => useDueFlashcardCount())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(hook.result.current).toBe(4)

      // A hidden window skips the scan entirely.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      data.dueFlashcardCount.mockClear()
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(data.dueFlashcardCount).not.toHaveBeenCalled()

      // Visible again: focus fires after the debounce.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      data.dueFlashcardCount.mockResolvedValue({ due: 7, total: 9 })
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(hook.result.current).toBe(7)

      // The minute timer keeps it fresh; failures keep the previous value.
      data.dueFlashcardCount.mockRejectedValueOnce(new Error('ipc down'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(hook.result.current).toBe(7)

      data.dueFlashcardCount.mockResolvedValue({ due: 1, total: 9 })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(hook.result.current).toBe(1)

      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces rapid focus events and clears a pending timer on unmount', async () => {
    vi.useFakeTimers()
    try {
      data.dueFlashcardCount.mockResolvedValue({ due: 2, total: 5 })
      const hook = renderHook(() => useDueFlashcardCount())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      // Two focus events within the debounce window reset the timer once.
      data.dueFlashcardCount.mockResolvedValue({ due: 3, total: 5 })
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(400)
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(hook.result.current).toBe(3)

      // A pending timer at unmount is cleared by the cleanup.
      window.dispatchEvent(new Event('focus'))
      hook.unmount()
      data.dueFlashcardCount.mockClear()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(data.dueFlashcardCount).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
