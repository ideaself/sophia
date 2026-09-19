// @vitest-environment jsdom
/**
 * useDueConceptCount — due-concept badge count: mount/focus (debounced)/
 * interval refresh, hidden-window skip and failure tolerance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDueConceptCount } from '../../../src/renderer/src/hooks/useConcepts'

const data = { dueConceptCount: vi.fn() }

beforeEach(() => {
  data.dueConceptCount.mockReset().mockResolvedValue({ due: 0, total: 0 })
  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(cleanup)

describe('useDueConceptCount', () => {
  it('refreshes on mount, focus (debounced), interval and skips hidden windows', async () => {
    vi.useFakeTimers()
    try {
      data.dueConceptCount.mockResolvedValue({ due: 4, total: 9 })

      const hook = renderHook(() => useDueConceptCount())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(hook.result.current).toBe(4)

      // A hidden window skips the scan entirely.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      data.dueConceptCount.mockClear()
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(data.dueConceptCount).not.toHaveBeenCalled()

      // Visible again: focus fires after the debounce.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      data.dueConceptCount.mockResolvedValue({ due: 7, total: 9 })
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(hook.result.current).toBe(7)

      // The minute timer keeps it fresh; failures keep the previous value.
      data.dueConceptCount.mockRejectedValueOnce(new Error('ipc down'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(hook.result.current).toBe(7)

      data.dueConceptCount.mockResolvedValue({ due: 1, total: 9 })
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
      data.dueConceptCount.mockResolvedValue({ due: 2, total: 5 })
      const hook = renderHook(() => useDueConceptCount())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      data.dueConceptCount.mockResolvedValue({ due: 3, total: 5 })
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(400)
        window.dispatchEvent(new Event('focus'))
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(hook.result.current).toBe(3)

      window.dispatchEvent(new Event('focus'))
      hook.unmount()
      data.dueConceptCount.mockClear()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(data.dueConceptCount).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
