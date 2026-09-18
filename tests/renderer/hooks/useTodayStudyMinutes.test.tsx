// @vitest-environment jsdom
/**
 * useTodayStudyMinutes — cached, single-flight daily study minutes with a
 * debounced window-focus refresh.
 *
 * The hook keeps module-level cache state, so each test re-imports it after
 * resetModules() to keep the cases independent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'

const data = { todayStudyMinutes: vi.fn() }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  data.todayStudyMinutes.mockReset().mockResolvedValue(0)
  Object.defineProperty(window, 'sophia', { configurable: true, value: { data } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function setup(): Promise<{ current: number }> {
  const { useTodayStudyMinutes } = await import(
    '../../../src/renderer/src/hooks/useTodayStudyMinutes'
  )
  const hook = renderHook(() => useTodayStudyMinutes())
  // Flush the mount load (resolved microtask).
  await act(async () => {
    await Promise.resolve()
  })
  return hook.result
}

describe('useTodayStudyMinutes', () => {
  it('loads the value on mount and refreshes on focus (debounced)', async () => {
    vi.useFakeTimers()
    data.todayStudyMinutes.mockResolvedValue(12)

    const result = await setup()
    expect(result.current).toBe(12)

    // The cached value short-circuits immediate re-reads.
    data.todayStudyMinutes.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(data.todayStudyMinutes).not.toHaveBeenCalled()

    // Focus refreshes after the debounce window, once the TTL has expired
    // (repeated focus events coalesce into one reload).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    data.todayStudyMinutes.mockResolvedValue(30)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(900)
    })
    expect(result.current).toBe(30)
  })

  it('keeps the previous value when a refresh fails', async () => {
    vi.useFakeTimers()
    data.todayStudyMinutes.mockResolvedValue(7)

    const result = await setup()
    expect(result.current).toBe(7)

    // Expire the cache, then let the next read fail.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    data.todayStudyMinutes.mockRejectedValue(new Error('ipc down'))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(900)
    })

    expect(result.current).toBe(7)
  })

  it('refreshes on the five-minute interval and cleans up on unmount', async () => {
    vi.useFakeTimers()
    data.todayStudyMinutes.mockResolvedValue(1)
    const { useTodayStudyMinutes } = await import(
      '../../../src/renderer/src/hooks/useTodayStudyMinutes'
    )
    const hook = renderHook(() => useTodayStudyMinutes())
    await act(async () => {
      await Promise.resolve()
    })
    expect(hook.result.current).toBe(1)

    data.todayStudyMinutes.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 61_000)
    })
    expect(data.todayStudyMinutes).toHaveBeenCalled()

    hook.unmount()
    data.todayStudyMinutes.mockClear()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(data.todayStudyMinutes).not.toHaveBeenCalled()
  })
})

describe('useTodayStudyMinutes — cache and single-flight', () => {
  it('serves the cached value for a refresh within the TTL', async () => {
    vi.useFakeTimers()
    data.todayStudyMinutes.mockResolvedValue(12)
    const result = await setup()
    expect(result.current).toBe(12)

    // Focus shortly after the mount load: the debounced refresh happens well
    // within the 60s TTL, so the cached value is reused.
    data.todayStudyMinutes.mockClear()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(data.todayStudyMinutes).not.toHaveBeenCalled()
    expect(result.current).toBe(12)
  })

  it('shares one in-flight request between concurrent consumers', async () => {
    const gate = deferred<number>()
    data.todayStudyMinutes.mockReturnValue(gate.promise)
    const { useTodayStudyMinutes } = await import(
      '../../../src/renderer/src/hooks/useTodayStudyMinutes'
    )

    const first = renderHook(() => useTodayStudyMinutes())
    const second = renderHook(() => useTodayStudyMinutes())
    expect(data.todayStudyMinutes).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve(42)
      await gate.promise
    })
    await waitFor(() => expect(first.result.current).toBe(42))
    expect(second.result.current).toBe(42)
  })

  it('drops a response that lands after unmount', async () => {
    const gate = deferred<number>()
    data.todayStudyMinutes.mockReturnValue(gate.promise)
    const { useTodayStudyMinutes } = await import(
      '../../../src/renderer/src/hooks/useTodayStudyMinutes'
    )

    const hook = renderHook(() => useTodayStudyMinutes())
    hook.unmount()

    await act(async () => {
      gate.resolve(9)
      await gate.promise
    })
    expect(hook.result.current).toBe(0)
  })
})

describe('useTodayStudyMinutes — pending focus timer cleanup', () => {
  it('clears a pending focus timer on unmount', async () => {
    vi.useFakeTimers()
    data.todayStudyMinutes.mockResolvedValue(5)
    const { useTodayStudyMinutes } = await import(
      '../../../src/renderer/src/hooks/useTodayStudyMinutes'
    )
    const hook = renderHook(() => useTodayStudyMinutes())
    await act(async () => {
      await Promise.resolve()
    })
    expect(hook.result.current).toBe(5)

    // Schedule the debounce, then unmount before it fires.
    window.dispatchEvent(new Event('focus'))
    hook.unmount()
    data.todayStudyMinutes.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(data.todayStudyMinutes).not.toHaveBeenCalled()
  })
})
